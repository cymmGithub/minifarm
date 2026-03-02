const path = require('path');
const fsp = require('fs/promises');
const util = require('util');
const debug = require('debug')('playwright-testing-client:routes');
const {nanoid} = require('nanoid');
const child_process = require('child_process');
const execFile = util.promisify(child_process.execFile);
const exec = util.promisify(child_process.exec);

// Simple colored log prefixes
const INFO = '\x1b[32m[INFO]\x1b[0m';   // green
const ERROR = '\x1b[31m[ERROR]\x1b[0m'; // red

module.exports = {
	ping: (req, res) => res.sendStatus(200),
	run_test: async(req, res) => {
		const {test_file, test_describe, test_name} = req.query;
		console.log(INFO, 'run_test query:', req.query);
		const test_fullname = [test_file, test_describe, test_name].filter(s => s).join(' ');
		console.log(INFO, `received request to run test ${test_fullname}`);
		const id = nanoid();
		const report_name = `playwright-report-${id}`;
		const report_dir = path.resolve(process.env.PATH_TO_REPORTS, report_name);
		console.log(INFO, `report_dir is ${report_dir}`);

		// Returned status can be `passed`, `failed` or `error`.
		// The latter means the test errored out for some reason.
		let status;

		try {
			await execFile(
				'npm',
				['run', 'test:minifarm', '--', '--project', 'chromium', '--quiet', '--trace', 'retain-on-failure', '--retries', '1', '--reporter=blob', '--grep', `${test_fullname}$`, '--output', `test-results/${id}`],
				{
					cwd: process.env.PATH_TO_PLAYWRIGHT,
					env: {...process.env, PLAYWRIGHT_BLOB_OUTPUT_DIR: report_dir},
				},
			);
			status = 'passed';
		} catch (error) {
			console.log(ERROR, `npx playwright exited with error ${error}`);
			// Assume that the test failed
			status = 'failed';
		}
		console.log(status === 'passed' ? INFO : ERROR, 'Test execution status:', status);

		try {
			console.log(INFO, 'Checking for report directory:', report_dir);
			const fstat = await fsp.stat(report_dir);
			if (!fstat.isDirectory()) {
				console.log(ERROR, 'Report path exists but is not a directory.');
				return res.status(500).send({status: 'error', message: 'Report path is not a directory.'});
			}
			console.log(INFO, 'Report directory found.');
		} catch (error) {
			console.log(ERROR, 'Error checking for report directory:', error);
			return res.status(500).send({status: 'error', message: 'Could not find report directory.'});
		}

		try {
			console.log(INFO, 'Creating tar archive:', `${report_name}.tar`);
			await execFile(
				'tar',
				[
					'--create',
					'--file', `${report_name}.tar`,
					report_name,
				],
				{cwd: process.env.PATH_TO_REPORTS},
			);
			console.log(INFO, 'Tar archive created.');

			console.log(INFO, 'Compressing archive with pbzip2:', `${report_name}.tar`);
			await execFile(
				'pbzip2',
				[`${report_name}.tar`],
				{cwd: process.env.PATH_TO_REPORTS},
			);
			console.log(INFO, 'Archive compressed.');

			console.log(INFO, 'Removing original report directory:', report_dir);
			await fsp.rm(report_dir, {recursive: true, force: true});
			console.log(INFO, 'Original report directory removed.');

			const archive_path = `${report_dir}.tar.bz2`;
			console.log(INFO, 'Sending file:', archive_path);
			res.set({status, id}).status(200).sendFile(
				archive_path,
				(err) => {
					if (err) {
						console.log(ERROR, 'Error sending file:', err);
					} else {
						console.log(INFO, 'File sent successfully. Cleaning up archive:', archive_path);
						fsp.rm(archive_path, {force: true});
					}
				},
			);
		} catch (error) {
			console.log(ERROR, 'Error during archiving/cleanup:', error);
			res.status(500).send({status: 'error', message: 'Error during archiving or cleanup.'});
		}
	},
	update_tests: async(req, res) => {
		const updating_command = [
			'source ~/.bash_profile', // nodenv setup
			`cd ${process.env.PATH_TO_PLAYWRIGHT}`,
			'git fetch',
			'git merge --ff-only',
			'npm ci',
			'cd ../playwright-testing-client',
			'npm ci',
		].join(' && ');
		try {
			await exec(updating_command);
			res.sendStatus(200);
		} catch (error) {
			debug('Error: %o', error);
			res.sendStatus(500);
		}
	},
	purge_leftovers: async(req, res) => {
		await Promise.all([
			fsp.rm(path.join(process.env.PATH_TO_PLAYWRIGHT, 'playwright-reports-json'), {recursive: true, force: true}),
			fsp.rm(path.join(process.env.PATH_TO_PLAYWRIGHT, 'test-results'), {recursive: true, force: true}),
		]);
		res.end();
	},
};
