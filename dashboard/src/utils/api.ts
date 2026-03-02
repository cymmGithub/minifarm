import type {
	Client,
	TestBatch,
	Report,
	FilterState,
	PipelineRun,
	BranchValidation,
} from '../types';

// Base URL for API calls - empty string works when served from same origin
const API_BASE = '';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function assertOk(res: Response, action: string): Promise<void> {
	if (!res.ok) {
		throw new Error(`Failed to ${action}: ${res.statusText}`);
	}
}

async function assertOkWithBody(res: Response, action: string): Promise<void> {
	if (!res.ok) {
		const error = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error(error.error || `Failed to ${action}: ${res.statusText}`);
	}
}

// Clients
export async function fetchClients(): Promise<Client[]> {
	const res = await fetch(`${API_BASE}/clients`);
	await assertOk(res, 'fetch clients');
	return res.json();
}

export async function fetchClientsStatus(): Promise<Client[]> {
	const res = await fetch(`${API_BASE}/api/clients-status`);
	await assertOk(res, 'fetch clients status');
	return res.json();
}

// Queue
export async function fetchQueue(): Promise<TestBatch[]> {
	const res = await fetch(`${API_BASE}/queue`);
	await assertOk(res, 'fetch queue');
	return res.json();
}

// Batch status/details
export async function fetchBatchStatus(timestamp: string): Promise<TestBatch> {
	const res = await fetch(`${API_BASE}/status?timestamp=${encodeURIComponent(timestamp)}`);
	await assertOk(res, 'fetch batch status');
	return res.json();
}

// Cancel batch
export async function cancelBatch(timestamp: string): Promise<{ status: string }> {
	const res = await fetch(`${API_BASE}/cancel`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ timestamp }),
	});
	await assertOk(res, 'cancel batch');
	return res.json();
}

// Reports
export async function fetchReports(): Promise<Report[]> {
	const res = await fetch(`${API_BASE}/api/reports`);
	await assertOk(res, 'fetch reports');
	return res.json();
}

export async function deleteReports(reports: string[]): Promise<{ deleted_count: number }> {
	const res = await fetch(`${API_BASE}/delete-reports`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ reports }),
	});
	await assertOk(res, 'delete reports');
	return res.json();
}

export async function purgeOldReports(): Promise<{ removed_count: number }> {
	const res = await fetch(`${API_BASE}/purge-old`, { method: 'POST' });
	await assertOk(res, 'purge reports');
	return res.json();
}

// Test filter
export async function fetchFilter(): Promise<FilterState> {
	const res = await fetch(`${API_BASE}/api/test-filter`);
	await assertOk(res, 'fetch filter');
	return res.json();
}

export async function setFilter(pattern: string): Promise<FilterState> {
	const res = await fetch(`${API_BASE}/api/test-filter`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ pattern }),
	});
	await assertOk(res, 'set filter');
	return res.json();
}

// Pipeline - validate branch
export async function validateBranch(branch: string): Promise<BranchValidation> {
	const res = await fetch(`${API_BASE}/pipeline/validate-branch`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ branch }),
	});
	await assertOk(res, 'validate branch');
	return res.json();
}

// Pipeline - start
export async function startPipeline(
	branch: string,
	requester: string,
	workers?: number,
): Promise<PipelineRun> {
	const res = await fetch(`${API_BASE}/pipeline/start`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ branch, requester, workers }),
	});
	await assertOkWithBody(res, 'start pipeline');
	return res.json();
}

// Pipeline - cancel
export async function cancelPipelineRun(runId: string): Promise<{ success: boolean; message?: string }> {
	const res = await fetch(`${API_BASE}/pipeline/cancel/${encodeURIComponent(runId)}`, {
		method: 'POST',
	});
	await assertOk(res, 'cancel pipeline');
	return res.json();
}

// Pipeline - get state
export async function fetchPipelineState(): Promise<{
	current: PipelineRun | null;
	queue: PipelineRun[];
}> {
	const res = await fetch(`${API_BASE}/pipeline/state`);
	await assertOk(res, 'fetch pipeline state');
	return res.json();
}

// Rerun a failed test
export async function rerunTest(
	timestamp: string,
	testFile: string,
	testName: string,
): Promise<{ status: string; test_file: string; test_name: string }> {
	const res = await fetch(`${API_BASE}/rerun-test`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({
			timestamp,
			test_file: testFile,
			test_name: testName,
		}),
	});
	await assertOkWithBody(res, 'rerun test');
	return res.json();
}
