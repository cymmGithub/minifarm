import { useState, useRef, useEffect } from 'react';
import type { PipelineRun, PipelineStage, StageStatus, TestBatch } from '../types';
import type { LogEntry } from '../hooks/usePipelineEvents';
import { useElapsedTicker } from '../hooks/usePolling';
import { formatElapsed } from '../utils/time';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface Props {
	run: PipelineRun | null;
	realtimeLogs: LogEntry[];  // Only real-time logs from current session
	batches: TestBatch[];
	onCancel: (runId: string) => void;
}

const STAGE_LABELS: Record<PipelineStage, string> = {
	'client-deployment': 'Preparing minifarm-clients',
	'master-apps': 'Preparing minifarm-master apps',
	'ava-tests': 'Ava tests',
	'japa-tests': 'Japa tests',
	'db-reseed': 'Database reseed',
	'playwright-tests': 'Playwright Tests',
};

const STAGE_ORDER: PipelineStage[] = [
	'client-deployment',
	'master-apps',
	'japa-tests',
	'ava-tests',
	'db-reseed',
	'playwright-tests',
];

interface CompletionStatus {
	label: string;
	badgeClass: string;
}

function getCompletionStatus(hasFailed: boolean, wasCancelled: boolean): CompletionStatus {
	if (hasFailed) {
		return { label: 'Failed', badgeClass: 'bg-red-100 text-red-700' };
	}
	if (wasCancelled) {
		return { label: 'Cancelled', badgeClass: 'bg-amber-100 text-amber-700' };
	}
	return { label: 'Complete', badgeClass: 'bg-green-100 text-green-700' };
}

function ElapsedTime({ started, completed }: { started: string; completed?: string }) {
	const [elapsed, setElapsed] = useState(formatElapsed(started, completed));
	useElapsedTicker(() => setElapsed(formatElapsed(started, completed)));
	return <span>{elapsed}</span>;
}

/**
 * Find the test batch associated with a pipeline run.
 * Matches by requester and version (resolvedBranch or branch).
 */
function findAssociatedBatch(run: PipelineRun, batches: TestBatch[]): TestBatch | undefined {
	const targetVersion = run.resolvedBranch || run.branch;
	return batches.find(
		(b) => b.requester === run.requester && b.version === targetVersion
	);
}

/**
 * Determine effective display status for a playwright-tests stag, accounting for test failures.
 */
function getEffectiveStageStatus(
	stage: PipelineStage,
	stageStatus: StageStatus,
	run: PipelineRun,
	batches: TestBatch[]
): { status: StageStatus; hasTestFailures: boolean } {
	if (stage !== 'playwright-tests' || stageStatus !== 'complete') {
		return { status: stageStatus, hasTestFailures: false };
	}

	const associatedBatch = findAssociatedBatch(run, batches);
	const hasTestFailures = associatedBatch && (associatedBatch.failed || 0) > 0;

	return {
		status: hasTestFailures ? 'failed' : stageStatus,
		hasTestFailures: !!hasTestFailures,
	};
}

