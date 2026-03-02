import path from 'path';
import got from 'got';
import {execute, executeAsync, spawnAsync, sleep} from './shell.js';
import * as logger from './logger.js';
import config from './config.js';

/**
 * Check if Docker Swarm is active
 * @throws {Error} If Swarm is not active
 */
export function checkSwarm() {
	const result = execute('docker info 2>/dev/null | grep -q "Swarm: active"', {
		silent: true,
		noCheck: true,
	});

	if (result.code !== 0) {
		logger.error('Docker Swarm is not active. Run ./init-swarm.sh first.');
		process.exit(1);
	}
}

/**
 * Check if service exists, deploy stack if missing
 * @param {object} log - Stage logger instance
 */
export async function checkService(log = null) {
	const result = await executeAsync(
		`docker service inspect ${config.SERVICE_NAME}`,
		{silent: true, noCheck: true}
	);

	if (result.code !== 0) {
		const msg = `Service ${config.SERVICE_NAME} not found. Deploying stack...`;
		if (log) {
			log.step(msg);
		} else {
			logger.warn(msg);
		}
		const composeFile = path.join(config.SCRIPT_DIR, 'compose.swarm.yml');
		await executeAsync(`docker stack deploy -c ${composeFile} ${config.STACK_NAME}`);
		await sleep(5000);
	}
}

/**
 * Build Docker image and push to registry
 * @param {string} tag - Image tag (default: 'latest')
 * @param {object} log - Stage logger instance
 * @returns {Promise<string>} Full image path
 */
export async function buildAndPush(tag = 'latest', log = null) {
	const fullImage = `${config.REGISTRY_URL}/${config.IMAGE_NAME}:${tag}`;

	if (log) {
		log.step('Building Docker image...');
	} else {
		logger.step('Building Docker image...');
	}

	await executeAsync(
		`docker build -t ${config.IMAGE_NAME}:${tag} -f devops/minifarm/playwright-testing-client.Dockerfile .`,
		{cwd: config.CODE_DIR}
	);

	if (log) {
		log.step('Tagging for registry...');
	} else {
		logger.step('Tagging for registry...');
	}
	await executeAsync(`docker tag ${config.IMAGE_NAME}:${tag} ${fullImage}`);

	if (log) {
		log.step('Pushing to registry...');
	} else {
		logger.step('Pushing to registry...');
	}
	await executeAsync(`docker push ${fullImage}`);

	if (log) {
		log.info(`Image pushed: ${fullImage}`);
	} else {
		logger.info(`Image pushed: ${fullImage}`);
	}
	return fullImage;
}

/**
 * Update Swarm service with new image
 * @param {string} tag - Image tag
 * @param {object} log - Stage logger instance
 * @returns {Promise<void>}
 */
export async function updateSwarmService(tag = 'latest', log = null) {
	const fullImage = `${config.REGISTRY_URL}/${config.IMAGE_NAME}:${tag}`;

	await checkService(log);

	if (log) {
		log.step('Updating Swarm service...');
	}

	await executeAsync(`docker service update \
		--image ${fullImage} \
		--with-registry-auth \
		--force \
		${config.SERVICE_NAME}`);

	// Wait for deployment
	await waitForDeployment(log);
}

/**
 * Wait for service deployment to complete
 * @param {object} log - Stage logger instance
 * @param {object} options - Options
 * @param {number} options.maxAttempts - Max polling attempts
 * @param {number} options.intervalMs - Polling interval in milliseconds
 * @returns {Promise<void>}
 */
export async function waitForDeployment(log = null, {
	maxAttempts = config.DEPLOYMENT_MAX_ATTEMPTS,
	intervalMs = config.DEPLOYMENT_INTERVAL_MS,
} = {}) {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const result = await executeAsync(
			`docker service ps ${config.SERVICE_NAME} \
				--filter "desired-state=running" \
				--format "{{.CurrentState}}" | grep -c "Running" || echo "0"`,
			{silent: true, noCheck: true}
		);

		const running = parseInt(result.stdout.trim(), 10) || 0;

		if (running >= config.EXPECTED_WORKERS) {
			const msg = `All ${running} clients deployed`;
			if (log) {
				log.info(msg);
			} else {
				logger.info(msg);
			}
			return;
		}

		if (log) {
			log.step(`Waiting for deployment... ${running}/${config.EXPECTED_WORKERS}`);
		} else {
			logger.progress('.');
		}
		await sleep(intervalMs);
	}

	if (!log) {
		logger.progressEnd();
	}
	logger.warn('Timeout waiting for clients');
}

