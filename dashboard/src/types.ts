// Client from /clients endpoint
export interface Client {
	id: string;
	url: string;
	mac?: string;
	workers: number;
	alive?: boolean;
}

// Test status types
export type TestStatus =
	| 'pending'
	| 'running'
	| 'passed'
	| 'failed'
	| 'incorrect'
	| 'canceled';

// Batch status types
export type BatchStatus =
	| 'pending'
	| 'running'
	| 'finished'
	| 'canceled'
	| 'incorrect';

// Individual test in a batch
export interface Test {
	test_file?: string;
	test_describe?: string;
	test_name?: string;
	status: TestStatus;
	client?: string;
	started?: string;
	finished?: string;
	full_name?: string;
}

// Test batch from /queue endpoint (enriched with counts)
export interface TestBatch {
	timestamp: string;
	version: string;
	requester: string;
	status: BatchStatus;
	started?: string;
	/** When batch stopped running (tests finished or canceled) */
	ended?: string;
	/** When post-processing completed (report generation done) */
	finished?: string;
	tests?: Test[];
	// Enriched counts from /queue
	passed?: number;
	failed?: number;
	running?: number;
	pending?: number;
	incorrect?: number;
	canceled?: number;
	// Report info (set after post-processing completes)
	report_url?: string;
	report_name?: string;
}

// Report from /api/reports endpoint
export interface Report {
	name: string;
	requester: string;
	version: string;
	timestamp: string;
	url: string;
}

// Filter state from /api/test-filter endpoint
export interface FilterState {
	pattern: string;
}

export * from './types/pipeline';
