import type { BatchStatus, TestStatus } from '../types';

type Status = BatchStatus | TestStatus;

interface StatusBadgeProps {
	status: Status;
	allPassed?: boolean;
}

const styles: Record<string, string> = {
	passed: 'bg-emerald-100 text-emerald-700',
	finished: 'bg-emerald-100 text-emerald-700',
	failed: 'bg-red-100 text-red-700',
	pending: 'bg-amber-100 text-amber-700',
	running: 'bg-blue-100 text-blue-700',
	canceled: 'bg-slate-100 text-slate-600',
	incorrect: 'bg-orange-100 text-orange-700',
};

const greyStyle = 'bg-slate-100 text-slate-600';

function getStyle(status: Status, allPassed?: boolean): string {
	// For 'finished' status: green only if allPassed is explicitly true
	if (status === 'finished' && allPassed !== true) {
		return greyStyle;
	}
	return styles[status] || styles.pending;
}

export function StatusBadge({ status, allPassed }: StatusBadgeProps) {
	return (
		<span
			className={`inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase ${getStyle(status, allPassed)}`}
		>
			{status}
		</span>
	);
}
