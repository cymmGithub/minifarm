import {exec, execSync, spawn} from 'child_process';
import {promisify} from 'util';
import * as logger from './logger.js';

const execAsync = promisify(exec);

// Global verbose mode flag - set by CLI
let verboseMode = false;

/**
 * Set verbose mode for shell commands
 * @param {boolean} verbose - Enable verbose output
 */
export function setVerbose(verbose) {
	verboseMode = verbose;
}

/**
 * Check if verbose mode is enabled
 * @returns {boolean}
 */
export function isVerbose() {
	return verboseMode;
}

/**
 * Execute a command synchronously with logging
 * @param {string} command - Command to execute
 * @param {object} options - Options
 * @param {string} options.cwd - Working directory
 * @param {boolean} options.silent - Don't log command
 * @param {boolean} options.noCheck - Don't throw on non-zero exit
 * @returns {object} Result with stdout, stderr, code
 */
export function execute(command, {cwd = process.cwd(), silent = false, noCheck = false} = {}) {
	if (!silent && verboseMode) {
		logger.command(command);
	}

	try {
		const stdout = execSync(command, {
			cwd,
			encoding: 'utf8',
			stdio: noCheck ? ['pipe', 'pipe', 'pipe'] : undefined,
		});
		return {stdout, stderr: '', code: 0};
	} catch (err) {
		if (noCheck) {
			return {
				stdout: err.stdout || '',
				stderr: err.stderr || '',
				code: err.status || 1,
			};
		}
		logger.error(`Command failed with code ${err.status}: ${command}`);
		if (err.stderr) {
			logger.error(`Error: ${err.stderr}`);
		}
		throw err;
	}
}

/**
 * Execute a command asynchronously
 * @param {string} command - Command to execute
 * @param {object} options - Options
 * @param {string} options.cwd - Working directory
 * @param {boolean} options.silent - Don't log command
 * @param {boolean} options.noCheck - Don't throw on non-zero exit
 * @returns {Promise<object>} Result with stdout, stderr
 */
export async function executeAsync(command, {cwd = process.cwd(), silent = false, noCheck = false} = {}) {
	if (!silent && verboseMode) {
		logger.command(command);
	}

	try {
		const {stdout, stderr} = await execAsync(command, {
			cwd,
			encoding: 'utf8',
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer
		});
		return {stdout, stderr, code: 0};
	} catch (err) {
		if (noCheck) {
			return {
				stdout: err.stdout || '',
				stderr: err.stderr || '',
				code: err.code || 1,
			};
		}
		logger.error(`Command failed: ${command}`);
		if (err.stderr) {
			logger.error(`Error: ${err.stderr}`);
		}
		throw err;
	}
}

/**
 * Spawn a command with streaming output
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {object} options - Spawn options
 * @returns {Promise<number>} Exit code
 */
export function spawnAsync(command, args = [], options = {}) {
	return new Promise((resolve, reject) => {
		const proc = spawn(command, args, {
			stdio: 'inherit',
			shell: true,
			...options,
		});

		proc.on('error', reject);
		proc.on('close', (code) => {
			if (code === 0 || options.noCheck) {
				resolve(code);
			} else {
				reject(new Error(`Command '${command}' exited with code ${code}`));
			}
		});
	});
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
	setVerbose,
	isVerbose,
	execute,
	executeAsync,
	spawnAsync,
	sleep,
};
