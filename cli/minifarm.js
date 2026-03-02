#!/usr/bin/env node

import crypto from 'crypto';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import {forEach} from 'hwp';

import config from './lib/config.js';
import * as logger from './lib/logger.js';
import * as stageLogger from './lib/stage-logger.js';
import * as docker from './lib/docker.js';
import * as git from './lib/git.js';
import * as apps from './lib/apps.js';
import * as testing from './lib/testing.js';
import {setVerbose} from './lib/shell.js';

// Generate a short random ID for grouping test batches
const generateRunId = () => crypto.randomBytes(5).toString('hex');

/**
 * Run full test workflow (parallelized)
 *
 * Two independent pipelines run in parallel:
 *   Pipeline 1 - Client deployment:
 *     checkout tests -> build image -> update swarm -> wait for clients -> prune
 *
 *   Pipeline 2 - Master apps + backend tests:
 *     deploy master apps -> run Japa/AVA tests (in parallel) -> reseed database
 *
 * Playwright tests start only after BOTH pipelines complete successfully.
 */
async function cmdTest(taskId, requester, verbose) {
	docker.checkSwarm();
	setVerbose(verbose);

	console.log(`[main] Minifarm Test Run - Task: ${taskId} | Requester: ${requester}`);

	// Run both deployments in parallel using Promise.all
	const clientLog = stageLogger.clientDeployment;
	const masterLog = stageLogger.masterApps;
	const avaLog = stageLogger.avaTests;
	const japaLog = stageLogger.japaTests;
	const reseedLog = stageLogger.dbReseed;

	const deploymentPromises = [
		// Client deployment pipeline
		(async () => {
			// Step 1: Checkout tests repo to task branch
			clientLog.step('Checking out tests repo...');
			await git.checkoutTests(taskId, clientLog);

			// Step 2: Update standalone .env files BEFORE Docker build
			clientLog.step('Updating standalone .env files...');
			apps.updateStandaloneEnvs(clientLog);

			// Step 3: Build and push client image (always use :latest tag)
			clientLog.step('Building client image...');
			await docker.buildAndPush('latest', clientLog);

			// Step 4: Update Swarm service (always use :latest)
			clientLog.step('Updating Swarm service...');
			await docker.updateSwarmService('latest', clientLog);

			// Step 5: Wait for clients to register
			clientLog.step('Waiting for clients...');
			await docker.waitForClients(clientLog);

			// Step 6: Clean up unused Docker resources on clients
			clientLog.step('Cleaning up unused Docker resources...');
			await docker.systemPrune(clientLog);

			clientLog.step('Complete');
		})(),

		// Master apps + Japa/AVA + Reseed pipeline
		(async () => {
			// Deploy master apps
			await apps.deployMasterApps(taskId, masterLog);
			masterLog.step('Complete');

			// const testSuites = [
			// 	{ name: 'japa', run: apps.runJapaTests, log: japaLog },
			// 	{ name: 'ava', run: apps.runAvaTests, log: avaLog },
			// ];

			// await forEach(testSuites, async (suite) => {
			// 	const result = await suite.run(suite.log);
			// 	if (result.success) {
			// 		suite.log.step('Complete');
			// 	} else {
			// 		suite.log.step('Failed');
			// 	}
			// }, 1); // 1 sequentially, 2 in parallel

			// Reseed database (cleanup for Playwright)
			reseedLog.step('Reseeding database...');
			await apps.seedDatabase(reseedLog);
			reseedLog.step('Complete');
		})(),
	];

	// Wait for both pipelines, capturing any errors
	const results = await Promise.allSettled(deploymentPromises);

	// Check for errors from parallel pipelines
	for (const result of results) {
		if (result.status === 'rejected') {
			throw result.reason;
		}
	}

	console.log('[main] Both pipelines complete, ready to run Playwright');

	// Generate a run_id to group both batches
	const runId = generateRunId();
	console.log(`[main] Run ID: ${runId}`);

	let webTimestamp;
	let mobileTimestamp;

	// PHASE 1: Web Tests (chromium project)
	const testLog = stageLogger.playwrightTests;
	testLog.step('Phase 1: Running web tests...');

	await testing.setProject('chromium', testLog);

	testLog.step('Triggering web test batch...');
	webTimestamp = await testing.triggerTests(taskId, requester, testLog, runId);

	testLog.step('Polling for web tests...');
	const webSuccess = await testing.pollForCompletion(webTimestamp, testLog);

	if (!webSuccess) {
		throw new Error('Web tests failed or were canceled');
	}
	testLog.step('Web tests complete!');

	// PHASE 2: Database Reseed for Mobile
	const mobileReseedLog = stageLogger.createStageLogger('mobile-reseed');
	mobileReseedLog.step('Reseeding database for mobile tests...');
	await apps.seedDatabase(mobileReseedLog);
	mobileReseedLog.step('Complete');

	// PHASE 3: Mobile Tests (mobile-chromium project)
	const mobileLog = stageLogger.createStageLogger('mobile-tests');
	mobileLog.step('Phase 2: Running mobile tests...');

	await testing.setProject('mobile-chromium', mobileLog);

	mobileLog.step('Triggering mobile test batch...');
	mobileTimestamp = await testing.triggerTests(taskId, `${requester}-mobile`, mobileLog, runId);

	mobileLog.step('Polling for mobile tests...');
	const mobileSuccess = await testing.pollForCompletion(mobileTimestamp, mobileLog);

	// Reset to default
	await testing.setProject(null, mobileLog);

	if (!mobileSuccess) {
		throw new Error('Mobile tests failed or were canceled');
	}
	mobileLog.step('Mobile tests complete!');

	// Print results info after task completion
	console.log('');
	console.log(`Run ID: ${runId}`);
	console.log('');
	console.log('Web test results:');
	console.log(`  ${config.MASTER_URL}/results?timestamp=${webTimestamp}`);
	console.log('');
	console.log('Mobile test results:');
	console.log(`  ${config.MASTER_URL}/results?timestamp=${mobileTimestamp}`);
}

