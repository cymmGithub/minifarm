import chalk from 'chalk';

// Logging functions matching bash prefixes
export function info(prefix, msg) {
	if (msg === undefined) {
		console.log(chalk.green('[INFO]'), prefix);
	} else {
		console.log(chalk.cyan(`[${prefix}]`), msg);
	}
}

export function warn(prefix, msg) {
	if (msg === undefined) {
		console.log(chalk.yellow('[WARN]'), prefix);
	} else {
		console.log(chalk.yellow(`[${prefix}]`), msg);
	}
}

export function error(prefix, msg) {
	if (msg === undefined) {
		console.log(chalk.red('[ERROR]'), prefix);
	} else {
		console.log(chalk.red(`[${prefix}]`), msg);
	}
}

export function step(prefix, msg) {
	if (msg === undefined) {
		console.log(chalk.cyan('[STEP]'), prefix);
	} else {
		console.log(chalk.green(`[${prefix}]`), msg);
	}
}

// Progress indicator - prints without newline
export function progress(char = '.') {
	process.stdout.write(char);
}

// Newline after progress
export function progressEnd() {
	console.log('');
}

// Section header
export function header(title) {
	console.log(chalk.green(`=== ${title} ===`));
}

// Command logging (for shell commands)
export function command(cmd) {
	console.log(chalk.green(cmd));
}

// Time measurement logging
export function timing(message, seconds) {
	console.log(chalk.inverse.blue(`${message} took ${seconds.toFixed(2)} seconds`));
}

export default {
	info,
	warn,
	error,
	step,
	progress,
	progressEnd,
	header,
	command,
	timing,
};
