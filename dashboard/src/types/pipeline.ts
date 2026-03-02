// Pipeline stage identifiers
export type PipelineStage =
	| 'client-deployment'
	| 'master-apps'
	| 'ava-tests'
	| 'japa-tests'
	| 'db-reseed'
	| 'playwright-tests';

// Stage status
export type StageStatus =
	| 'pending'
	| 'running'
	| 'complete'
	| 'failed'
	| 'cancelled';

// Overall run status
export type PipelineRunStatus =
	| 'queued'
	| 'running'
	| 'finished'
	| 'failed'
	| 'cancelled';

// Individual stage state
export interface StageState {
	status: StageStatus;
	startedAt?: string;
	completedAt?: string;
	logs: string[];
}

// A pipeline run (current, queued, or historical)
export interface PipelineRun {
	id: string;
	branch: string;
	resolvedBranch?: string;
	requester: string;
	workers?: number;
	status: PipelineRunStatus;
	queuedAt: string;
	startedAt?: string;
	completedAt?: string;
	duration?: number;
	stages: Record<PipelineStage, StageState>;
	reportUrl?: string;
	error?: string;
}

// Branch validation response
export interface BranchValidation {
	valid: boolean;
	resolvedBranch: string | null;
	message: string;
}

// SSE event types
export type PipelineEventType =
	| 'run:started'
	| 'run:complete'
	| 'run:failed'
	| 'run:cancelled'
	| 'stage:started'
	| 'stage:complete'
	| 'stage:failed'
	| 'log'
	| 'queue:updated';

export interface PipelineEvent {
	type: PipelineEventType;
	data: unknown;
}