/**
 * Show service status
 */
async function cmdStatus() {
	docker.checkSwarm();
	await docker.getStatus();
}

/**
 * Show logs
 */
async function cmdLogs(follow) {
	docker.checkSwarm();
	await docker.getLogs(follow);
}

/**
 * List nodes
 */
async function cmdNodes() {
	docker.checkSwarm();
	await docker.listNodes();
}

// CLI definition
yargs(hideBin(process.argv))
	.scriptName('minifarm.js')
	.usage('Minifarm CLI - Unified command for deployment and testing')
	.version(false)
	.wrap(Math.min(100, process.stdout.columns || 80))
	.parserConfiguration({'boolean-negation': false})
	.option('verbose', {
		alias: 'v',
		type: 'boolean',
		describe: 'Show verbose shell command output',
		default: false,
		global: true,
	})
	.command(
		'test <taskId> [requester]',
		'Full workflow: checkout, build, deploy, run tests',
		(yargs) => {
			yargs
				.positional('taskId', {
					describe: 'Jira task ID or branch name (e.g., MN-4000, develop)',
					type: 'string',
				})
				.positional('requester', {
					describe: 'Who is requesting the test',
					type: 'string',
					default: 'cli',
				});
		},
		async (argv) => {
			try {
				await cmdTest(argv.taskId, argv.requester, argv.verbose);
			} catch (err) {
				logger.error(err.message);
				process.exit(1);
			}
		}
	)
	.command(
		'status',
		'Show Swarm service status',
		() => {},
		async () => {
			try {
				await cmdStatus();
			} catch (err) {
				logger.error(err.message);
				process.exit(1);
			}
		}
	)
	.command(
		'logs',
		'Show aggregated logs from all clients',
		(yargs) => {
			yargs.option('follow', {
				alias: 'f',
				type: 'boolean',
				describe: 'Follow log output',
				default: false,
			});
		},
		async (argv) => {
			try {
				await cmdLogs(argv.follow);
			} catch (err) {
				logger.error(err.message);
				process.exit(1);
			}
		}
	)
	.command(
		'nodes',
		'List Swarm nodes',
		() => {},
		async () => {
			try {
				await cmdNodes();
			} catch (err) {
				logger.error(err.message);
				process.exit(1);
			}
		}
	)
	.example('$0 test MN-4000', 'Run full test suite for Jira task')
	.example('$0 test develop', 'Run tests on develop branch')
	.example('$0 test MN-4000 --verbose', 'Run tests with verbose output')
	.example('MINIFARM_WORKERS=1 $0 test MN-4000', 'Test with 1 client')
	.epilog(`Environment variables:
  MINIFARM_WORKERS=N    Expected client count (default: ${config.DEFAULT_WORKERS})`)
	.demandCommand(1, 'You need at least one command before moving on')
	.strict()
	.help()
	.alias('h', 'help')
	.parse();
