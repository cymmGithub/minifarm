import fs from 'fs';
import path from 'path';
import {spawn} from 'child_process';
import {forEach} from 'hwp';
import md5File from 'md5-file';
import {executeAsync, sleep} from './shell.js';
import * as logger from './logger.js';
import config from './config.js';
import * as git from './git.js';

/**
 * Stop all apps with docker compose down
 * @param {object} log - Stage logger instance
 */
export async function stopAllApps(log = null) {
	if (log) {
		log.step('Stopping all apps...');
	} else {
		logger.step('Stopping all apps...');
	}
	await executeAsync('docker compose down --volumes', {cwd: config.DEVOPS_DIR});
}

/**
 * Get package-lock.json checksums for all apps in parallel
 * @param {string[]} apps - List of app names
 * @param {number} concurrency - Max concurrent operations
 * @returns {Promise<Map<string, string>>} Map of app name to MD5 checksum
 */
export async function getPackageLockChecksums(
	apps = config.APPS,
	concurrency = config.CONCURRENCY.PACKAGE_LOCK_CHECKSUMS
) {
	const checksums = new Map();

	async function* appIterator() {
		for (const app of apps) {
			yield app;
		}
	}

	await forEach(appIterator(), async (app) => {
		const packageLockPath = path.join(
			config.APPS_DIR,
			`app-${app}`,
			app,
			'package-lock.json'
		);
		try {
			const checksum = await md5File(packageLockPath);
			checksums.set(app, checksum);
		} catch (err) {
			checksums.set(app, null);
		}
	}, concurrency);

	// Also get artifacts checksum
	const artifactsPath = path.join(config.APPS_DIR, 'app-artifacts', 'package-lock.json');
	try {
		const checksum = await md5File(artifactsPath);
		checksums.set('artifacts', checksum);
	} catch (err) {
		checksums.set('artifacts', null);
	}

	return checksums;
}

/**
 * Update .env files for apps (copy from .env.example and apply replacements)
 * @param {string[]} appsToUpdate - List of apps to update
 * @param {number} concurrency - Max concurrent operations
 */
export async function updateEnvFiles(appsToUpdate, concurrency = config.CONCURRENCY.ENV_FILE_UPDATES) {
	async function* appIterator() {
		for (const app of appsToUpdate) {
			yield app;
		}
	}

	await forEach(appIterator(), async (app) => {
		const appDir = path.join(config.APPS_DIR, `app-${app}`, app);
		const envExamplePath = path.join(appDir, '.env.example');
		const envPath = path.join(appDir, '.env');

		if (!fs.existsSync(envExamplePath)) {
			return;
		}

		// Copy .env.example to .env
		fs.copyFileSync(envExamplePath, envPath);

		// Apply replacements
		let content = fs.readFileSync(envPath, 'utf8');
		for (const replacement of config.ENV_REPLACEMENTS) {
			content = content.replace(
				new RegExp(replacement.old.replace(/\./g, '\\.'), 'g'),
				replacement.new
			);
		}
		fs.writeFileSync(envPath, content);
	}, concurrency);

	// Always set up HQ for production mode
	const hqDir = path.join(config.APPS_DIR, 'app-hq', 'hq');
	const hqEnvExample = path.join(hqDir, '.env.example');
	const hqEnv = path.join(hqDir, '.env');

	if (fs.existsSync(hqEnvExample)) {
		fs.copyFileSync(hqEnvExample, hqEnv);
		let content = fs.readFileSync(hqEnv, 'utf8');
		for (const replacement of config.ENV_REPLACEMENTS) {
			content = content.replace(
				new RegExp(replacement.old.replace(/\./g, '\\.'), 'g'),
				replacement.new
			);
		}
		content = content.replace(/NODE_ENV=development/g, 'NODE_ENV=production');
		fs.writeFileSync(hqEnv, content);
	}
}

/**
 * Update standalone .env files (playwright, saml-test)
 * CRITICAL: Must be called BEFORE Docker build
 * @param {object} log - Stage logger instance
 */
