const { spawn } = require('child_process');
const path = require('path');
const pipeline = require('./pipeline');

// Path to minifarm.js
// Default assumes standard code directory layout: /code/devops/minifarm
const MINIFARM_DIR = process.env.MINIFARM_DIR || '/opt/code/devops/minifarm';
const MINIFARM_SCRIPT = path.join(MINIFARM_DIR, 'minifarm.js');

// Track running processes for cancellation
const runningProcesses = new Map();

// Valid stage names that can appear in [stage] prefix
const VALID_STAGES = new Set([
  'client-deployment',
  'master-apps',
  'ava-tests',
  'japa-tests',
  'db-reseed',
  'playwright-tests',
]);

// Stage order for determining completion
const STAGE_ORDER = [
  'client-deployment',
  'master-apps',
  'japa-tests',
  'ava-tests',
  'db-reseed',
  'playwright-tests',
];

/**
 * Parse a log line to extract stage from [stage] prefix
 * Returns { stage, message } or null if no stage prefix found
 */
function parseLogLine(line) {
  const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (match) {
    const stage = match[1];
    const message = match[2];
    if (VALID_STAGES.has(stage)) {
      return { stage, message };
    }
  }
  return null;
}

// Messages that indicate stage completion (exact or prefix match)
const COMPLETION_MESSAGES = new Set(['complete', 'tests complete!', 'failed']);

/**
 * Check if a message indicates stage completion (success or failure)
 */
function isStageComplete(message) {
  const lower = message.toLowerCase();
  // Exact match for known messages OR starts with 'complete'/'failed'
  return COMPLETION_MESSAGES.has(lower) ||
         lower.startsWith('complete') ||
         lower.startsWith('failed');
}

/**
 * Check if a message indicates stage failure
 */
function isStageFailed(message) {
  return message.toLowerCase().startsWith('failed');
}

/**
 * Strip ANSI escape codes from text
 */
function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

/**
 * Execute a pipeline run
 */
