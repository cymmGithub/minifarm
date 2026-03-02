import { useState, useEffect, useCallback, useRef } from 'react';
import type { PipelineRun, PipelineStage, StageStatus } from '../types';

interface PipelineState {
	current: PipelineRun | null;
	last: PipelineRun | null;
	queue: PipelineRun[];
	error: string | null;
}

export interface LogEntry {
	runId: string;
	stage: PipelineStage;
	message: string;
	timestamp: string;
}

export function usePipelineEvents() {
	const [state, setState] = useState<PipelineState>({
		current: null,
		last: null,
		queue: [],
		error: null,
	});

	// Track only NEW real-time logs (for current run during active session)
	const [realtimeLogs, setRealtimeLogs] = useState<LogEntry[]>([]);
	const eventSourceRef = useRef<EventSource | null>(null);

	// Request notification permission
	const requestNotificationPermission = useCallback(async () => {
		if ('Notification' in window && Notification.permission === 'default') {
			await Notification.requestPermission();
		}
	}, []);

	const showNotification = useCallback((title: string, body: string) => {
		if ('Notification' in window && Notification.permission === 'granted') {
			const notification = new Notification(title, {
				body,
				tag: 'pipeline-complete',
			});
			notification.onclick = () => {
				window.focus();
				notification.close();
			};
		}
	}, []);

	useEffect(() => {
		const es = new EventSource('/pipeline/stream');
		eventSourceRef.current = es;

		// Queue update (includes current + queue)
		// Merge logs to preserve any we've accumulated locally
		es.addEventListener('queue', (event) => {
			const data = JSON.parse(event.data);
			setState((prev) => {
				// If no previous current or different run, just use the new one
				if (
					!prev.current ||
					!data.current ||
					prev.current.id !== data.current.id
				) {
					return {
						...prev,
						current: data.current,
						queue: data.queue,
						error: null,
					};
				}

				// Same run - merge logs from both sources for each stage
				const mergedStages = { ...data.current.stages };
				for (const stage of Object.keys(mergedStages) as PipelineStage[]) {
					const prevLogs = prev.current.stages[stage]?.logs || [];
					const newLogs = data.current.stages[stage]?.logs || [];

					// Merge logs: start with previous, add any new ones
					const allLogs = [...prevLogs];
					for (const log of newLogs) {
						if (!allLogs.includes(log)) {
							allLogs.push(log);
						}
					}

					mergedStages[stage] = {
						...data.current.stages[stage],
						logs: allLogs,
					};
				}

				return {
					...prev,
					current: {
						...data.current,
						stages: mergedStages,
					},
					queue: data.queue,
					error: null,
				};
			});
		});

		// Run started - clear realtime logs for new run
		es.addEventListener('run:started', (event) => {
			const run = JSON.parse(event.data) as PipelineRun;
			setState((prev) => ({ ...prev, current: run }));
			setRealtimeLogs([]);
		});

		// Run complete
		es.addEventListener('run:complete', (event) => {
			const run = JSON.parse(event.data) as PipelineRun;
			setState((prev) => ({
				...prev,
				current: null,
				last: run,
			}));
			showNotification('Pipeline Complete', `${run.branch} - Tests finished`);
		});

		// Run failed
		es.addEventListener('run:failed', (event) => {
			const run = JSON.parse(event.data) as PipelineRun;
			setState((prev) => ({
				...prev,
				current: null,
				last: run,
			}));
			showNotification(
				'Pipeline Failed',
				`${run.branch} - ${run.error || 'Unknown error'}`,
			);
		});

		// Run cancelled
		es.addEventListener('run:cancelled', (event) => {
			const run = JSON.parse(event.data) as PipelineRun;
			setState((prev) => ({
				...prev,
				current: prev.current?.id === run.id ? null : prev.current,
				last: prev.current?.id === run.id ? run : prev.last,
			}));
		});

		// Stage updates
		function handleStageUpdate(status: StageStatus) {
			return (event: MessageEvent) => {
				const { runId, stage } = JSON.parse(event.data) as {
					runId: string;
					stage: PipelineStage;
				};
				setState((prev) => {
					if (!prev.current || prev.current.id !== runId) return prev;

					const now = new Date().toISOString();
					const stageUpdate = {
						...prev.current.stages[stage],
						status,
						startedAt:
							status === 'running'
								? now
								: prev.current.stages[stage].startedAt,
						completedAt: status !== 'running' ? now : undefined,
					};

					return {
						...prev,
						current: {
							...prev.current,
							stages: {
								...prev.current.stages,
								[stage]: stageUpdate,
							},
						},
					};
				});
			};
		}

		es.addEventListener('stage:started', handleStageUpdate('running'));
		es.addEventListener('stage:complete', handleStageUpdate('complete'));
		es.addEventListener('stage:failed', handleStageUpdate('failed'));

		// Log messages - append to realtime logs AND update current run's stage logs
		es.addEventListener('log', (event) => {
			const entry = JSON.parse(event.data) as LogEntry;
			setRealtimeLogs((prev) => [...prev, entry].slice(-500));

			// Also update the current run's stage logs to keep them in sync
			setState((prev) => {
				if (!prev.current || prev.current.id !== entry.runId) return prev;

				const currentStageLogs = prev.current.stages[entry.stage].logs;

				// Only add if not already present (avoid duplicates)
				if (currentStageLogs.includes(entry.message)) {
					return prev;
				}

				return {
					...prev,
					current: {
						...prev.current,
						stages: {
							...prev.current.stages,
							[entry.stage]: {
								...prev.current.stages[entry.stage],
								logs: [...currentStageLogs, entry.message],
							},
						},
					},
				};
			});
		});

		// Error handling
		es.onerror = () => {
			setState((prev) => ({
				...prev,
				error: 'Connection lost - reconnecting...',
			}));
		};

		return () => {
			es.close();
			eventSourceRef.current = null;
		};
	}, [showNotification]);

	return {
		...state,
		realtimeLogs,  // Only new logs from this session
		requestNotificationPermission,
	};
}