export function updateStandaloneEnvs(log = null) {
	for (const dir of config.STANDALONE_ENV_DIRS) {
		const envExamplePath = path.join(dir, '.env.example');
		const envPath = path.join(dir, '.env');

		if (!fs.existsSync(envExamplePath)) {
			continue;
		}

		if (log) {
			log.step(`Updating .env in ${dir}...`);
		} else {
			logger.step(`Updating .env in ${dir}...`);
		}
		fs.copyFileSync(envExamplePath, envPath);

		let content = fs.readFileSync(envPath, 'utf8');
		content = content.replace(/app\.local/g, 'minifarm.local');
		content = content.replace(/TIMEOUT_IN_SECONDS=40/g, 'TIMEOUT_IN_SECONDS=128');
		content = content.replace(/MOBILE_APP_BASE_URL=http:\/\/localhost:8100/g, 'MOBILE_APP_BASE_URL=http://10.0.1.1:8100');
		fs.writeFileSync(envPath, content);
	}
}

/**
 * Write build.vars files for account and mtest
 */
export function writeBuildVars() {
	for (const app of config.BUILD_VARS_APPS) {
		const buildVarsPath = path.join(config.APPS_DIR, `app-${app}`, app, 'build.vars');
		fs.writeFileSync(buildVarsPath, 'COMMIT_TAG=MINIFARM\n');
	}
}

/**
 * Build HQ for production mode and restart via PM2
 * @param {object} log - Stage logger instance
 */
export async function buildHq(log = null) {
	if (log) {
		log.step('Building HQ for production mode...');
	} else {
		logger.step('Building HQ for production mode...');
	}

	// Run the build inside the container
	await executeAsync(
		'docker exec app-container-1 bash -c "cd /data/apps/local_hq && node ace build"'
	);

	// Restart HQ to pick up NODE_ENV=production
	await executeAsync('docker exec app-container-1 pm2 restart local_hq');
}

/**
 * Verify all PM2 apps are online
 * @param {object} log - Stage logger instance
 * @returns {Promise<boolean>} True if all apps are online
 */
export async function verifyAppsOnline(log = null) {
	try {
		const result = await executeAsync(
			'docker exec app-container-1 pm2 jlist',
			{silent: true}
		);

		const apps = JSON.parse(result.stdout);
		const notOnline = apps.filter(app => app.pm2_env?.status !== 'online');

		if (notOnline.length > 0) {
			logger.error('Some PM2 apps failed to start');
			await executeAsync('docker exec app-container-1 pm2 status');
			return false;
		}

		if (log) {
			log.info('All master apps online');
		} else {
			logger.info('All master apps online');
		}
		return true;
	} catch (err) {
		if (log) {
			log.warn('Could not verify PM2 status, proceeding anyway...');
		} else {
			logger.warn('Could not verify PM2 status, proceeding anyway...');
		}
		return true;
	}
}

/**
 * Deploy master applications
 * Full workflow: stop apps, checkout repos, update envs, build, start
 * @param {string} branch - Branch to deploy
 * @param {object} log - Stage logger instance
 * @returns {Promise<void>}
 */
