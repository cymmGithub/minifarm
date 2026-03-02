# Minifarm Architecture

This document covers the technical internals of the Minifarm distributed testing system.

## System Overview

The Minifarm is a three-tier system:

1. **CLI** — The entry point. Orchestrates two parallel deployment pipelines, triggers tests, and polls for results.
2. **Server** — The central coordinator. Manages the test queue, distributes work to clients, collects results, and streams progress via SSE.
3. **Clients** — Worker nodes. Each runs inside a Docker container deployed via Swarm, executes Playwright tests on demand, and returns compressed blob reports.

The dashboard is a React SPA served by the server, providing real-time visibility into the pipeline.

## Full Data Flow

A typical test run initiated from the dashboard:

```
Dashboard (browser)
  │
  ├─ POST /api/pipeline/start { branch, requester, workers }
  │
  ▼
Server (pipeline-routes.js)
  │
  ├─ Resolves branch across all repos (parallel git fetch + branch lookup)
  ├─ Queues the run via pipeline.js state machine
  ├─ pipeline.js emits 'run:started' event
  │
  ▼
Pipeline Executor (pipeline-executor.js)
  │
  ├─ Spawns: node minifarm.js test <branch> <requester>
  ├─ Parses stdout line-by-line for [stage] prefixed messages
  ├─ Updates pipeline state machine per stage
  ├─ Emits SSE events (stage:started, stage:complete, log)
  │
  ▼
CLI (minifarm.js)
  │
  ├─ PIPELINE 1 (async):
  │   ├─ git.checkoutTests(branch)          → [client-deployment] Checking out...
  │   ├─ apps.updateStandaloneEnvs()        → [client-deployment] Updating .env...
  │   ├─ docker.buildAndPush('latest')      → [client-deployment] Building image...
  │   ├─ docker.updateSwarmService('latest') → [client-deployment] Updating Swarm...
  │   ├─ docker.waitForClients()            → [client-deployment] Waiting for clients...
  │   └─ docker.systemPrune()              → [client-deployment] Complete
  │
  ├─ PIPELINE 2 (async, parallel with Pipeline 1):
  │   ├─ apps.deployMasterApps(branch)      → [master-apps] Starting deployment...
  │   │   ├─ docker compose down
  │   │   ├─ git checkout all repos (hwp, concurrency=4)
  │   │   ├─ Update .env files (hwp, concurrency=4)
  │   │   ├─ docker compose up -d --build
  │   │   ├─ Build HQ for production
  │   │   └─ Verify all PM2 apps online
  │   ├─ apps.seedDatabase()               → [db-reseed] Reseeding...
  │   └─                                   → [db-reseed] Complete
  │
  ├─ Promise.allSettled([pipeline1, pipeline2])
  │
  ├─ PHASE 1: Web Tests
  │   ├─ testing.setProject('chromium')
  │   ├─ testing.triggerTests(branch)       → GET /test?version=...&requester=...
  │   └─ testing.pollForCompletion()        → GET /status?timestamp=...  (loop)
  │
  ├─ Database reseed between phases
  │
  ├─ PHASE 2: Mobile Tests
  │   ├─ testing.setProject('mobile-chromium')
  │   ├─ testing.triggerTests(branch)
  │   └─ testing.pollForCompletion()
  │
  └─ Print results URLs
```

## SSE Streaming Architecture

The system uses Server-Sent Events (SSE) for real-time updates. There are two independent SSE channels:

### Pipeline SSE (`/api/pipeline/stream`)

Streams pipeline execution progress from CLI → Server → Dashboard.

```
CLI stdout                Pipeline Executor          Dashboard
──────────                ─────────────────          ─────────
[client-deployment]  ──►  parseLogLine()        ──►  event: stage:started
  Building image...       updateStage(running)       data: {stage, status}

[client-deployment]  ──►  addLog()              ──►  event: log
  Image pushed: ...       pipeline.addLog()          data: {stage, message}

[client-deployment]  ──►  isStageComplete()     ──►  event: stage:complete
  Complete                updateStage(complete)      data: {stage, status}
```

**Event types:**
- `run:started` / `run:complete` / `run:failed` / `run:cancelled`
- `stage:started` / `stage:complete` / `stage:failed`
- `log` — Per-stage log messages
- `queue` — Queue state updates (current + queued runs)

### Queue SSE (`/queue` endpoint with EventEmitter)

Streams test queue updates for the legacy test execution path.

```
Server (routes.js)
  │
  ├─ queueEvents.emit('queue-update', enrichedQueue)
  │   Triggered on: test added, test status change, batch complete
  │
  └─ reportEvents.emit('reports-update', reportsList)
      Triggered on: report merged, report deleted
```

## Structured Log Protocol

The bridge between CLI output and dashboard progress is a simple text protocol:

```
[stage-name] message
```

Where `stage-name` is one of:
- `client-deployment`
- `master-apps`
- `japa-tests`
- `ava-tests`
- `db-reseed`
- `playwright-tests`

The `stage-logger.js` module creates prefixed loggers with deduplication:

```javascript
const clientLog = stageLogger.clientDeployment;
clientLog.step('Building client image...');
// Output: [client-deployment] Building client image...

clientLog.step('Building client image...');
// (suppressed — duplicate)
```

