const fs = require('fs');
const EventEmitter = require('events');

// Event emitter for SSE broadcasts
const pipelineEvents = new EventEmitter();

// Storage file path
const PIPELINE_FILE = process.env.PATH_TO_PIPELINE_FILE || 'pipeline_runs.json';

// In-memory state
let state = {
  current: null,
  queue: [],
  history: [],
};

// Load state from disk
function loadState() {
  try {
    const data = fs.readFileSync(PIPELINE_FILE, 'utf8');
    state = JSON.parse(data);
    // Reset any "running" state to "failed" on startup (crash recovery)
    if (state.current && state.current.status === 'running') {
      state.current.status = 'failed';
      state.current.error = 'Server restarted during execution';
      state.current.completedAt = new Date().toISOString();
      state.history.unshift(state.current);
      state.current = null;
      saveState();
    }
  } catch (err) {
    console.log(`Pipeline state file not found, initializing empty state`);
    state = { current: null, queue: [], history: [] };
    saveState();
  }
}

// Save state to disk
function saveState() {
  fs.writeFileSync(PIPELINE_FILE, JSON.stringify(state, null, 2));
}

// Generate unique run ID
function generateRunId() {
  return `run-${Date.now()}`;
}

// Create initial stage states
function createInitialStages() {
  return {
    'client-deployment': { status: 'pending', logs: [] },
    'master-apps': { status: 'pending', logs: [] },
    'japa-tests': { status: 'pending', logs: [] },
    'ava-tests': { status: 'pending', logs: [] },
    'db-reseed': { status: 'pending', logs: [] },
    'playwright-tests': { status: 'pending', logs: [] },
  };
}

// Get current state
function getState() {
  return { ...state };
}

// Get history (most recent first, limited)
function getHistory(limit = 50) {
  return state.history.slice(0, limit);
}

// Add a new run to queue
function queueRun(branch, resolvedBranch, requester, workers = null, repos = null) {
  const run = {
    id: generateRunId(),
    branch,
    resolvedBranch,
    requester,
    workers: workers || 12, // Default to 12 workers
    repos, // Per-repo branch resolution results
    status: 'queued',
    queuedAt: new Date().toISOString(),
    stages: createInitialStages(),
  };

  state.queue.push(run);
  saveState();
  broadcastQueueUpdate();

  return run;
}

// Start the next queued run (if no current run)
function startNextRun() {
  if (state.current || state.queue.length === 0) {
    return null;
  }

  state.current = state.queue.shift();
  state.current.status = 'running';
  state.current.startedAt = new Date().toISOString();
  saveState();

  pipelineEvents.emit('run:started', state.current);
  broadcastQueueUpdate();

  return state.current;
}

// Update stage status
function updateStage(runId, stage, status, message = null) {
  const run = state.current?.id === runId ? state.current : null;
  if (!run) return;

  const stageState = run.stages[stage];
  stageState.status = status;

  if (status === 'running' && !stageState.startedAt) {
    stageState.startedAt = new Date().toISOString();
  }
  if (status === 'complete' || status === 'failed') {
    stageState.completedAt = new Date().toISOString();
  }

  saveState();
  pipelineEvents.emit(`stage:${status === 'running' ? 'started' : status}`, { runId, stage, status });
}

// Add log to stage (no deduplication - simple pass-through)
function addLog(runId, stage, message) {
  const run = state.current?.id === runId ? state.current : null;
  if (!run) return;

  // Simply add the log and emit
  run.stages[stage].logs.push(message);
  pipelineEvents.emit('log', { runId, stage, message, timestamp: new Date().toISOString() });
}

// Complete a run
function completeRun(runId, reportUrl = null) {
  if (state.current?.id !== runId) return;

  const run = state.current;
  run.status = 'finished';
  run.completedAt = new Date().toISOString();
  run.duration = Math.round((new Date(run.completedAt) - new Date(run.startedAt)) / 1000);
  run.reportUrl = reportUrl;

  state.history.unshift(run);
  state.current = null;
  saveState();

  pipelineEvents.emit('run:complete', run);
  broadcastQueueUpdate();

  // Auto-start next
  startNextRun();
}

// Fail a run
function failRun(runId, error) {
  if (state.current?.id !== runId) return;

  const run = state.current;
  run.status = 'failed';
  run.completedAt = new Date().toISOString();
  run.duration = Math.round((new Date(run.completedAt) - new Date(run.startedAt)) / 1000);
  run.error = error;

  state.history.unshift(run);
  state.current = null;
  saveState();

  pipelineEvents.emit('run:failed', run);
  broadcastQueueUpdate();

  // Auto-start next
  startNextRun();
}

// Cancel a run (queued or current)
function cancelRun(runId) {
  // Check queue first
  const queueIndex = state.queue.findIndex(r => r.id === runId);
  if (queueIndex !== -1) {
    const run = state.queue.splice(queueIndex, 1)[0];
    run.status = 'cancelled';
    run.completedAt = new Date().toISOString();
    state.history.unshift(run);
    saveState();
    pipelineEvents.emit('run:cancelled', run);
    broadcastQueueUpdate();
    return { success: true, was: 'queued' };
  }

  // Check current
  if (state.current?.id === runId) {
    // Signal cancellation - actual cancellation happens in pipeline executor
    pipelineEvents.emit('cancel:requested', runId);
    return { success: true, was: 'running' };
  }

  return { success: false, error: 'Run not found' };
}

// Complete cancellation of current run (called by executor after killing process)
function completeCancellation(runId) {
  if (state.current?.id !== runId) return;

  const run = state.current;
  run.status = 'cancelled';
  run.completedAt = new Date().toISOString();
  run.duration = Math.round((new Date(run.completedAt) - new Date(run.startedAt)) / 1000);

  state.history.unshift(run);
  state.current = null;
  saveState();

  pipelineEvents.emit('run:cancelled', run);
  broadcastQueueUpdate();

  // Auto-start next
  startNextRun();
}

// Broadcast queue update
function broadcastQueueUpdate() {
  pipelineEvents.emit('queue:updated', {
    current: state.current,
    queue: state.queue,
  });
}

// Initialize on module load
loadState();

module.exports = {
  pipelineEvents,
  getState,
  getHistory,
  queueRun,
  startNextRun,
  updateStage,
  addLog,
  completeRun,
  failRun,
  cancelRun,
  completeCancellation,
  broadcastQueueUpdate,
};