export async function deployMasterApps(branch, log = null) {
	const startTime = process.hrtime.bigint();

	if (log) {
		log.step(`Starting deployment for branch: ${branch}`);
	} else {
		logger.info(`Running master apps deployment for branch: ${branch}`);
	}

	// Step 1: Stop all apps
	await stopAllApps(log);
	logTiming(startTime, 'Stopped all apps', log);

	// Step 2: Store package-lock checksums (for dependency change detection)
	if (log) log.step('Storing package-lock.json state...');
	const beforeChecksums = await getPackageLockChecksums();
	logTiming(startTime, 'Stored package-lock.json state', log);

	// Step 3: Store commit hashes
	if (log) log.step('Storing commit hashes...');
	const beforeHashes = await git.getCommitHashes();
	logTiming(startTime, 'Stored commit hashes', log);

	// Step 4: Checkout all repos (parallel with hwp)
	if (log) log.step('Checking out repos...');
	const checkoutResults = await git.checkoutAllRepos(branch, undefined, {}, log);
	logTiming(startTime, `Repos synced to ${branch}`, log);

	// Determine which apps changed
	const changedApps = [];
	for (const [repo, result] of checkoutResults) {
		if (result.changed) {
			if (repo === 'artifacts') {
				// If artifacts changed, all apps need restart
				changedApps.push(...config.APPS);
				break;
			} else if (config.APPS.includes(repo)) {
				changedApps.push(repo);
			}
		}
	}
	const appsToUpdate = [...new Set(changedApps)]; // Deduplicate

	// Step 5: Update .env files (parallel with hwp)
	if (log) log.step('Updating .env files...');
	await updateEnvFiles(appsToUpdate.length > 0 ? appsToUpdate : config.APPS);
	logTiming(startTime, '.envs copied and updated', log);

	// Step 6: Write build.vars files
	if (log) log.step('Writing build vars...');
	writeBuildVars();
	logTiming(startTime, 'Build vars done', log);

	// Step 7: Docker compose up with build
	if (log) {
		log.step('Starting docker compose up...');
	} else {
		logger.step('Starting docker compose up...');
	}
	await executeAsync('docker compose up -d --build', {cwd: config.DEVOPS_DIR});
	logTiming(startTime, 'Docker compose up', log);

	// Step 8: Build HQ for production and restart
	await buildHq(log);
	logTiming(startTime, 'HQ build and restart', log);

	// Step 9: Wait for PM2 warmup
	if (log) {
		log.step(`Waiting ${config.PM2_WARMUP_MS / 1000}s for PM2 warmup...`);
	} else {
		logger.info(`Giving PM2 ${config.PM2_WARMUP_MS / 1000}s to warm up...`);
	}
	await sleep(config.PM2_WARMUP_MS);

	// Step 10: Verify all apps are online
	const allOnline = await verifyAppsOnline(log);
	if (!allOnline) {
		throw new Error('Master app deployment failed - some apps not online');
	}

	const totalTime = Number(process.hrtime.bigint() - startTime) / 1e9;
	if (!log) {
		logger.timing('Master apps deployment', totalTime);
	}
}

/**
 * Log timing for a step
 * @param {bigint} startTime - Start time from hrtime.bigint()
 * @param {string} message - Message to log
 * @param {object} log - Stage logger instance
 */
function logTiming(startTime, message, log) {
	const elapsed = Number(process.hrtime.bigint() - startTime) / 1e9;
	if (!log) {
		logger.timing(message, elapsed);
	}
}

/**
 * Run AVA tests inside the apps container with streaming output
 * Returns success/failure status instead of throwing (non-blocking)
 * @param {object} log - Stage logger instance
 * @returns {Promise<{success: boolean}>} Result object
 */
