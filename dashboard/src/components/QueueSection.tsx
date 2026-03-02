import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { fetchBatchStatus, fetchQueue, cancelBatch, cancelPipelineRun, purgeOldReports } from '../utils/api';
import { formatTimestamp, formatElapsed, formatDuration } from '../utils/time';
import { useElapsedTicker } from '../hooks/usePolling';
import { useEventSource } from '../hooks/useEventSource';
import { usePipelineEvents } from '../hooks/usePipelineEvents';
import { StatusBadge } from './StatusBadge';
import { PipelineForm } from './PipelineForm';
import { PipelineProgress } from './PipelineProgress';
import { PipelineQueue } from './PipelineQueue';
import { CollapsibleSection } from './CollapsibleSection';
import { BatchDetailsModal } from './BatchDetailsModal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PlaywrightIcon } from './icons';
import type { TestBatch } from '../types';

function ElapsedTime({ started }: { started: string }) {
	const [elapsed, setElapsed] = useState(formatElapsed(started));

	useElapsedTicker(() => {
		setElapsed(formatElapsed(started));
	});

	return <span>{elapsed}</span>;
}

function ResultsCell({ batch }: { batch: TestBatch }) {
	const done = (batch.passed || 0) + (batch.failed || 0);
	const total = done + (batch.running || 0) + (batch.pending || 0);

	if (total === 0) return <>-</>;

	return (
		<span className="inline-flex items-center">
			<PlaywrightIcon className="w-5 h-5 mt-2 text-green-600" />
			{done}/{total}
		</span>
	);
}

function DurationCell({ batch }: { batch: TestBatch }) {
	if (batch.status === 'running' && batch.started) {
		return <ElapsedTime started={batch.started} />;
	}

	if (batch.status !== 'running' && batch.started && batch.ended) {
		return <span>{formatDuration(batch.started, batch.ended)}</span>;
	}

	return <>-</>;
}

function ActionsCell({
	batch,
	loadingBatch,
	onViewDetails,
	onCancel,
}: {
	batch: TestBatch;
	loadingBatch: string | null;
	onViewDetails: (timestamp: string) => void;
	onCancel: (timestamp: string) => void;
}) {
	const canCancel = batch.status === 'pending' || batch.status === 'running';
	const hasReport = batch.status === 'finished' && batch.report_url;

	return (
		<>
			{hasReport ? (
				<a
					href={batch.report_url}
					target="_blank"
					rel="noopener noreferrer"
					className="text-blue-600 hover:text-blue-800 hover:underline text-xs"
				>
					View Report
				</a>
			) : null}
			<button
				type="button"
				onClick={() => onViewDetails(batch.timestamp)}
				disabled={loadingBatch === batch.timestamp}
				className="px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 rounded hover:bg-slate-200 transition-colors disabled:opacity-50"
			>
				{loadingBatch === batch.timestamp ? (
					<span className="inline-block w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
				) : (
					'Details'
				)}
			</button>

			{canCancel && (
				<button
					type="button"
					onClick={() => onCancel(batch.timestamp)}
					className="px-2 py-1 text-xs font-medium text-amber-700 bg-amber-100 rounded hover:bg-amber-200 transition-colors"
				>
					Cancel
				</button>
			)}
		</>
	);
}

