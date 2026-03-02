import path from 'path';
import {forEach} from 'hwp';
import {executeAsync} from './shell.js';
import * as logger from './logger.js';
import config from './config.js';

/**
 * Get the current commit hash for a repository
 * @param {string} repoPath - Path to the repository
 * @returns {Promise<string>} Commit hash
 */
export async function getCommitHash(repoPath) {
	const result = await executeAsync(`git -C ${repoPath} rev-parse HEAD`, {silent: true});
	return result.stdout.trim();
}

/**
 * Get the current branch name for a repository
 * @param {string} repoPath - Path to the repository
 * @returns {Promise<string>} Branch name
 */
export async function getCurrentBranch(repoPath) {
	const result = await executeAsync(`git -C ${repoPath} rev-parse --abbrev-ref HEAD`, {silent: true});
	return result.stdout.trim();
}

/**
 * Check if a branch exists on remote
 * @param {string} repoPath - Path to the repository
 * @param {string} branch - Branch name to check
 * @returns {Promise<string|null>} Branch name if found, null otherwise
 */
export async function findRemoteBranch(repoPath, branch) {
	const result = await executeAsync(
		`git -C ${repoPath} branch -r | grep -F --max-count 1 ${branch}`,
		{silent: true, noCheck: true}
	);
	if (result.code === 0 && result.stdout.trim()) {
		return result.stdout.replace('origin/', '').trim();
	}
	return null;
}

/**
 * Checkout a single repository to a branch (with fallback to develop)
 * @param {string} repo - Repository name (e.g., 'account')
 * @param {string} branch - Target branch name
 * @param {string} baseDir - Base directory for repositories
 * @param {object} log - Stage logger instance
 * @returns {Promise<object>} Result with repo, branch, previousHash, currentHash, changed
 */
export async function checkoutRepo(repo, branch, baseDir = config.APPS_DIR, log = null) {
	const repoPath = path.join(baseDir, `app-${repo}`);

	// Fetch latest
	await executeAsync(`git -C ${repoPath} fetch`, {silent: true});

	// Get current state
	const currentBranch = await getCurrentBranch(repoPath);
	const previousHash = await getCommitHash(repoPath);

	// Find target branch (fallback to develop)
	const targetBranch = await findRemoteBranch(repoPath, branch) || 'develop';

	let message = `${repo} is on branch ${currentBranch}, required branch matching \`${branch}\`, `;

	// Switch branch if needed
	if (currentBranch !== targetBranch) {
		message += targetBranch.includes(branch) ? 'switching, ' : 'non-existent, switching to develop, ';
		await executeAsync(`git -C ${repoPath} checkout ${targetBranch}`, {silent: true, noCheck: true});
	} else {
		message += 'staying, ';
	}

	// Reset to remote
	await executeAsync(`git -C ${repoPath} reset --hard origin/${targetBranch}`, {silent: true});

	// Get new commit hash
	const currentHash = await getCommitHash(repoPath);
	const changed = previousHash !== currentHash;

	if (changed) {
		message += `moved from ${previousHash.substring(0, 7)} to ${currentHash.substring(0, 7)}`;
	} else {
		message += 'no changes';
	}

	if (log) {
		log.step(message);
	} else {
		console.log(message);
	}

	return {
		repo,
		branch: targetBranch,
		previousHash,
		currentHash,
		changed,
	};
}

/**
 * Checkout multiple repositories in parallel using hwp
 * @param {string} branch - Target branch name
 * @param {string[]} repos - List of repository names
 * @param {object} options - Options
 * @param {number} options.concurrency - Max concurrent checkouts
 * @param {string} options.baseDir - Base directory for repositories
 * @param {object} log - Stage logger instance
 * @returns {Promise<Map<string, object>>} Map of repo name to checkout result
 */
export async function checkoutAllRepos(branch, repos = config.REPOS, {
	concurrency = config.CONCURRENCY.REPO_CHECKOUT,
	baseDir = config.APPS_DIR,
} = {}, log = null) {
	const results = new Map();

	async function* repoIterator() {
		for (const repo of repos) {
			yield repo;
		}
	}

	await forEach(repoIterator(), async (repo) => {
		const result = await checkoutRepo(repo, branch, baseDir, log);
		results.set(repo, result);
	}, concurrency);

	return results;
}

/**
 * Get commit hashes for all repositories in parallel
 * @param {string[]} repos - List of repository names
 * @param {object} options - Options
 * @param {number} options.concurrency - Max concurrent operations
 * @param {string} options.baseDir - Base directory for repositories
 * @returns {Promise<Map<string, string>>} Map of repo name to commit hash
 */
export async function getCommitHashes(repos = config.REPOS, {
	concurrency = config.CONCURRENCY.PACKAGE_LOCK_CHECKSUMS,
	baseDir = config.APPS_DIR,
} = {}) {
	const hashes = new Map();

	async function* repoIterator() {
		for (const repo of repos) {
			yield repo;
		}
	}

	await forEach(repoIterator(), async (repo) => {
		const repoPath = path.join(baseDir, `app-${repo}`);
		const hash = await getCommitHash(repoPath);
		hashes.set(repo, hash);
	}, concurrency);

	return hashes;
}

/**
 * Get list of repos that changed between two hash maps
 * @param {Map<string, string>} beforeHashes - Before commit hashes
 * @param {Map<string, string>} afterHashes - After commit hashes
 * @returns {string[]} List of changed repo names
 */
export function getChangedRepos(beforeHashes, afterHashes) {
	const changed = [];
	for (const [repo, afterHash] of afterHashes) {
		const beforeHash = beforeHashes.get(repo);
		if (beforeHash !== afterHash) {
			changed.push(repo);
		}
	}
	return changed;
}

/**
 * Checkout tests repository to a branch
 * @param {string} branch - Target branch name
 * @param {object} log - Stage logger instance
 * @returns {Promise<string>} Branch that was checked out (may be develop if branch not found)
 */
export async function checkoutTests(branch, log = null) {
	const repoPath = path.join(config.CODE_DIR, 'tests');

	if (log) {
		log.step('Fetching latest...');
	} else {
		logger.step('Checking out tests repo...');
	}

	await executeAsync(`git fetch origin`, {cwd: repoPath, silent: true});

	// Check if branch exists on remote
	const result = await executeAsync(
		`git ls-remote --heads origin ${branch}`,
		{cwd: repoPath, silent: true, noCheck: true}
	);

	const branchExists = result.stdout.includes(branch);
	const targetBranch = branchExists ? branch : 'develop';

	if (!branchExists) {
		if (log) {
			log.warn(`Branch ${branch} not found, using develop`);
		} else {
			logger.warn(`Branch ${branch} not found, using develop`);
		}
	}

	// Checkout and reset
	await executeAsync(
		`git checkout ${targetBranch}`,
		{cwd: repoPath, silent: true, noCheck: true}
	);
	await executeAsync(
		`git reset --hard origin/${targetBranch}`,
		{cwd: repoPath, silent: true}
	);

	if (log) {
		log.info(`Checked out: ${targetBranch}`);
	} else {
		logger.info(`Checked out branch: ${targetBranch}`);
	}
	return targetBranch;
}

export default {
	getCommitHash,
	getCurrentBranch,
	findRemoteBranch,
	checkoutRepo,
	checkoutAllRepos,
	getCommitHashes,
	getChangedRepos,
	checkoutTests,
};