export async function runAvaTests(log = null) {
	return new Promise((resolve) => {
		const child = spawn('docker', [
			'exec',
			'app-container-1',
			'bash',
			'-c',
			'cd /data/apps/tests/ava && npm test'
		], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let outputBuffer = '';
		let errorBuffer = '';

		child.stdout.on('data', (data) => {
			outputBuffer += data.toString();
			const lines = outputBuffer.split('\n');
			outputBuffer = lines.pop() || '';

			for (const line of lines) {
				if (line.trim()) {
					if (log) {
						log.info(line);
					} else {
						logger.info(line);
					}
				}
			}
		});

		child.stderr.on('data', (data) => {
			errorBuffer += data.toString();
			const lines = errorBuffer.split('\n');
			errorBuffer = lines.pop() || '';

			for (const line of lines) {
				if (line.trim()) {
					if (log) {
						log.info(line);
					} else {
						logger.info(line);
					}
				}
			}
		});

		child.on('close', (code) => {
			// Flush remaining buffers
			if (outputBuffer.trim()) {
				if (log) {
					log.info(outputBuffer.trim());
				} else {
					logger.info(outputBuffer.trim());
				}
			}
			if (errorBuffer.trim()) {
				if (log) {
					log.info(errorBuffer.trim());
				} else {
					logger.info(errorBuffer.trim());
				}
			}

			if (code === 0) {
				resolve({ success: true });
			} else {
				if (log) {
					log.error(`AVA tests failed with exit code ${code}`);
				} else {
					logger.error(`AVA tests failed with exit code ${code}`);
				}
				resolve({ success: false });
			}
		});

		child.on('error', (err) => {
			if (log) {
				log.error(`AVA tests error: ${err.message}`);
			} else {
				logger.error(`AVA tests error: ${err.message}`);
			}
			resolve({ success: false });
		});
	});
}

/**
 * Seed the database (cleanup/reset for Playwright tests)
 * Runs the full seed script inside the apps container
 * @param {object} log - Stage logger instance
 * @returns {Promise<{success: boolean}>} Result object
 */
export async function seedDatabase(log = null) {
	return new Promise((resolve) => {
		const child = spawn('docker', [
			'exec',
			'app-container-1',
			'bash',
			'-c',
			'cd /data/apps/local_account && npm run seed:full && pm2 start local_account'
		], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let outputBuffer = '';
		let errorBuffer = '';

		child.stdout.on('data', (data) => {
			outputBuffer += data.toString();
			const lines = outputBuffer.split('\n');
			outputBuffer = lines.pop() || '';

			for (const line of lines) {
				if (line.trim()) {
					if (log) {
						log.info(line);
					} else {
						logger.info(line);
					}
				}
			}
		});

		child.stderr.on('data', (data) => {
			errorBuffer += data.toString();
			const lines = errorBuffer.split('\n');
			errorBuffer = lines.pop() || '';

			for (const line of lines) {
				if (line.trim()) {
					if (log) {
						log.info(line);
					} else {
						logger.info(line);
					}
				}
			}
		});

		child.on('close', (code) => {
			// Flush remaining buffers
			if (outputBuffer.trim()) {
				if (log) {
					log.info(outputBuffer.trim());
				} else {
					logger.info(outputBuffer.trim());
				}
			}
			if (errorBuffer.trim()) {
				if (log) {
					log.info(errorBuffer.trim());
				} else {
					logger.info(errorBuffer.trim());
				}
			}

			if (code === 0) {
				resolve({ success: true });
			} else {
				if (log) {
					log.error(`Database seeding failed with exit code ${code}`);
				} else {
					logger.error(`Database seeding failed with exit code ${code}`);
				}
				resolve({ success: false });
			}
		});

		child.on('error', (err) => {
			if (log) {
				log.error(`Database seeding error: ${err.message}`);
			} else {
				logger.error(`Database seeding error: ${err.message}`);
			}
			resolve({ success: false });
		});
	});
}

/**
 * Run Japa tests inside the apps container with streaming output
 * Returns success/failure status instead of throwing (non-blocking)
 * @param {object} log - Stage logger instance
 * @returns {Promise<{success: boolean}>} Result object
 */
export async function runJapaTests(log = null) {
	return new Promise((resolve) => {
		const child = spawn('docker', [
			'exec',
			'app-container-1',
			'bash',
			'-c',
			'cd /data/apps/local_hq && node ace test'
		], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let outputBuffer = '';
		let errorBuffer = '';

		child.stdout.on('data', (data) => {
			outputBuffer += data.toString();
			const lines = outputBuffer.split('\n');
			outputBuffer = lines.pop() || '';

			for (const line of lines) {
				if (line.trim()) {
					if (log) {
						log.info(line);
					} else {
						logger.info(line);
					}
				}
			}
		});

		child.stderr.on('data', (data) => {
			errorBuffer += data.toString();
			const lines = errorBuffer.split('\n');
			errorBuffer = lines.pop() || '';

			for (const line of lines) {
				if (line.trim()) {
					if (log) {
						log.info(line);
					} else {
						logger.info(line);
					}
				}
			}
		});

		child.on('close', (code) => {
			// Flush remaining buffers
			if (outputBuffer.trim()) {
				if (log) {
					log.info(outputBuffer.trim());
				} else {
					logger.info(outputBuffer.trim());
				}
			}
			if (errorBuffer.trim()) {
				if (log) {
					log.info(errorBuffer.trim());
				} else {
					logger.info(errorBuffer.trim());
				}
			}

			if (code === 0) {
				resolve({ success: true });
			} else {
				if (log) {
					log.error(`Japa tests failed with exit code ${code}`);
				} else {
					logger.error(`Japa tests failed with exit code ${code}`);
				}
				resolve({ success: false });
			}
		});

		child.on('error', (err) => {
			if (log) {
				log.error(`Japa tests error: ${err.message}`);
			} else {
				logger.error(`Japa tests error: ${err.message}`);
			}
			resolve({ success: false });
		});
	});
}

export default {
	stopAllApps,
	getPackageLockChecksums,
	updateEnvFiles,
	updateStandaloneEnvs,
	writeBuildVars,
	buildHq,
	verifyAppsOnline,
	deployMasterApps,
	runAvaTests,
	seedDatabase,
	runJapaTests,
};