function executeRun(run) {
  const { id: runId, resolvedBranch, requester, workers } = run;

  console.log(`[Pipeline Executor] Starting run ${runId}: branch=${resolvedBranch}, requester=${requester}, workers=${workers}`);

  // Track stage states
  const startedStages = new Set();
  const completedStages = new Set();
  let currentLogStage = null; // Track which stage to attribute untagged logs to

  // Spawn minifarm.js test (use process.execPath for full node path in pm2)
  const child = spawn(process.execPath, [MINIFARM_SCRIPT, 'test', resolvedBranch, requester], {
    cwd: MINIFARM_DIR,
    env: {
      ...process.env,
      FORCE_COLOR: '0', // Disable colors for easier parsing
      MINIFARM_WORKERS: String(workers || 12),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  runningProcesses.set(runId, child);

  let outputBuffer = '';

  // Handle stdout
  child.stdout.on('data', (data) => {
    const text = stripAnsi(data.toString());
    outputBuffer += text;

    // Process line by line
    const lines = outputBuffer.split('\n');
    outputBuffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      const parsed = parseLogLine(line.trim());

      if (parsed) {
        const { stage, message } = parsed;

        // Start the stage if not already started
        if (!startedStages.has(stage)) {
          startedStages.add(stage);
          pipeline.updateStage(runId, stage, 'running');
          console.log(`[Pipeline Executor] Stage ${stage} started`);

          // Mark previous sequential stages as complete if they're still running
          // (handles the case where client-deployment and master-apps run in parallel)
          for (const prevStage of STAGE_ORDER) {
            if (prevStage === stage) break;
            // Auto-complete deployment stages when playwright-tests starts
            if ((prevStage === 'client-deployment' || prevStage === 'master-apps' || prevStage === 'japa-tests' || prevStage === 'ava-tests' || prevStage === 'db-reseed') && stage === 'playwright-tests') {
              if (startedStages.has(prevStage) && !completedStages.has(prevStage)) {
                completedStages.add(prevStage);
                pipeline.updateStage(runId, prevStage, 'complete');
                console.log(`[Pipeline Executor] Stage ${prevStage} auto-completed (tests started)`);
              }
            }
          }
        }

        currentLogStage = stage;

        // Check for stage completion (success or failure)
        if (isStageComplete(message)) {
          const failed = isStageFailed(message);

          // Allow failure to override previous completion
          if (!completedStages.has(stage) || failed) {
            completedStages.add(stage);
            if (failed) {
              pipeline.updateStage(runId, stage, 'failed');
              console.log(`[Pipeline Executor] Stage ${stage} failed`);
            } else {
              pipeline.updateStage(runId, stage, 'complete');
              console.log(`[Pipeline Executor] Stage ${stage} completed`);
            }
          }
        }

        // Add log to the stage
        pipeline.addLog(runId, stage, message);
        console.log(`[Pipeline ${runId}] [${stage}] ${message}`);
      } else {
        // No stage prefix - log to current stage or ignore
        if (currentLogStage) {
          pipeline.addLog(runId, currentLogStage, line.trim());
        }
        console.log(`[Pipeline ${runId}] ${line.trim()}`);
      }
    }
  });

  // Handle stderr
  child.stderr.on('data', (data) => {
    const text = stripAnsi(data.toString());
    const lines = text.split('\n').filter(l => l.trim());
    for (const line of lines) {
      if (currentLogStage) {
        pipeline.addLog(runId, currentLogStage, `[stderr] ${line.trim()}`);
      }
      console.error(`[Pipeline ${runId}] ${line.trim()}`);
    }
  });

  // Handle process exit
  child.on('close', (code) => {
    runningProcesses.delete(runId);

    // Process any remaining buffer
    if (outputBuffer.trim()) {
      const parsed = parseLogLine(outputBuffer.trim());
      if (parsed) {
        pipeline.addLog(runId, parsed.stage, parsed.message);
      } else if (currentLogStage) {
        pipeline.addLog(runId, currentLogStage, outputBuffer.trim());
      }
    }

    if (code === 0) {
      // Mark all stages as complete
      for (const stage of STAGE_ORDER) {
        if (!completedStages.has(stage)) {
          pipeline.updateStage(runId, stage, 'complete');
        }
      }
      console.log(`[Pipeline Executor] Run ${runId} completed successfully`);
      pipeline.completeRun(runId);
    } else {
      // Find which stage(s) are still running and mark as failed
      for (const stage of STAGE_ORDER) {
        if (startedStages.has(stage) && !completedStages.has(stage)) {
          pipeline.updateStage(runId, stage, 'failed');
        }
      }
      console.error(`[Pipeline Executor] Run ${runId} failed with code ${code}`);
      pipeline.failRun(runId, `Process exited with code ${code}`);
    }
  });

  // Handle process errors
  child.on('error', (err) => {
    runningProcesses.delete(runId);
    console.error(`[Pipeline Executor] Run ${runId} error: ${err.message}`);
    // Mark all started but not completed stages as failed
    for (const stage of STAGE_ORDER) {
      if (startedStages.has(stage) && !completedStages.has(stage)) {
        pipeline.updateStage(runId, stage, 'failed');
      }
    }
    pipeline.failRun(runId, err.message);
  });

  return child;
}

/**
 * Cancel a running process
 */
function cancelProcess(runId) {
  const child = runningProcesses.get(runId);
  if (child) {
    console.log(`[Pipeline Executor] Cancelling run ${runId}`);
    child.kill('SIGTERM');

    // Force kill after 5 seconds if still running
    setTimeout(() => {
      if (runningProcesses.has(runId)) {
        console.log(`[Pipeline Executor] Force killing run ${runId}`);
        child.kill('SIGKILL');
      }
    }, 5000);

    return true;
  }
  return false;
}

// Listen for run:started events to execute
pipeline.pipelineEvents.on('run:started', (run) => {
  executeRun(run);
});

// Listen for cancellation requests
pipeline.pipelineEvents.on('cancel:requested', (runId) => {
  const killed = cancelProcess(runId);
  if (killed) {
    // Mark all running stages as cancelled
    const state = pipeline.getState();
    if (state.current?.id === runId) {
      for (const stage of STAGE_ORDER) {
        if (state.current.stages[stage].status === 'running') {
          pipeline.updateStage(runId, stage, 'cancelled');
        }
      }
    }
    // Complete the cancellation (moves to history)
    pipeline.completeCancellation(runId);
  }
});

console.log(`[Pipeline Executor] Initialized. MINIFARM_DIR=${MINIFARM_DIR}`);

module.exports = {
  executeRun,
  cancelProcess,
};