/**
 * Wait for clients to register with the test server
 * @param {object} log - Stage logger instance
 * @param {object} options - Options
 * @param {number} options.maxAttempts - Max polling attempts
 * @param {number} options.intervalMs - Polling interval in milliseconds
 * @returns {Promise<void>}
 */
export async function waitForClients(log = null, {
	maxAttempts = config.WORKER_REGISTRATION_MAX_ATTEMPTS,
	intervalMs = config.WORKER_REGISTRATION_INTERVAL_MS,
} = {}) {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			const response = await got(`${config.MASTER_URL}/clients`, {
				responseType: 'json',
				timeout: {request: 5000},
			});

			const clients = response.body;
			const clientCount = Array.isArray(clients) ? clients.length : 0;

			if (clientCount >= config.EXPECTED_WORKERS) {
				const msg = `${clientCount} clients registered`;
				if (log) {
					log.info(msg);
				} else {
					logger.info(msg);
				}
				return;
			}

			if (log) {
				log.step(`Waiting for clients... ${clientCount}/${config.EXPECTED_WORKERS}`);
			} else {
				logger.progress('.');
			}
		} catch (err) {
			if (log) {
				log.step('Waiting for clients... (server not ready)');
			} else {
				logger.progress('?');
			}
		}

		await sleep(intervalMs);
	}

	if (!log) {
		logger.progressEnd();
	}
	logger.warn('Timeout waiting for client registration');
}

/**
 * Get service status
 * @returns {Promise<void>}
 */
export async function getStatus() {
	logger.header('Minifarm Service Status');
	console.log('');

	console.log('Service:');
	await spawnAsync(`docker service ls --filter "name=${config.STACK_NAME}"`, [], {noCheck: true});
	console.log('');

	console.log('Tasks:');
	await spawnAsync(
		`docker service ps ${config.SERVICE_NAME} --format "table {{.Node}}\t{{.CurrentState}}\t{{.Error}}"`,
		[],
		{noCheck: true}
	);
	console.log('');

	console.log('Registered clients:');
	try {
		const response = await got(`${config.MASTER_URL}/clients`, {
			responseType: 'json',
			timeout: {request: 5000},
		});
		console.log(JSON.stringify(response.body, null, 2));
	} catch (err) {
		console.log('Could not fetch clients');
	}
	console.log('');
}

/**
 * Get service logs
 * @param {boolean} follow - Follow log output
 * @returns {Promise<void>}
 */
export async function getLogs(follow = false) {
	await checkService();
	const followFlag = follow ? '--follow' : '';
	await spawnAsync(`docker service logs ${followFlag} ${config.SERVICE_NAME}`, [], {noCheck: true});
}

/**
 * List Swarm nodes
 * @returns {Promise<void>}
 */
export async function listNodes() {
	logger.header('Swarm Nodes');
	await spawnAsync('docker node ls', [], {noCheck: true});
}

/**
 * Get list of registered clients from test server
 * @returns {Promise<object[]>} Array of client objects
 */
export async function getClients() {
	try {
		const response = await got(`${config.MASTER_URL}/clients`, {
			responseType: 'json',
			timeout: {request: 5000},
		});
		return response.body;
	} catch (err) {
		return [];
	}
}

/**
 * Clean up unused Docker resources on client nodes via SSH
 * Master cleanup is handled separately via cron
 * @param {object} log - Stage logger instance
 * @returns {Promise<void>}
 */
export async function systemPrune(log = null) {
	if (log) {
		log.step('Cleaning up unused Docker resources on clients...');
	} else {
		logger.step('Cleaning up unused Docker resources on clients...');
	}

	// Get list of client hostnames (Docker Swarm worker role nodes)
	const result = await executeAsync(
		'docker node ls --filter "role=worker" --format "{{.Hostname}}"',
		{silent: true}
	);
	const clients = result.stdout.trim().split('\n').filter(Boolean);

	if (clients.length === 0) {
		if (log) {
			log.info('No clients found');
		} else {
			logger.info('No clients found');
		}
		return;
	}

	// SSH to each client and run prune
	for (const client of clients) {
		if (log) {
			log.step(`Cleaning up ${client}...`);
		} else {
			logger.info(`Cleaning up ${client}...`);
		}

		await executeAsync(
			`ssh ${client}.local "docker system prune --all --volumes --force"`,
			{silent: true, noCheck: true}
		);
	}

	const msg = `Cleanup completed on ${clients.length} clients`;
	if (log) {
		log.info(msg);
	} else {
		logger.info(msg);
	}
}

export default {
	checkSwarm,
	checkService,
	buildAndPush,
	updateSwarmService,
	waitForDeployment,
	waitForClients,
	getStatus,
	getLogs,
	listNodes,
	getClients,
	systemPrune,
};