export function PipelineProgress({ run, realtimeLogs, batches, onCancel }: Props) {
	const [expandedStage, setExpandedStage] = useState<PipelineStage | null>(
		null,
	);
	const [isCancelling, setIsCancelling] = useState(false);
	const [cancelDialog, setCancelDialog] = useState(false);
	const [followLogs, setFollowLogs] = useState(true);
	const logRefs = useRef<Record<PipelineStage, HTMLDivElement | null>>({
		'client-deployment': null,
		'master-apps': null,
		'ava-tests': null,
		'japa-tests': null,
		'db-reseed': null,
		'playwright-tests': null,
	});

	// Auto-scroll to bottom when new logs arrive and follow is enabled
	// biome-ignore lint/correctness/useExhaustiveDependencies: realtimeLogs and run are intentional trigger dependencies to re-scroll when logs change
	useEffect(() => {
		if (followLogs && expandedStage) {
			const logContainer = logRefs.current[expandedStage];
			if (logContainer) {
				logContainer.scrollTop = logContainer.scrollHeight;
			}
		}
	}, [realtimeLogs, run, followLogs, expandedStage]);

	const handleCancelClick = () => {
		setCancelDialog(true);
	};

	const handleConfirmCancel = () => {
		if (!run) return;
		setIsCancelling(true);
		setCancelDialog(false);
		onCancel(run.id);
	};

	// Empty state when no pipeline data exists
	if (!run) {
		return (
			<div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
				<span className="text-slate-500 text-sm">No pipeline runs yet</span>
			</div>
		);
	}

	// Compute stage logs: merge historical logs from run object with real-time logs
	const getStageLogs = (stage: PipelineStage) => {
		// Get historical logs from run object
		const historicalLogs = run.stages[stage].logs.map((message) => ({
			runId: run.id,
			stage,
			message,
			timestamp: run.stages[stage].startedAt || run.startedAt || '',
		}));

		// Get real-time logs for this stage
		const realtime = realtimeLogs.filter(
			(l) => l.runId === run.id && l.stage === stage,
		);

		// Deduplicate: real-time logs may also be in historical after queue update
		const historicalMessages = new Set(historicalLogs.map((l) => l.message));
		const uniqueRealtime = realtime.filter(
			(l) => !historicalMessages.has(l.message),
		);

		return [...historicalLogs, ...uniqueRealtime];
	};

	// Check if run is completed (not actively running)
	const isCompleted = !!run.completedAt;
	const hasFailed = STAGE_ORDER.some((stage) => {
		const { status } = getEffectiveStageStatus(stage, run.stages[stage].status, run, batches);
		return status === 'failed';
	});
	const wasCancelled = Object.values(run.stages).some((s) => s.status === 'cancelled');
	const isRunning = Object.values(run.stages).some((s) => s.status === 'running');

	// Determine container and completion status based on state
	const completionStatus = isCompleted ? getCompletionStatus(hasFailed, wasCancelled) : null;
	let containerClass = 'bg-blue-50 border-blue-200';
	if (isCompleted) {
		if (hasFailed) {
			containerClass = 'bg-red-50 border-red-200';
		} else if (wasCancelled) {
			containerClass = 'bg-amber-50 border-amber-200';
		} else {
			containerClass = 'bg-green-50 border-green-200';
		}
	}

	return (
		<div className={`${containerClass} border rounded-lg p-4 mb-4`}>
			<div className="flex items-center justify-between mb-3">
				<div>
					<span className="font-semibold text-slate-800">
						{run.branch}
					</span>
					{run.resolvedBranch &&
						run.resolvedBranch !== run.branch && (
							<span className="text-slate-500 text-sm ml-2">
								→ {run.resolvedBranch}
							</span>
						)}
					<span className="text-slate-500 text-sm ml-2">
						({run.requester})
					</span>
					{completionStatus && (
						<span className={`text-xs ml-2 px-2 py-0.5 rounded ${completionStatus.badgeClass}`}>
							{completionStatus.label}
						</span>
					)}
				</div>
				<div className="flex items-center gap-3">
					{run.startedAt && (
						<span className="text-sm text-slate-600">
							<ElapsedTime started={run.startedAt} completed={run.completedAt} />
						</span>
					)}
					{isRunning && (
						<button
							type="button"
							onClick={handleCancelClick}
							disabled={isCancelling}
							className="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 rounded hover:bg-red-200 transition-colors disabled:opacity-50"
						>
							{isCancelling ? 'Cancelling...' : 'Cancel'}
						</button>
					)}
				</div>
			</div>

			{/* Expandable log sections */}
			<div className="space-y-1">
				{STAGE_ORDER.map((stage) => {
					const stageState = run.stages[stage];
					const stageLogs = getStageLogs(stage);
					const isExpanded = expandedStage === stage;
					const hasContent =
						stageLogs.length > 0 || stageState.status !== 'pending';

					// Check effective status (accounts for test failures in playwright-tests)
					const { status: effectiveStatus } = getEffectiveStageStatus(
						stage,
						stageState.status,
						run,
						batches
					);
					const showFailIcon = effectiveStatus === 'failed';
					const showSuccessIcon = stageState.status === 'complete' && !showFailIcon;

					return (
						<div
							key={stage}
							className="border-l-2 border-slate-200 pl-3"
						>
							<button
								type="button"
								onClick={() =>
									setExpandedStage(isExpanded ? null : stage)
								}
								disabled={!hasContent}
								className={`flex items-center gap-2 text-xs w-full text-left py-1 ${
									hasContent
										? 'hover:bg-slate-100 cursor-pointer'
										: 'cursor-default opacity-50'
								}`}
							>
								<span>{isExpanded ? '▼' : '▶'}</span>
								<span className="font-medium">
									{STAGE_LABELS[stage]}
								</span>
								{showSuccessIcon && (
									<span className="text-green-600">{'\u2713'}</span>
								)}
								{stageState.status === 'running' && (
									<span className="text-blue-600">(running...)</span>
								)}
								{showFailIcon && (
									<span className="text-red-600">{'\u2717'}</span>
								)}
							</button>

							{isExpanded && stageLogs.length > 0 && (
								<div className="ml-4 mt-1 mb-2">
									<div className="flex items-center justify-end mb-1">
										<label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
											<input
												type="checkbox"
												checked={followLogs}
												onChange={(e) => setFollowLogs(e.target.checked)}
												className="w-3 h-3 rounded border-slate-300 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
											/>
											Follow
										</label>
									</div>
									<div
										ref={(el) => { logRefs.current[stage] = el; }}
										className="bg-slate-800 text-slate-200 rounded p-2 text-xs font-mono max-h-40 overflow-y-auto"
									>
										{stageLogs.map((log, i) => (
											<div
												key={`${log.timestamp}-${i}`}
												className="whitespace-pre-wrap break-all"
											>
												{log.message}
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					);
				})}
			</div>

			{/* Cancel Pipeline Confirmation Dialog */}
			<ConfirmDialog
				open={cancelDialog}
				onOpenChange={setCancelDialog}
				title="Cancel Pipeline Run"
				description={`Are you sure you want to cancel the pipeline run for "${run.branch}"?`}
				confirmLabel="Cancel Pipeline"
				cancelLabel="Keep Running"
				onConfirm={handleConfirmCancel}
				variant="destructive"
			/>
		</div>
	);
}
