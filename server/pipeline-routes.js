const path = require('path');
const { executeAsync } = require('./shell-utils');
const pipeline = require('./pipeline');

const CODE_ROOT = path.resolve(__dirname, '../..');
const DEVOPS_APPS = path.join(CODE_ROOT, 'devops/apps');

const REPOS = [
  // Repos that fallback to 'master'
  { name: 'saml-test', path: path.join(CODE_ROOT, 'saml-test'), fallback: 'master' },
  { name: 'devops', path: path.join(CODE_ROOT, 'devops'), fallback: 'master' },
  // Repos that fallback to 'develop'
  { name: 'tests', path: path.join(CODE_ROOT, 'tests'), fallback: 'develop' },
  { name: 'app-account', path: path.join(DEVOPS_APPS, 'app-account'), fallback: 'develop' },
  { name: 'app-artifacts', path: path.join(DEVOPS_APPS, 'app-artifacts'), fallback: 'develop' },
  { name: 'app-clinicians', path: path.join(DEVOPS_APPS, 'app-clinicians'), fallback: 'develop' },
  { name: 'app-hq', path: path.join(DEVOPS_APPS, 'app-hq'), fallback: 'develop' },
  { name: 'app-mobile2', path: path.join(DEVOPS_APPS, 'app-mobile2'), fallback: 'develop' },
  { name: 'app-mtest', path: path.join(DEVOPS_APPS, 'app-mtest'), fallback: 'develop' },
  { name: 'app-office', path: path.join(DEVOPS_APPS, 'app-office'), fallback: 'develop' },
  { name: 'app-pdf-generator', path: path.join(DEVOPS_APPS, 'app-pdf-generator'), fallback: 'develop' },
  { name: 'app-queue', path: path.join(DEVOPS_APPS, 'app-queue'), fallback: 'develop' },
];

const CONCURRENCY = 6; // Number of parallel git operations

/**
 * Sanitize branch name to prevent command injection
 * Allow only alphanumeric, dash, underscore, slash, dot
 */
function sanitizeBranch(branch) {
  return branch.replace(/[^a-zA-Z0-9\-_\/\.]/g, '');
}

/**
 * Resolve branch for a single repo with fallback
 */
async function resolveBranchForRepo(repo, safeBranch) {
  try {
    await executeAsync('git fetch --prune', { cwd: repo.path });

    // Try the requested branch first
    const result = await executeAsync(
      `git branch -r | grep -F --max-count 1 "${safeBranch}"`,
      { cwd: repo.path, noCheck: true }
    );

    if (result.code === 0 && result.stdout.trim()) {
      return {
        repo: repo.name,
        branch: result.stdout.replace('origin/', '').trim(),
        usedFallback: false,
      };
    }

    // Fallback to default branch
    const fallbackResult = await executeAsync(
      `git branch -r | grep -F --max-count 1 "${repo.fallback}"`,
      { cwd: repo.path, noCheck: true }
    );

    if (fallbackResult.code === 0 && fallbackResult.stdout.trim()) {
      return {
        repo: repo.name,
        branch: fallbackResult.stdout.replace('origin/', '').trim(),
        usedFallback: true,
      };
    }

    return { repo: repo.name, branch: null, error: 'No branch found' };
  } catch (e) {
    return { repo: repo.name, branch: null, error: e.message };
  }
}

/**
 * Resolve branches for all repos in parallel using hwp
 */
async function resolveAllBranches(safeBranch) {
  const { map } = await import('hwp');

  async function* repoIterator() {
    for (const repo of REPOS) {
      yield repo;
    }
  }

  return map(repoIterator(), (repo) => resolveBranchForRepo(repo, safeBranch), CONCURRENCY);
}

/**
 * Validate branch exists on remote
 */
