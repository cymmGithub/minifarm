import { useEffect, useRef } from 'react';

interface UseEventSourceOptions {
	/** Whether to enable the connection (default: true) */
	enabled?: boolean;
	/** Fallback to polling if SSE fails */
	onError?: (error: Event) => void;
}

export function useEventSource<T>(
	url: string,
	onMessage: (data: T) => void,
	options: UseEventSourceOptions = {},
) {
	const { enabled = true, onError } = options;
	const savedOnMessage = useRef(onMessage);
	const savedOnError = useRef(onError);

	// Keep refs updated with latest callbacks
	useEffect(() => {
		savedOnMessage.current = onMessage;
	}, [onMessage]);

	useEffect(() => {
		savedOnError.current = onError;
	}, [onError]);

	useEffect(() => {
		if (!enabled) return;

		const es = new EventSource(url);

		es.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data) as T;
				savedOnMessage.current(data);
			} catch (err) {
				console.error('Failed to parse SSE message:', err);
			}
		};

		es.onerror = (event) => {
			savedOnError.current?.(event);
			// EventSource auto-reconnects on error, no need to manually reconnect
		};

		return () => {
			es.close();
		};
	}, [url, enabled]);
}
