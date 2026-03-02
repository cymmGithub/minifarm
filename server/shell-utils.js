const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Execute a shell command asynchronously
 * @param {string} cmd - Command to execute
 * @param {object} options - Options (cwd, noCheck)
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
async function executeAsync(cmd, { cwd = process.cwd(), noCheck = false } = {}) {
  try {
    const { stdout, stderr } = await execPromise(cmd, { cwd, timeout: 30000 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (noCheck) {
      return { code: error.code || 1, stdout: error.stdout || '', stderr: error.stderr || '' };
    }
    throw error;
  }
}

module.exports = { executeAsync };
