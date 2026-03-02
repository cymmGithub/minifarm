import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { StatusBadge } from './StatusBadge';
import { formatTimestamp } from '../utils/time';
import { rerunTest } from '../utils/api';
import type { TestBatch, Test } from '../types';

interface BatchDetailsModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	batch: TestBatch | null;
	isLatestBatch?: boolean;
}

export function BatchDetailsModal({
	open,
	onOpenChange,
	batch,
	isLatestBatch = false,
}: BatchDetailsModalProps) {
	const [rerunningTests, setRerunningTests] = useState<Set<string>>(new Set());
	const [rerunInitiated, setRerunInitiated] = useState<Set<string>>(new Set());

	if (!batch) return null;

	const { timestamp, tests = [], version, requester } = batch;

	// Group tests by status
	const failedTests = tests.filter((t) => t.status === 'failed');
	const passedTests = tests.filter((t) => t.status === 'passed');
	const runningTests = tests.filter((t) => t.status === 'running');
	const pendingTests = tests.filter((t) => t.status === 'pending');
	const otherTests = tests.filter((t) =>
		!['failed', 'passed', 'running', 'pending'].includes(t.status),
	);

	// Disable rerun while tests are still running or pending
	const hasActiveTests = runningTests.length > 0 || pendingTests.length > 0;

	function getTestKey(test: Test): string {
		return `${test.test_file || ''}::${test.test_name || ''}`;
	}

	function getFullTestName(test: Test): string {
		return `${test.test_file || '-'}::${test.test_name || '-'}`;
	}

	async function copyTestName(test: Test) {
		const fullName = getFullTestName(test);
		try {
			await navigator.clipboard.writeText(fullName);
			toast.success('Copied to clipboard');
		} catch {
			toast.error('Failed to copy');
		}
	}

	async function handleRerun(test: Test) {
		const testKey = getTestKey(test);
		if (!test.test_file || !test.test_name) {
			toast.error('Cannot rerun test: missing test file or name');
			return;
		}

		setRerunningTests((prev) => new Set(prev).add(testKey));
		setRerunInitiated((prev) => new Set(prev).add(testKey));
		try {
			await rerunTest(timestamp, test.test_file, test.test_name);
			toast.success(`Rerun initiated for ${test.test_name}`);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : 'Failed to rerun test',
			);
			// Remove from initiated if failed to start
			setRerunInitiated((prev) => {
				const next = new Set(prev);
				next.delete(testKey);
				return next;
			});
		} finally {
			setRerunningTests((prev) => {
				const next = new Set(prev);
				next.delete(testKey);
				return next;
			});
		}
	}

	function renderTestSection(
		title: string,
		sectionTests: Test[],
		showRerun: boolean,
	) {
		if (sectionTests.length === 0) return null;

		return (
			<div className="mb-4">
				<h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
					{title} ({sectionTests.length})
				</h4>
				<div className="space-y-1">
					{sectionTests.map((test) => {
						const testKey = getTestKey(test);
						const isRerunning = rerunningTests.has(testKey);
						const wasRerun = rerunInitiated.has(testKey);
						const rerunPassed = wasRerun && test.status === 'passed';

						return (
							<div
								key={`${testKey}-${test.status}`}
								className="flex items-center justify-between py-1.5 px-2 bg-slate-50 rounded border border-slate-100"
							>
								<div className="flex items-center gap-2 min-w-0 flex-1">
									<StatusBadge status={test.status} />
									<Tooltip>
										<TooltipTrigger asChild>
											<button
												type="button"
												onClick={() => copyTestName(test)}
												className="font-mono text-xs text-slate-700 truncate cursor-pointer hover:text-slate-900 text-left bg-transparent border-none p-0"
											>
												{test.test_file || '-'}::{test.test_name || '-'}
											</button>
										</TooltipTrigger>
										<TooltipContent side="top" className="max-w-md break-all">
											<p className="font-mono text-xs">{getFullTestName(test)}</p>
											<p className="text-xs text-slate-400 mt-1">Click to copy</p>
										</TooltipContent>
									</Tooltip>
								</div>
								{showRerun && (
									<button
										type="button"
										onClick={() => handleRerun(test)}
										disabled={isRerunning || hasActiveTests}
										title={hasActiveTests ? 'Wait for running tests to complete' : undefined}
										className="ml-2 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded hover:bg-blue-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
									>
										{isRerunning ? (
											<span className="inline-flex items-center gap-1">
												<span className="inline-block w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
												Seeding...
											</span>
										) : (
											'Rerun'
										)}
									</button>
								)}
								{rerunPassed && (
									<span className="ml-2 px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-100 rounded flex-shrink-0 inline-flex items-center gap-1">
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="3"
											strokeLinecap="round"
											strokeLinejoin="round"
											aria-hidden="true"
										>
											<path d="M20 6 9 17l-5-5" />
										</svg>
										Passed
									</span>
								)}
							</div>
						);
					})}
				</div>
			</div>
		);
	}

	return (
		<TooltipProvider>
			<Dialog.Root open={open} onOpenChange={onOpenChange}>
				<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
				<Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-2xl max-h-[85vh] translate-x-[-50%] translate-y-[-50%] border bg-white p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg flex flex-col">
					<Dialog.Title className="text-lg font-semibold text-slate-800 mb-1">
						Batch Details
					</Dialog.Title>
					<Dialog.Description className="text-sm text-slate-500 mb-4">
						{formatTimestamp(timestamp)} &middot; {version || 'No version'} &middot; {requester || 'Unknown'}
					</Dialog.Description>

					<div className="flex-1 overflow-y-auto pr-2">
						{tests.length === 0 ? (
							<p className="text-slate-500 italic text-sm">
								No test details available.
							</p>
						) : (
							<>
								{renderTestSection('Failed', failedTests, isLatestBatch)}
								{renderTestSection('Running', runningTests, false)}
								{renderTestSection('Pending', pendingTests, false)}
								{renderTestSection('Passed', passedTests, false)}
								{renderTestSection('Other', otherTests, false)}
							</>
						)}
					</div>

					<div className="mt-4 pt-4 border-t border-slate-200 flex justify-end">
						<Dialog.Close asChild>
							<button
								type="button"
								className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded hover:bg-slate-200 transition-colors"
							>
								Close
							</button>
						</Dialog.Close>
					</div>

					<Dialog.Close asChild>
						<button
							type="button"
							className="absolute right-4 top-4 text-slate-400 hover:text-slate-600"
							aria-label="Close"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M18 6 6 18" />
								<path d="m6 6 12 12" />
							</svg>
						</button>
					</Dialog.Close>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
		</TooltipProvider>
	);
}