async function validateBranch(req, res) {
  const { branch } = req.body;

  if (!branch || typeof branch !== 'string') {
    return res.status(400).json({ valid: false, message: 'Branch name required' });
  }

  try {
    const safeBranch = sanitizeBranch(branch);
    const results = await resolveAllBranches(safeBranch);

    // Check if any repo has the branch (not using fallback)
    const directMatches = results.filter(r => r.branch && !r.usedFallback);
    const foundInAny = directMatches.length > 0;
    const allResolved = results.every(r => r.branch);
    const resolvedBranch = foundInAny ? directMatches[0].branch : null;

    return res.json({
      valid: foundInAny,
      resolvedBranch,
      repos: results,
      message: foundInAny
        ? `${resolvedBranch} in (${directMatches.length} repos)`
        : 'Branch not found',
    });
  } catch (error) {
    return res.status(500).json({
      valid: false,
      resolvedBranch: null,
      message: error.message,
    });
  }
}

/**
 * Start a new pipeline run
 */
async function startPipeline(req, res) {
  const { branch, requester, workers } = req.body;

  if (!branch || !requester) {
    return res.status(400).json({ error: 'Branch and requester required' });
  }

  try {
    const safeBranch = sanitizeBranch(branch);
    const results = await resolveAllBranches(safeBranch);

    // Check if any repo has the branch (not using fallback)
    const directMatches = results.filter(r => r.branch && !r.usedFallback);
    const foundInAny = directMatches.length > 0;
    const allResolved = results.every(r => r.branch);
    const resolvedBranch = foundInAny ? directMatches[0].branch : safeBranch;

    if (!foundInAny && !allResolved) {
      return res.status(400).json({ error: 'Branch not found on remote' });
    }

    // Queue the run with per-repo branch resolution
    const run = pipeline.queueRun(branch, resolvedBranch, requester, workers, results);

    // Try to start immediately if nothing running
    pipeline.startNextRun();

    return res.status(202).json(run);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

/**
 * Cancel a pipeline run
 */
function cancelPipeline(req, res) {
  const { runId } = req.params;

  if (!runId) {
    return res.status(400).json({ error: 'Run ID required' });
  }

  const result = pipeline.cancelRun(runId);

  if (result.success) {
    return res.json({ success: true, message: `Run ${result.was} cancelled` });
  }

  return res.status(404).json({ error: result.error });
}

/**
 * Get pipeline state (current + queue)
 */
function getPipelineState(req, res) {
  res.json(pipeline.getState());
}

/**
 * Get pipeline history
 */
function getPipelineHistory(req, res) {
  const limit = parseInt(req.query.limit, 10) || 50;
  res.json(pipeline.getHistory(limit));
}

/**
 * SSE endpoint for real-time updates
 */
function pipelineStream(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial state
  const state = pipeline.getState();
  res.write(`event: queue\ndata: ${JSON.stringify({ current: state.current, queue: state.queue })}\n\n`);

  // Event handlers
  const handlers = {
    'run:started': (data) => res.write(`event: run:started\ndata: ${JSON.stringify(data)}\n\n`),
    'run:complete': (data) => res.write(`event: run:complete\ndata: ${JSON.stringify(data)}\n\n`),
    'run:failed': (data) => res.write(`event: run:failed\ndata: ${JSON.stringify(data)}\n\n`),
    'run:cancelled': (data) => res.write(`event: run:cancelled\ndata: ${JSON.stringify(data)}\n\n`),
    'stage:started': (data) => res.write(`event: stage:started\ndata: ${JSON.stringify(data)}\n\n`),
    'stage:complete': (data) => res.write(`event: stage:complete\ndata: ${JSON.stringify(data)}\n\n`),
    'stage:failed': (data) => res.write(`event: stage:failed\ndata: ${JSON.stringify(data)}\n\n`),
    'log': (data) => res.write(`event: log\ndata: ${JSON.stringify(data)}\n\n`),
    'queue:updated': (data) => res.write(`event: queue\ndata: ${JSON.stringify(data)}\n\n`),
  };

  // Register handlers
  for (const [event, handler] of Object.entries(handlers)) {
    pipeline.pipelineEvents.on(event, handler);
  }

  // Cleanup on disconnect
  req.on('close', () => {
    for (const [event, handler] of Object.entries(handlers)) {
      pipeline.pipelineEvents.off(event, handler);
    }
  });
}

module.exports = {
  validateBranch,
  startPipeline,
  cancelPipeline,
  getPipelineState,
  getPipelineHistory,
  pipelineStream,
};
