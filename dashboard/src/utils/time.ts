import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const TIMESTAMP_FORMAT = 'YYYYMMDDTHHmmss.SSS';

// Helper to format seconds as "Xm XXs"
function formatSecondsAsMinSec(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins}m${secs.toString().padStart(2, '0')}s`;
}

// Format raw timestamp to human-readable local time
// Supports both custom TIMESTAMP_FORMAT and ISO format
export function formatTimestamp(raw: string | undefined): string {
	if (!raw || raw === '-') return '-';

	// Detect ISO format (contains dashes like '2026-01-20T...')
	const isIsoFormat = raw.includes('-');

	const parsed = isIsoFormat
		? dayjs.utc(raw) // ISO format auto-parsed
		: dayjs.utc(raw, TIMESTAMP_FORMAT); // Custom format

	return parsed.tz('Europe/Warsaw').format('DD.MM.YYYY HH:mm:ss');
}

// Helper to parse timestamp (supports both formats)
function parseTimestamp(raw: string): dayjs.Dayjs {
	const isIsoFormat = raw.includes('-');
	return isIsoFormat ? dayjs.utc(raw) : dayjs.utc(raw, TIMESTAMP_FORMAT);
}

// Calculate elapsed time from start to now
export function formatElapsed(started?: string, completed?: string): string {
	if (!started) return '';
	const start = parseTimestamp(started);
	const finish = completed ? parseTimestamp(completed) : dayjs().utc();
	const seconds = finish.diff(start, 'second');
	return formatSecondsAsMinSec(seconds);
}

// Calculate duration between start and end
export function formatDuration(
	started: string | undefined,
	ended: string | undefined,
): string {
	if (!started || !ended) return '';
	const start = parseTimestamp(started);
	const end = parseTimestamp(ended);
	const seconds = end.diff(start, 'second');
	return formatSecondsAsMinSec(seconds);
}