The pipeline executor (`pipeline-executor.js`) parses these lines:

1. **Regex match**: `/^\[([^\]]+)\]\s*(.*)$/`
2. **Stage validation**: Checks against `VALID_STAGES` set
3. **State tracking**: Maintains `startedStages` and `completedStages` sets
4. **Completion detection**: Messages like "Complete", "Failed" trigger stage transitions
5. **Auto-completion**: When `playwright-tests` starts, all prior deployment stages are auto-completed

Lines without a `[stage]` prefix are attributed to the most recent stage (`currentLogStage`).

## Test Distribution Algorithm

Test distribution uses a **work-stealing** pattern with **scatter scheduling**:

```
start_test_batch(batch):
  1. Reload clients from clients.json
  2. Ping each client (parallel) — remove dead clients
  3. Get test list from Playwright (lib.get_list_of_tests)
  4. For each client:
       For each worker slot (client.workers, default 2):
         Schedule assign_test_to_client() with random delay [0, 500ms]

assign_test_to_client(batch, client):
  1. Find first test with status='pending'
  2. If found:
     a. Set test.status = 'running'
     b. Ping client — if dead, return test to 'pending', abandon slot
     c. POST to client: /run-test?test_file=...&test_name=...
     d. Receive compressed blob report
     e. Decompress with pbzip2
     f. Update test status from response header
     g. RECURSE: assign_test_to_client(batch, client)  ← work-stealing
  3. If no pending tests and no running tests:
     → post_process_tests(batch)  ← merge reports
  4. If no pending but some running:
     → Do nothing (other slots will finish)
```

Key properties:
- **Scatter scheduling**: Random delays (0-500ms) prevent all 24 worker slots from hitting the server simultaneously
- **Work-stealing**: Each slot recursively grabs the next pending test when done — faster clients naturally do more work
- **Fault tolerance**: Dead clients detected via ping; their tests return to pending state
- **No central dispatcher**: The server doesn't assign tests — workers pull them

## State Recovery

Both the test queue and pipeline state are persisted to disk as JSON:

### Test Queue (`test_queue.json`)

Written after every mutation (test added, status change, batch complete). On server restart:

```javascript
// routes.js startup
test_queue.forEach(batch => {
  if (batch.status === 'running') {
    batch.status = 'incorrect';
    batch.ended = now();
  }
});
```

### Pipeline State (`pipeline_runs.json`)

Written after every state change. On server restart:

```javascript
// pipeline.js loadState()
if (state.current?.status === 'running') {
  state.current.status = 'failed';
  state.current.error = 'Server restarted during execution';
  state.history.unshift(state.current);
  state.current = null;
}
```

This ensures no state is "stuck" — any interrupted run is marked as failed/incorrect and the system can accept new work immediately.

## Docker Swarm Deployment Model

### Stack Definition (`compose.swarm.yml`)

The Swarm stack contains four services:

| Service | Mode | Purpose |
|---------|------|---------|
| `minifarm-client` | `global` (1 per worker node) | Playwright test runner |
| `docker-registry` | `replicated` (1, manager only) | Private image registry |
| `portainer` | `replicated` (1, manager only) | Web management UI |
| `agent` | `global` (all nodes) | Portainer agent |

### Client Deployment Flow

```
1. docker build → minifarm-client:latest (on master)
2. docker tag  → 10.0.1.1:5000/minifarm-client:latest
3. docker push → Push to private registry
4. docker service update --image ... --force → Rolling update
   - parallelism: 3 (update 3 nodes at a time)
   - order: stop-first (required for host-mode ports)
   - failure_action: rollback
5. Poll: docker service ps ... | grep Running | wc -l
   - Wait until running count >= expected workers
```

### Why Host-Mode Ports

Clients use `mode: host` for port 3802 instead of Swarm's ingress routing. This is because:

1. The server needs to address specific clients by hostname (for test assignment)
2. Overlay network IPs are ephemeral and not predictable
3. Host-mode binds directly to the physical node's port, making clients addressable via `minifarm-client-N.local:3802`

### Why Static Client Config

The `clients.json` file maps client IDs to hostnames and MAC addresses. Dynamic registration was considered but rejected because:

- Docker overlay assigns `10.0.x.x` IPs that change on each deployment
- Clients behind the overlay can't reliably determine their "real" hostname
- Static config with mDNS (`.local`) is simple, predictable, and requires no service discovery infrastructure
- MAC addresses provide WoL (Wake-on-LAN) capability for power management

## Report Merging

After all tests in a batch complete:

```
1. Collect blob .zip files from each test's report directory
2. Copy all blobs into a single collection directory
   (prefixed with report dirname to avoid collisions)
3. Run: npx playwright merge-reports --reporter=html <blob-dir>
   → Produces unified HTML report in <report>_summary/
4. Create tar.bz2 archive of the summary for download
5. Clean up blob collection directory
6. Trigger client-side cleanup: POST /purge-leftovers to each client
```

The merge uses Playwright's native blob reporter format, which is designed for exactly this distributed use case — each worker produces a self-contained blob that can be merged into a single coherent report.