export function QueueSection() {
	// Test queue state
	const [batches, setBatches] = useState<TestBatch[]>([]);
	const [batchDetails, setBatchDetails] = useState<TestBatch | null>(null);
	const [testQueueError, setTestQueueError] = useState<string | null>(null);

	// Modal state
	const [modalOpen, setModalOpen] = useState(false);
	const [loadingBatch, setLoadingBatch] = useState<string | null>(null);

	// Cancel dialog state
	const [cancelDialog, setCancelDialog] = useState<{
		open: boolean;
		timestamp: string | null;
	}>({
		open: false,
		timestamp: null,
	});
	const [isCancelling, setIsCancelling] = useState(false);

	// Purge old reports dialog state
	const [purgeDialog, setPurgeDialog] = useState(false);
	const [isPurging, setIsPurging] = useState(false);

	// Pipeline state
	const {
		current: currentPipeline,
		last: lastPipeline,
		queue: pipelineQueue,
		realtimeLogs: pipelineRealtimeLogs,
		error: pipelineError,
		requestNotificationPermission,
	} = usePipelineEvents();

	// Track the last fetched batch state to detect count changes
	const lastFetchedCountsRef = useRef<{ timestamp: string; passed: number; failed: number } | null>(null);

	const handleQueueUpdate = useCallback((data: TestBatch[]) => {
		setBatches(data);
		setTestQueueError(null);

		// Update modal batch details if modal is open
		setBatchDetails((current) => {
			if (!current) return null;
			const updated = data.find((b) => b.timestamp === current.timestamp);
			if (!updated) return current;

			// Merge: use updated summary counts but preserve tests if SSE doesn't include them
			return {
				...current,
				...updated,
				tests: updated.tests?.length ? updated.tests : current.tests,
			};
		});
	}, []);

	useEventSource<TestBatch[]>('/queue/stream', handleQueueUpdate, {
		onError: () => setTestQueueError('Connection lost - reconnecting...'),
	});

	// Re-fetch batch details when test counts change (e.g., after rerun completes)
	const batchTimestamp = batchDetails?.timestamp;
	useEffect(() => {
		if (!modalOpen || !batchTimestamp) return;

		const currentBatch = batches.find((b) => b.timestamp === batchTimestamp);
		if (!currentBatch) return;

		const lastCounts = lastFetchedCountsRef.current;
		const countsChanged =
			lastCounts?.timestamp === batchTimestamp &&
			(currentBatch.passed !== lastCounts.passed ||
				currentBatch.failed !== lastCounts.failed);

		if (countsChanged) {
			// Re-fetch to get updated test details with new statuses
			fetchBatchStatus(batchTimestamp)
				.then((data) => {
					setBatchDetails(data);
					lastFetchedCountsRef.current = {
						timestamp: data.timestamp,
						passed: data.passed || 0,
						failed: data.failed || 0,
					};
				})
				.catch(() => {
					// Silently fail - SSE will provide updates
				});
		}
	}, [modalOpen, batchTimestamp, batches]);

	async function handleViewBatch(timestamp: string) {
		setLoadingBatch(timestamp);
		try {
			const data = await fetchBatchStatus(timestamp);
			setBatchDetails(data);
			// Track initial counts to detect changes from reruns
			lastFetchedCountsRef.current = {
				timestamp: data.timestamp,
				passed: data.passed || 0,
				failed: data.failed || 0,
			};
			setModalOpen(true);
		} catch (err) {
			toast.error(
				err instanceof Error
					? err.message
					: 'Failed to load batch details',
			);
		} finally {
			setLoadingBatch(null);
		}
	}

	function openCancelDialog(timestamp: string) {
		setCancelDialog({ open: true, timestamp });
	}

	async function handleConfirmCancel() {
		if (!cancelDialog.timestamp) return;

		setIsCancelling(true);
		try {
			await cancelBatch(cancelDialog.timestamp);
			setCancelDialog({ open: false, timestamp: null });
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : 'Failed to cancel batch',
			);
		} finally {
			setIsCancelling(false);
		}
	}

	async function handleCancelPipeline(runId: string) {
		try {
			await cancelPipelineRun(runId);
		} catch (err) {
			toast.error(
				err instanceof Error
					? err.message
					: 'Failed to cancel pipeline',
			);
		}
	}

	function handlePipelineStart() {
		requestNotificationPermission();
	}

	async function handleConfirmPurge() {
		setIsPurging(true);
		try {
			const result = await purgeOldReports();
			setPurgeDialog(false);
			toast.success(`Purged ${result.removed_count} old report(s)`);
			// Refresh the queue to reflect the purge
			const updatedQueue = await fetchQueue();
			setBatches(updatedQueue);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : 'Failed to purge reports',
			);
		} finally {
			setIsPurging(false);
		}
	}

	const liveBadge = (
		<span className="text-xs text-slate-500">Live updates</span>
	);

	return (
		<CollapsibleSection title="Test Pipeline" badge={liveBadge}>
			{/* Pipeline Form */}
			<PipelineForm
				onStart={handlePipelineStart}
			/>

			{/* Current Pipeline Run */}
			<PipelineProgress
				run={currentPipeline ?? lastPipeline}
				realtimeLogs={pipelineRealtimeLogs}
				batches={batches}
				onCancel={handleCancelPipeline}
			/>

			{/* Pipeline Queue */}
			<PipelineQueue
				queue={pipelineQueue}
				onRemove={handleCancelPipeline}
			/>

			{/* Divider */}
			{batches.length > 0 && <hr className="my-6 border-slate-200" />}

			{/* Existing Test Queue (below pipeline) */}
			{(testQueueError || pipelineError) && (
				<p className="text-sm text-red-600 mb-3">
					{testQueueError || pipelineError}
				</p>
			)}

			{batches.length > 0 && (
				<>
					<div className="flex items-center justify-between mb-2">
						<h3 className="text-sm font-semibold text-slate-700">
							Playwright monitor
						</h3>
						<button
							type="button"
							onClick={() => setPurgeDialog(true)}
							disabled={isPurging}
							className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-amber-100 rounded-md hover:bg-amber-200 disabled:bg-slate-100 disabled:cursor-not-allowed transition-colors"
						>
							{isPurging ? 'Purging...' : 'Purge Old (24h)'}
						</button>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="bg-slate-50 border-b border-slate-200">
									<th className="text-left px-3 py-2 font-medium text-slate-600">
										Timestamp
									</th>
									<th className="text-left px-3 py-2 font-medium text-slate-600">
										Version
									</th>
									<th className="text-left px-3 py-2 font-medium text-slate-600">
										Requester
									</th>
									<th className="text-left px-3 py-2 font-medium text-slate-600">
										Status
									</th>
									<th className="text-left px-3 py-2 font-medium text-slate-600">
										Results
									</th>
									<th className="text-left px-3 py-2 font-medium text-slate-600">
										Duration
									</th>
									<th className="text-left px-3 py-2 font-medium text-slate-600">
										Actions
									</th>
								</tr>
							</thead>
							<tbody>
								{batches.map((b) => (
										<tr
											key={b.timestamp}
											className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
										>
											<td className="px-3 py-2 text-slate-600">
												{formatTimestamp(b.timestamp)}
											</td>
											<td className="px-3 py-2 font-mono text-slate-700">
												{b.version || '-'}
											</td>
											<td className="px-3 py-2 text-slate-600">
												{b.requester || '-'}
											</td>
											<td className="px-3 py-2">
												<StatusBadge
													status={b.status}
													allPassed={b.status === 'finished' && b.failed === 0 && (b.passed || 0) > 0}
												/>
											</td>
											<td className="px-3 py-2 text-slate-600">
												<ResultsCell batch={b} />
											</td>
											<td className="px-3 py-2 text-slate-600">
												<DurationCell batch={b} />
											</td>
											<td className="px-3 py-2 space-x-2">
												<ActionsCell
													batch={b}
													loadingBatch={loadingBatch}
													onViewDetails={handleViewBatch}
													onCancel={openCancelDialog}
												/>
											</td>
										</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			)}

			{/* Batch Details Modal */}
			<BatchDetailsModal
				open={modalOpen}
				onOpenChange={setModalOpen}
				batch={batchDetails}
				isLatestBatch={batchDetails?.timestamp === batches[0]?.timestamp}
			/>

			{/* Cancel Batch Confirmation Dialog */}
			<ConfirmDialog
				open={cancelDialog.open}
				onOpenChange={(open) =>
					setCancelDialog({
						open,
						timestamp: open ? cancelDialog.timestamp : null,
					})
				}
				title="Cancel Test Batch"
				description={`Are you sure you want to cancel batch ${cancelDialog.timestamp ? formatTimestamp(cancelDialog.timestamp) : ''}?`}
				confirmLabel="Cancel Batch"
				cancelLabel="Keep Running"
				onConfirm={handleConfirmCancel}
				variant="destructive"
				isLoading={isCancelling}
			/>

			{/* Purge Old Reports Confirmation Dialog */}
			<ConfirmDialog
				open={purgeDialog}
				onOpenChange={setPurgeDialog}
				title="Purge Old Reports"
				description="This will delete all reports older than 24 hours. This action cannot be undone."
				confirmLabel="Purge"
				cancelLabel="Cancel"
				onConfirm={handleConfirmPurge}
				variant="destructive"
				isLoading={isPurging}
			/>
		</CollapsibleSection>
	);
}
