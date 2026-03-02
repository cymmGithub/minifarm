import { useState } from 'react';
import type { PipelineRun } from '../types';
import { formatTimestamp } from '../utils/time';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';

interface Props {
	queue: PipelineRun[];
	onRemove: (runId: string) => void;
}

export function PipelineQueue({ queue, onRemove }: Props) {
	const [removeDialog, setRemoveDialog] = useState<{
		open: boolean;
		runId: string | null;
		branch: string | null;
	}>({
		open: false,
		runId: null,
		branch: null,
	});

	if (queue.length === 0) {
		return null;
	}

	const openRemoveDialog = (runId: string, branch: string) => {
		setRemoveDialog({ open: true, runId, branch });
	};

	const handleConfirmRemove = () => {
		if (removeDialog.runId) {
			onRemove(removeDialog.runId);
		}
		setRemoveDialog({ open: false, runId: null, branch: null });
	};

	return (
		<TooltipProvider>
			<div className="mb-4">
				<h3 className="text-sm font-semibold text-slate-700 mb-2">
					Queued ({queue.length})
				</h3>
				<div className="space-y-1">
					{queue.map((run, index) => (
						<div
							key={run.id}
							className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-3 py-2"
						>
							<div className="flex items-center gap-3">
								<span className="text-slate-400 text-sm font-mono">
									{index + 1}.
								</span>
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="font-medium text-slate-700 max-w-[200px] truncate cursor-help">
											{run.branch}
										</span>
									</TooltipTrigger>
									<TooltipContent
										side="top"
										className="max-w-[400px]"
									>
										<p className="text-sm font-mono break-all">
											{run.branch}
										</p>
									</TooltipContent>
								</Tooltip>
								<span className="text-slate-500 text-sm">
									({run.requester})
								</span>
								<span className="text-slate-400 text-xs">
									{formatTimestamp(run.queuedAt)}
								</span>
							</div>
							<button
								type="button"
								onClick={() =>
									openRemoveDialog(run.id, run.branch)
								}
								className="px-2 py-1 text-xs font-medium text-slate-600 bg-slate-200 rounded hover:bg-slate-300 transition-colors"
							>
								Remove
							</button>
						</div>
					))}
				</div>

				{/* Remove from Queue Confirmation Dialog */}
				<ConfirmDialog
					open={removeDialog.open}
					onOpenChange={(open) =>
						setRemoveDialog({
							open,
							runId: open ? removeDialog.runId : null,
							branch: open ? removeDialog.branch : null,
						})
					}
					title="Remove from Queue"
					description={`Are you sure you want to remove "${removeDialog.branch}" from the queue?`}
					confirmLabel="Remove"
					cancelLabel="Keep in Queue"
					onConfirm={handleConfirmRemove}
					variant="destructive"
				/>
			</div>
		</TooltipProvider>
	);
}
