import { useEffect, useRef } from 'react';

interface UsePollingOptions {
	interval: number;
	enabled?: boolean;
}

export function usePolling(
	callback: () => void | Promise<void>,
	options: UsePollingOptions,
) {
	const { interval, enabled = true } = options;
	const savedCallback = useRef(callback);

	// Remember the latest callback
	useEffect(() => {
		savedCallback.current = callback;
	}, [callback]);

	// Set up the interval
	useEffect(() => {
		if (!enabled) return;

		const tick = () => {
			savedCallback.current();
		};

		// Call immediately on mount
		tick();

		const id = setInterval(tick, interval);
		return () => clearInterval(id);
	}, [interval, enabled]);
}

// Hook for elapsed time ticker (updates every second)
export function useElapsedTicker(callback: () => void) {
	usePolling(callback, { interval: 1000, enabled: true });
}
