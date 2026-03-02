import got from 'got';
import {sleep} from './shell.js';
import * as logger from './logger.js';
import config from './config.js';

/**
 * Set the project override on the test server
 * @param {string|null} project - Project name ('chromium', 'mobile-chromium') or null to reset
 * @param {object} log - Stage logger instance
 * @returns {Promise<object>} Response from server
 */
export async function setProject(project, log = null) {
	const url = `${config.MASTER_URL}/api/project`;
	try {
		const response = await got.post(url, {
			json: {project},
			responseType: 'json',
			timeout: {request: 5000},
		});
		const msg = `Project set to: "${response.body.project}"`;
		if (log) {
			log.info(msg);
		} else {
			logger.info(msg);
		}
		return response.body;
	} catch (err) {
		const errMsg = `Failed to set project: ${err.message}`;
		if (log) {
			log.error(errMsg);
		} else {
			logger.error(errMsg);
		}
		throw err;
	}
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
 * Trigger a test batch on the test server
 * @param {string} version - Version/branch to test
 * @param {string} requester - Who requested the test
 * @param {object} log - Stage logger instance
 * @param {string|null} runId - Optional run ID to group related batches
 * @returns {Promise<string>} Timestamp of the test batch
 */
export async function triggerTests(version, requester, log = null, runId = null) {
	let url = `${config.MASTER_URL}/test?version=${encodeURIComponent(version)}&requester=${encodeURIComponent(requester)}`;
	if (runId) {
		url += `&run_id=${encodeURIComponent(runId)}`;
	}

	try {
		const response = await got(url, {
			responseType: 'json',
			timeout: {request: 30000},
		});

		const timestamp = response.body?.timestamp;
		if (!timestamp) {
			const errMsg = `Failed to start test. Response: ${JSON.stringify(response.body)}`;
			if (log) {
				log.error(errMsg);
			} else {
				logger.error(errMsg);
			}
			throw new Error(errMsg);
		}

		if (log) {
			log.info(`Test batch started: ${timestamp}`);
		} else {
			logger.info(`Test batch started: ${timestamp}`);
		}
		return timestamp;
	} catch (err) {
		const errMsg = `Failed to trigger tests: ${err.message}`;
		if (log) {
			log.error(errMsg);
		} else {
			logger.error(errMsg);
		}
		throw err;
	}
}

/**
 * Get status of a test batch
 * @param {string} timestamp - Test batch timestamp
 * @returns {Promise<object>} Status object
 */
export async function getStatus(timestamp) {
	try {
		const response = await got(`${config.MASTER_URL}/status?timestamp=${timestamp}`, {
			responseType: 'json',
			timeout: {request: 10000},
		});
		return response.body;
	} catch (err) {
		return {status: 'error', error: err.message};
	}
}

/**
 * Poll for test completion
 * @param {string} timestamp - Test batch timestamp
 * @param {object} log - Stage logger instance
 * @param {object} options - Options
 * @param {number} options.intervalMs - Polling interval in milliseconds
 * @returns {Promise<boolean>} True if tests completed successfully
 */
export async function pollForCompletion(timestamp, log = null, {intervalMs = config.TEST_POLL_INTERVAL_MS} = {}) {
	if (!log) {
		console.log(`Status: ${config.MASTER_URL}/status?timestamp=${timestamp}`);
		console.log('');
	}

	while (true) {
		const statusResponse = await getStatus(timestamp);
		const batchStatus = statusResponse?.status;

		switch (batchStatus) {
			case 'finished':
				if (log) {
					log.info('Tests complete!');
				} else {
					logger.progressEnd();
					logger.info('Tests complete!');
					console.log('');
					console.log('Results available at:');
					console.log(`  ${config.MASTER_URL}/results?timestamp=${timestamp}`);
					console.log('');
					console.log('Download with:');
					console.log(`  curl -O ${config.MASTER_URL}/results?timestamp=${timestamp}`);
				}
				return true;

			case 'running':
				if (log) {
					log.step('Running tests...');
				} else {
					logger.progress('.');
				}
				break;

			case 'pending':
				if (log) {
					log.step('Pending...');
				} else {
					logger.progress('p');
				}
				break;

			case 'incorrect':
			case 'canceled':
				if (log) {
					log.error(`Test batch ended with status: ${batchStatus}`);
				} else {
					logger.progressEnd();
					logger.error(`Test batch ended with status: ${batchStatus}`);
				}
				return false;

			default:
				if (log) {
					log.warn(`Unknown status: ${batchStatus}`);
				} else {
					logger.progress('?');
				}
				break;
		}

		await sleep(intervalMs);
	}
}

/**
 * Get the results URL for a test batch
 * @param {string} timestamp - Test batch timestamp
 * @returns {string} Results URL
 */
export function getResultsUrl(timestamp) {
	return `${config.MASTER_URL}/results?timestamp=${timestamp}`;
}

/**
 * Cancel a running test batch
 * @returns {Promise<object>} Response from server
 */
export async function cancelTests() {
	try {
		const response = await got.post(`${config.MASTER_URL}/cancel`, {
			responseType: 'json',
			timeout: {request: 10000},
		});
		return response.body;
	} catch (err) {
		logger.error(`Failed to cancel tests: ${err.message}`);
		return {error: err.message};
	}
}

/**
 * Get the current test queue
 * @returns {Promise<object>} Queue status
 */
export async function getQueue() {
	try {
		const response = await got(`${config.MASTER_URL}/queue`, {
			responseType: 'json',
			timeout: {request: 5000},
		});
		return response.body;
	} catch (err) {
		return {error: err.message};
	}
}

export default {
	setProject,
	getClients,
	triggerTests,
	getStatus,
	pollForCompletion,
	getResultsUrl,
	cancelTests,
	getQueue,
};
