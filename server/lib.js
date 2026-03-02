const util = require('util');
const child_process = require('child_process');
const execFile = util.promisify(child_process.execFile);

// In-memory only - resets on server restart
let test_filter = '';

const get_test_filter = () => test_filter;

const set_test_filter = (pattern) => {
	test_filter = pattern || '';
	console.log(`[TEST_FILTER] Set to: "${test_filter || '(none)'}"`);
};

const get_list_of_tests = async function() {
	const args = [
		'playwright',
		'test', '--list',
		'--project', 'chromium', // one project to get each test once
	];

	const grepInvertPattern = process.env.TEST_GREP_INVERT_PATTERN;
	if (grepInvertPattern) {
		console.log(`[LIB] Using grep-invert filter: ${grepInvertPattern}`);
		args.push('--grep-invert', grepInvertPattern);
	}

	// Test filter: in-memory setting takes precedence, then env var
	const pattern = get_test_filter();
	if (pattern) {
		console.log(`[LIB] Using test filter: ${pattern}`);
		args.push('--grep', pattern);
	}

	const test_list_raw = await execFile('npx', args, {cwd: process.env.PATH_TO_PLAYWRIGHT});
	const test_list = test_list_raw.stdout
		.split('\n')
		.filter(line => /\[chromium] › /.test(line))
		.map(line => {
			const match =
				line.match(/\[chromium\] › ([a-zA-Z0-9_./-]+):[0-9]+:[0-9]+(?: › ([a-zA-Z0-9_ !-]+))? › ([a-zA-Z0-9_ !-]+)$/);
			return {test_file: match[1], test_describe: match[2], test_name: match[3]};
		})
	;
	return test_list;
};

module.exports = {
	get_list_of_tests,
	get_test_filter,
	set_test_filter,
};
