const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const util = require('util');
const querystring = require('querystring');
const child_process = require('child_process');
const EventEmitter = require('events');
const execFile = util.promisify(child_process.execFile);
const debug = require('debug')('playwright-testing-server:routes');
const got = require('got');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
const TIMESTAMP_FORMAT = 'YYYYMMDDTHHmmss.SSS';
const DEFAULT_THRESHOLD = [24, 'hours'];
const TEST_SCATTER_INTERVAL = 500;

const _ = require('lodash');
const lib = require('./lib.js');

// Event emitters for SSE broadcasts
const queueEvents = new EventEmitter();
const reportEvents = new EventEmitter();

const test_queue_file = process.env.TEST_QUEUE_FILE;
const clients_file = process.env.CLIENTS_FILE;
let test_queue;
let client_list;

const save_queue =
	() => fs.writeFileSync(test_queue_file, JSON.stringify(test_queue, null, '\t'));

// Get enriched queue with computed counts for SSE broadcast
function getEnrichedQueue() {
	return test_queue.map(batch => {
		if (!batch.tests) return batch;
		const counts = _.countBy(batch.tests, 'status');
		return {
			...batch,
			passed: counts.passed || 0,
			failed: counts.failed || 0,
			running: counts.running || 0,
			pending: counts.pending || 0,
			incorrect: counts.incorrect || 0,
			canceled: counts.canceled || 0,
		};
	}).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// Broadcast queue updates to SSE clients
function broadcastQueueUpdate() {
	queueEvents.emit('queue-update', getEnrichedQueue());
}

// Helper to get reports list (reusable for SSE and API)
async function getReportsList() {
	const reports_dir = process.env.PATH_TO_REPORTS;
	try {
		const entries = await fsp.readdir(reports_dir, {withFileTypes: true});
		return entries
			.filter(entry => entry.isDirectory() && entry.name.endsWith('_summary'))
			.map(entry => {
				const name = entry.name.replace('_summary', '');
				const parts = name.split('_');
				const timestamp = parts.pop();
				const version = parts.pop();
				const requester = parts.join('_');
				return {name: entry.name, requester, version, timestamp, url: `/reports/${entry.name}/index.html`};
			})
			.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
	} catch (error) {
		console.error('[REPORTS] Error reading reports directory:', error.message);
		return [];
	}
}

// Broadcast reports updates to SSE clients
async function broadcastReportsUpdate() {
	const reports = await getReportsList();
	reportEvents.emit('reports-update', reports);
}

try {
	test_queue = JSON.parse(fs.readFileSync(test_queue_file, {encoding: 'utf8'}));
	_.each(test_queue, test_batch => {
		if (test_batch.status === 'running') {
			console.error(`test batch ${test_batch.timestamp} marked as running, changing to \`incorrect\``);
			test_batch.status = 'incorrect';
			test_batch.ended = now();
		}
	});
} catch (error) {
	console.log(`While reading or parsing the test queue file: ${error}`);
	console.log(`Initializing an empty queue. Stale reports may linger in ${process.env.PATH_TO_REPORTS}`);
	test_queue = [];
	save_queue();
}

const save_client_list =
	() => fs.writeFileSync(clients_file, JSON.stringify(client_list, null, '\t'));

try {
	client_list = JSON.parse(fs.readFileSync(clients_file, {encoding: 'utf8'}));
} catch (error) {
	console.log(`While reading or parsing the clients file: ${error}`);
	console.log('Initializing an empty clients file. Restart the clients to repopulate.');
	client_list = [];
	save_client_list();
}

const now = () => dayjs().utc().format(TIMESTAMP_FORMAT);

const format_elapsed = (started) => {
	const start = dayjs.utc(started, TIMESTAMP_FORMAT);
	const seconds = dayjs().utc().diff(start, 'second');
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}m${secs.toString().padStart(2, '0')}s`;
};

const get_progress = (tests) => {
	const total = tests.length;
	const completed = _.filter(tests, t => _.includes(['passed', 'failed', 'incorrect', 'canceled'], t.status)).length;
	return {completed, total};
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const generate_report_dir = ({version, requester, timestamp}) => {
	return `${process.env.PATH_TO_REPORTS}/${requester}_${version}_${timestamp}`;
};

const get_running_test_batch = () => _.find(test_queue, {status: 'running'});

async function ping_client(client) {
	console.log(`[PING] Checking client ${client.id} at ${client.url}/ping`);
	const url = `${client.url}/ping`;
	let is_client_alive;
	try {
		await got(url, {timeout: {response: +process.env.PING_TIMEOUT}});
		console.log(`[PING] ✓ Client ${client.id} is ALIVE`);
		is_client_alive = true;
	} catch (error) {
		console.log(`[PING] ✗ Client ${client.id} is DEAD - Error: ${error.message}`);
		is_client_alive = false;
		console.log(`[PING] Removing client ${client.id} from client_list`);
		_.remove(client_list, {id: client.id});
		console.log(`[PING] Remaining clients: ${JSON.stringify(_.map(client_list, 'id'))}`);
		if (_.isEmpty(client_list)) {
			console.error('[PING] ALL CLIENTS DEAD - marking test batch as incorrect');
			const running_test_batch = get_running_test_batch();
			if (running_test_batch) {
				running_test_batch.status = 'incorrect';
				running_test_batch.ended = now();
			}
		}
	}
	return is_client_alive;
}

async function run_test(test_batch, client, test) {
	const reports_dir = generate_report_dir(test_batch);
	test.started = now();
	const query_params = querystring.encode({
		test_file: test.test_file,
		test_describe: test.test_describe,
		test_name: test.test_name,
	});
	const url = `${client.url}/run-test?${query_params}`;
	console.log(`[RUN_TEST] Calling ${url}`);
	const result = await got(
		url,
		{
			timeout: {response: process.env.TEST_TIMEOUT * 1000},
			retry: {limit: 0},
		},
	);
	console.log(`[RUN_TEST] Got response from ${client.id}, status header: ${result.headers.status}`);
	test.full_name = path.join(reports_dir, `playwright-report-${result.headers.id}`);
	await fsp.writeFile(test.full_name + '.tar.bz2', result.rawBody);
	await execFile('tar', ['--use-compress-program=pbzip2', '-xf', `${test.full_name}.tar.bz2`], {cwd: reports_dir});
	await fsp.rm(test.full_name + '.tar.bz2');
	test.finished = now();
	return result;
}

function disable_test(test) {
	delete test.full_name;
	test.status = 'incorrect';
	save_queue();
	broadcastQueueUpdate();
}

async function post_process_tests(test_batch) {
	test_batch.status = 'finished';
	test_batch.ended = now();
	broadcastQueueUpdate();
	debug('all tests done');
	const reports_dir = generate_report_dir(test_batch);
	const summary_dir = reports_dir + '_summary';
	// For reruns: clean up previous summary before regenerating
	await fsp.rm(summary_dir, {recursive: true, force: true});
	await fsp.rm(`${summary_dir}.tar.bz2`, {force: true});
	await fsp.rm(`${summary_dir}.tar`, {force: true});
	// Get reports that exist on disk (some may be missing if server was restarted mid-batch)
	const completed_tests = _.filter(
		test_batch.tests,
		test => _.includes(['passed', 'failed'], test.status) && test.full_name,
	);
	const existing_reports = [];
	for (const test of completed_tests) {
		try {
			await fsp.access(test.full_name);
			existing_reports.push(test.full_name);
		} catch {
			console.log(`[POST_PROCESS] Report missing, skipping: ${test.full_name}`);
		}
	}

	if (existing_reports.length > 0) {
		// Collect all blob .zip files into a single directory for merging
		const blob_collect_dir = reports_dir + '_blobs';
		await fsp.mkdir(blob_collect_dir, {recursive: true});

		// Copy blob files from each report directory to the collection directory
		for (const report_path of existing_reports) {
			const files = await fsp.readdir(report_path);
			for (const file of files) {
				if (file.endsWith('.zip')) {
					await fsp.copyFile(
						path.join(report_path, file),
						path.join(blob_collect_dir, `${path.basename(report_path)}-${file}`),
					);
				}
			}
		}

		// Use Playwright's native merge-reports command
		await execFile(
			'npx',
			['playwright', 'merge-reports', '--reporter=html', blob_collect_dir],
			{
				cwd: process.env.PATH_TO_REPORTS,
				env: {...process.env, PLAYWRIGHT_HTML_REPORT: summary_dir},
			},
		);

		// Clean up the blob collection directory
		await fsp.rm(blob_collect_dir, {recursive: true, force: true});
	} else {
		console.log('[POST_PROCESS] No reports to merge, creating empty summary dir');
		await fsp.mkdir(summary_dir, {recursive: true});
	}
	// Keep reports_dir for potential reruns - it will be cleaned up by purge_old()
	await execFile(
		'tar',
		[
			'-C', process.env.PATH_TO_REPORTS,
			'--create',
			'--file', `${summary_dir}.tar`,
			path.basename(summary_dir), // we need the filename w/o directory for `tar`
		],
		{cwd: process.env.PATH_TO_REPORTS},
	);
	await execFile(
		'pbzip2',
		[`${summary_dir}.tar`],
		{cwd: process.env.PATH_TO_REPORTS},
	);
	// Keep summary_dir for HTTP serving via /reports endpoint
	// (tar.bz2 is also kept for download via /results endpoint)

	// Set report URL on the batch for unified queue display
	const summary_name = path.basename(summary_dir);
	test_batch.report_url = `/reports/${summary_name}/index.html`;
	test_batch.report_name = summary_name;

	// Remove test leftovers from clients
	const promises = _.map(client_list, ({url}) => got.post(`${url}/purge-leftovers`));
	await Promise.all(promises);

	test_batch.finished = now();
	save_queue();
	debug('test report ready');
	broadcastQueueUpdate();
	broadcastReportsUpdate();

	// Start the next pending test
	start_first_pending_test_batch();
}

const find_test = (tests, status) => _.find(tests, {status});

async function assign_test_to_client(test_batch, client) {
	const {tests} = test_batch;
	const pending_count = _.filter(tests, {status: 'pending'}).length;
	const running_count = _.filter(tests, {status: 'running'}).length;
	console.log(`[ASSIGN] Client ${client.id}: pending=${pending_count}, running=${running_count}`);

	const test = find_test(tests, 'pending');
	if (test) {
		console.log(`[ASSIGN] Found pending test: ${test.test_file}::${test.test_name}`);
		test.status = 'running';
		broadcastQueueUpdate();
		if (!await ping_client(client)) {
			console.log(`[ASSIGN] Client ${client.id} ping failed - returning test to pending, ABANDONING this client slot`);
			test.status = 'pending';
			return;
		}
		test.client = client.id;
		save_queue();
		console.log(`[ASSIGN] >>> Running test "${test.test_name}" on client ${client.id}`);
		let result;
		try {
			result = await run_test(test_batch, client, test);
			test.status = result.headers.status;
			broadcastQueueUpdate();
			const {completed, total} = get_progress(test_batch.tests);
			const elapsed = format_elapsed(test_batch.started);
			console.log(`[ASSIGN] <<< Test "${test.test_name}" on ${client.id} finished: ${test.status} [${completed}/${total}] (${elapsed})`);
		} catch (error) {
			const {completed, total} = get_progress(test_batch.tests);
			const elapsed = format_elapsed(test_batch.started);
			console.log(`[ASSIGN] !!! Test "${test.test_name}" on ${client.id} CRASHED: ${error.message} [${completed}/${total}] (${elapsed})`);
			disable_test(test);
		}
		assign_test_to_client(test_batch, client);
	} else if (!find_test(tests, 'running') && test_batch.status === 'running') {
		console.log(`[ASSIGN] No pending tests and no running tests - calling post_process_tests`);
		post_process_tests(test_batch);
	} else {
		console.log(`[ASSIGN] Client ${client.id}: No pending test found, still ${running_count} running`);
	}
}

const add_test_batch_request_to_queue = (test_batch) => {
	console.log(`[QUEUE] Adding test batch to queue: ${test_batch.timestamp}`);
	test_queue.push({...test_batch, status: 'pending'});
	save_queue();
	const running = get_running_test_batch();
	if (!running) {
		console.log(`[QUEUE] No running batch, starting first pending`);
		start_first_pending_test_batch();
	} else {
		console.log(`[QUEUE] Batch ${running.timestamp} already running, queued for later`);
	}
};

// Note: Deployment is now handled by minifarm.sh before triggering tests
// The server just starts tests immediately when a test batch is requested
const start_first_pending_test_batch = async() => {
	console.log(`[QUEUE] Looking for pending test batch...`);
	const first_pending_test_batch = _.find(test_queue, {status: 'pending'});
	if (first_pending_test_batch) {
		console.log(`[QUEUE] Found pending batch: ${first_pending_test_batch.timestamp}`);
		first_pending_test_batch.status = 'running';
		save_queue();
		broadcastQueueUpdate();
		// Apps are already deployed by minifarm.js, start tests immediately
		await start_test_batch(first_pending_test_batch);
	} else {
		console.log(`[QUEUE] No pending test batch found`);
	}
};

const start_test_batch = async(test_batch) => {
	test_batch.started = now();
	const reports_dir = generate_report_dir(test_batch);
	await fsp.mkdir(reports_dir, {recursive: true});

	// Reload client list from disk and ping each to confirm they're alive
	try {
		const fresh_clients = JSON.parse(fs.readFileSync(clients_file, {encoding: 'utf8'}));
		console.log(`[START] Reloaded ${fresh_clients.length} clients from ${clients_file}, pinging each...`);
		const ping_results = await Promise.all(
			fresh_clients.map(async (client) => {
				try {
					await got(`${client.url}/ping`, {timeout: {response: +process.env.PING_TIMEOUT}});
					console.log(`[START] ✓ ${client.id} is alive`);
					return client;
				} catch (error) {
					console.log(`[START] ✗ ${client.id} is dead: ${error.message}`);
					return null;
				}
			}),
		);
		client_list = ping_results.filter(Boolean);
		console.log(`[START] ${client_list.length}/${fresh_clients.length} clients alive`);
	} catch (error) {
		console.error(`[START] Failed to reload clients file: ${error.message}, keeping current list`);
	}

	console.log(`[START] ========================================`);
	console.log(`[START] Starting test batch: ${reports_dir}`);
	console.log(`[START] Client list has ${client_list.length} clients:`);
	_.each(client_list, (c, i) => {
		console.log(`[START]   ${i}: id=${c.id}, url=${c.url}, mac=${c.mac}, workers=${c.workers}`);
	});

	test_batch.tests = _.map(
		await lib.get_list_of_tests(),
		test => ({
			...test,
			status: 'pending',
		}),
	);
	console.log(`[START] Loaded ${test_batch.tests.length} tests`);

	let total_client_slots = 0;
	_.each(client_list, client => {
		console.log(`[START] Spawning ${client.workers} client slots for client ${client.id}`);
		_.times(
			client.workers,
			(i) => {
				const delay = Math.random() * TEST_SCATTER_INTERVAL;
				console.log(`[START]   Client slot ${i} for ${client.id} scheduled in ${delay.toFixed(0)}ms`);
				setTimeout(
					() => assign_test_to_client(test_batch, client),
					delay,
				);
				total_client_slots++;
			},
		);
	});
	console.log(`[START] Total client slots spawned: ${total_client_slots}`);
	console.log(`[START] ========================================`);
};

async function clients(req, res) {
	res.json(client_list);
}

async function api_clients_status(req, res) {
	const results = await Promise.all(
		client_list.map(async (client) => {
			let alive = false;
			try {
				await got(`${client.url}/ping`, {timeout: {response: +process.env.PING_TIMEOUT}});
				alive = true;
			} catch {}
			return {...client, alive};
		}),
	);
	res.json(results);
}

async function test(req, res) {
	const {version, requester} = req.query;
	if (!version || !requester) {
		return res.sendStatus(400);
	}
	const timestamp = now();
	if (_.isEmpty(client_list)) {
		return res.sendStatus(503);
	} else if (_.find(test_queue, {timestamp})) {
		return res.sendStatus(429);
	} else {
		const test_batch = {version, requester, timestamp};
		await add_test_batch_request_to_queue(test_batch);
		res.status(202).json(test_batch);
	}
}

async function results(req, res) {
	const {timestamp} = req.query;
	const test_batch = _.find(test_queue, {timestamp}) || _.last(test_queue);
	if (test_batch?.status === 'finished') {
		const filename = generate_report_dir(test_batch);
		res.attachment(filename + '_summary.tar.bz2')
			.sendFile(filename + '_summary.tar.bz2');
	} else {
		res.sendStatus(204);
	}
}

async function queue(req, res) {
	res.json(getEnrichedQueue());
}

async function status(req, res) {
	const {timestamp} = req.query;
	const test_batch = _.find(test_queue, {timestamp}) || _.last(test_queue);
	res.json(test_batch);
}

async function cancel(req, res) {
	const {timestamp} = req.body;
	let status;
	let response = {};
	const test_batch = _.find(test_queue, {timestamp});
	if (!test_batch) {
		return res.status(404).json({status: 'test batch not found'});
	}
	if (test_batch.status === 'running') {
		_.each(test_batch.tests, test => {
			if (test.status === 'pending') {
				test.status = 'canceled';
			}
		});
		status = 202;
		response.status = 'test batch will be canceled when the currently running tests finish';
	} else if (test_batch.status === 'pending') {
		test_batch.status = 'canceled';
		test_batch.ended = now();
		broadcastQueueUpdate();
		status = 200;
		response.status = 'test batch canceled';
	} else if (test_batch.status === 'finished') {
		status = 400;
		response.status = 'already finished';
	} else {
		status = 500;
		response.status = 'this should not happen';
	}
	save_queue();
	return res.status(status).json(response);
}

async function purge_old(req, res) {
	const threshold = req.body.threshold ??
		dayjs().utc().subtract(...DEFAULT_THRESHOLD).format(TIMESTAMP_FORMAT);
	if (!dayjs(threshold, TIMESTAMP_FORMAT, true).isValid()) {
		return res.sendStatus(400);
	}
	const reports_to_delete = _.remove(
		test_queue,
		test_batch => test_batch.timestamp < threshold &&
			_.includes(['finished', 'canceled', 'incorrect'], test_batch.status),
	);
	save_queue();
	const removed_count = reports_to_delete.length;
	await Promise.all(_.map(
		reports_to_delete,
		async test_batch => {
			const base_path = generate_report_dir(test_batch);
			await fsp.rm(base_path, {recursive: true, force: true});
			await fsp.rm(base_path + '_summary.tar.bz2', {force: true});
			await fsp.rm(base_path + '_summary', {recursive: true, force: true});
		},
	));
	broadcastReportsUpdate();
	res.status(200).json({removed_count});
}

function api_test_filter_get(req, res) {
	res.json({pattern: lib.get_test_filter()});
}

function api_test_filter_set(req, res) {
	lib.set_test_filter(req.body.pattern);
	res.json({pattern: lib.get_test_filter()});
}

async function api_reports(req, res) {
	const reports_dir = process.env.PATH_TO_REPORTS;
	try {
		const entries = await fsp.readdir(reports_dir, {withFileTypes: true});
		const report_dirs = entries
			.filter(entry => entry.isDirectory() && entry.name.endsWith('_summary'))
			.map(entry => {
				// Parse directory name: requester_version_timestamp_summary
				const name = entry.name.replace('_summary', '');
				const parts = name.split('_');
				const timestamp = parts.pop();
				const version = parts.pop();
				const requester = parts.join('_');
				return {
					name: entry.name,
					requester,
					version,
					timestamp,
					url: `/reports/${entry.name}/index.html`,
				};
			})
			.sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // Newest first

		res.json(report_dirs);
	} catch (error) {
		res.status(500).json({error: error.message});
	}
}

async function delete_reports(req, res) {
	const {reports} = req.body;
	if (!Array.isArray(reports) || reports.length === 0) {
		return res.status(400).json({error: 'reports array required'});
	}

	const reports_dir = process.env.PATH_TO_REPORTS;
	let deleted_count = 0;

	for (const report_name of reports) {
		// Validate report name format to prevent path traversal
		if (!report_name.endsWith('_summary') || report_name.includes('..') || report_name.includes('/')) {
			continue;
		}

		const base_path = path.join(reports_dir, report_name.replace('_summary', ''));

		// Remove from test_queue
		const timestamp_match = report_name.match(/_(\d{8}T\d{6}\.\d{3})_summary$/);
		if (timestamp_match) {
			_.remove(test_queue, {timestamp: timestamp_match[1]});
		}

		// Delete files
		try {
			await fsp.rm(base_path + '_summary.tar.bz2', {force: true});
			await fsp.rm(base_path + '_summary', {recursive: true, force: true});
			deleted_count++;
		} catch (error) {
			console.log(`[DELETE_REPORTS] Error deleting ${report_name}: ${error.message}`);
		}
	}

	save_queue();
	broadcastQueueUpdate();
	broadcastReportsUpdate();
	res.json({deleted_count});
}

async function runSeedCommand() {
	return new Promise((resolve, reject) => {
		child_process.exec(
			'docker exec app-container-1 bash -c "cd /data/apps/local_account && npm run seed:full"',
			{timeout: 120000},
			(error, stdout, stderr) => {
				if (error) {
					console.error(`[RERUN] Seed command failed: ${error.message}`);
					console.error(`[RERUN] stderr: ${stderr}`);
					reject(error);
				} else {
					console.log(`[RERUN] Seed command completed successfully`);
					resolve(stdout);
				}
			},
		);
	});
}

async function rerun_test(req, res) {
	const {timestamp, test_file, test_name} = req.body;

	if (!timestamp || !test_file || !test_name) {
		return res.status(400).json({error: 'Missing required fields: timestamp, test_file, test_name'});
	}

	const test_batch = _.find(test_queue, {timestamp});
	if (!test_batch) {
		return res.status(404).json({error: 'Test batch not found'});
	}

	const test = _.find(test_batch.tests, {test_file, test_name});
	if (!test) {
		return res.status(404).json({error: 'Test not found in batch'});
	}

	if (test.status !== 'failed') {
		return res.status(400).json({error: `Cannot rerun test with status '${test.status}'. Only failed tests can be rerun.`});
	}

	console.log(`[RERUN] Seeding database before rerunning test: ${test_file}::${test_name}`);

	try {
		await runSeedCommand();
	} catch (error) {
		return res.status(500).json({error: `Database seed failed: ${error.message}`});
	}

	// Reset test status to pending
	test.status = 'pending';
	delete test.started;
	delete test.finished;
	delete test.full_name;
	delete test.client;

	// If batch is finished, set it back to running
	if (test_batch.status === 'finished') {
		test_batch.status = 'running';
		delete test_batch.ended;
		delete test_batch.finished;
	}

	save_queue();
	broadcastQueueUpdate();

	console.log(`[RERUN] Test ${test_file}::${test_name} reset to pending, assigning to client`);

	// Ensure reports_dir exists (may have been deleted by older code or manual cleanup)
	const reports_dir = generate_report_dir(test_batch);
	await fsp.mkdir(reports_dir, {recursive: true});

	// Re-queue the test by assigning it to an available client
	if (!_.isEmpty(client_list)) {
		const client = client_list[0];
		assign_test_to_client(test_batch, client);
	}

	res.status(202).json({status: 'Test rerun initiated', test_file, test_name});
}

module.exports = {
	clients,
	api_clients_status,
	test,
	results,
	queue,
	status,
	cancel,
	purge_old,
	api_reports,
	delete_reports,
	api_test_filter_get,
	api_test_filter_set,
	rerun_test,
	// SSE support
	queueEvents,
	getEnrichedQueue,
	reportEvents,
	getReportsList,
};
