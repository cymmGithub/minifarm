/**
 * Stage Logger - Simple prefixed logging for minifarm stages
 *
 * Outputs logs in format: [stage] message
 * This format is parsed by pipeline-executor.js for dashboard streaming.
 *
 * Features:
 * - Deduplicates consecutive identical messages (prevents log flooding during polling)
 * - Each stage maintains its own last-message tracking
 */

// Track last message per stage to avoid flooding
const lastMessages = new Map();

/**
 * Create a logger for a specific stage
 * @param {string} stage - Stage name (e.g., 'clientDeployment', 'masterApps')
 * @returns {object} Logger object with step, info, warn, error methods
 */
export function createStageLogger(stage) {
	/**
	 * Log a message if it's different from the last one for this stage
	 * @param {string} message - Message to log
	 * @param {boolean} force - Force log even if duplicate
	 */
	function logIfNew(message, force = false) {
		const lastMessage = lastMessages.get(stage);
		if (force || message !== lastMessage) {
			lastMessages.set(stage, message);
			console.log(`[${stage}] ${message}`);
		}
	}

	return {
		/**
		 * Log a step (progress indicator) - deduplicated
		 * @param {string} message - Message to log
		 */
		step(message) {
			logIfNew(message);
		},

		/**
		 * Log info message - always logs (important info shouldn't be skipped)
		 * @param {string} message - Message to log
		 */
		info(message) {
			logIfNew(message, true);
		},

		/**
		 * Log warning message - always logs
		 * @param {string} message - Message to log
		 */
		warn(message) {
			console.log(`[${stage}] WARN: ${message}`);
			lastMessages.set(stage, `WARN: ${message}`);
		},

		/**
		 * Log error message - always logs
		 * @param {string} message - Message to log
		 */
		error(message) {
			console.log(`[${stage}] ERROR: ${message}`);
			lastMessages.set(stage, `ERROR: ${message}`);
		},

		/**
		 * Clear last message tracking for this stage
		 * Useful when starting a new phase within a stage
		 */
		reset() {
			lastMessages.delete(stage);
		},
	};
}

// Pre-created loggers for common stages
export const clientDeployment = createStageLogger('client-deployment');
export const masterApps = createStageLogger('master-apps');
export const avaTests = createStageLogger('ava-tests');
export const japaTests = createStageLogger('japa-tests');
export const dbReseed = createStageLogger('db-reseed');
export const playwrightTests = createStageLogger('playwright-tests');

export default {
	createStageLogger,
	clientDeployment,
	masterApps,
	avaTests,
	japaTests,
	dbReseed,
	playwrightTests,
};
