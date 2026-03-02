import { useState, useCallback, useEffect, useRef } from 'react';
import { validateBranch, startPipeline } from '../utils/api';

interface Props {
	onStart: () => void;
	disabled?: boolean;
}

type ValidationState = 'idle' | 'validating' | 'valid' | 'invalid';

const DEFAULT_CLIENTS = 12;
const CLIENTS_STORAGE_KEY = 'pipeline-clients-count';

function getClientsCount(): number {
	const stored = localStorage.getItem(CLIENTS_STORAGE_KEY);
	return stored ? parseInt(stored, 10) : DEFAULT_CLIENTS;
}

export function PipelineForm({ onStart, disabled = false }: Props) {
	const [branch, setBranch] = useState('');
	const [requester, setRequester] = useState('');
	const [validationState, setValidationState] =
		useState<ValidationState>('idle');
	const [validationMessage, setValidationMessage] = useState('');
	const [, setResolvedBranch] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Debounced branch validation
	const validateBranchDebounced = useCallback((value: string) => {
		if (debounceRef.current) {
			clearTimeout(debounceRef.current);
		}

		if (!value.trim()) {
			setValidationState('idle');
			setValidationMessage('');
			setResolvedBranch(null);
			return;
		}

		setValidationState('validating');

		debounceRef.current = setTimeout(async () => {
			try {
				const result = await validateBranch(value.trim());
				setValidationState(result.valid ? 'valid' : 'invalid');
				setValidationMessage(result.message);
				setResolvedBranch(result.resolvedBranch);
			} catch (err) {
				console.error('Branch validation error:', err);
				setValidationState('invalid');
				setValidationMessage('Validation failed');
				setResolvedBranch(null);
			}
		}, 300);
	}, []);

	// Cleanup debounce on unmount
	useEffect(() => {
		return () => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
		};
	}, []);

	const handleBranchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setBranch(value);
		setError(null);
		validateBranchDebounced(value);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (validationState !== 'valid' || !requester.trim()) {
			return;
		}

		setIsSubmitting(true);
		setError(null);

		try {
			await startPipeline(
				branch.trim(),
				requester.trim(),
				getClientsCount(),
			);
			onStart();
			// Don't clear form - user might want to run same branch again
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Failed to start pipeline',
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	const canSubmit =
		validationState === 'valid' &&
		requester.trim() &&
		!isSubmitting &&
		!disabled;

	return (
		<form
			onSubmit={handleSubmit}
			className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4"
		>
			<h3 className="text-sm font-semibold text-slate-700 mb-3">
				Start New Pipeline
			</h3>

			<div className="flex flex-wrap gap-3 items-start">
				<div className="flex-1 min-w-50">
					<label htmlFor="pipeline-branch" className="block text-xs font-medium text-slate-600 mb-1">
						Branch
					</label>
					<div className="relative">
						<input
							id="pipeline-branch"
							type="text"
							value={branch}
							onChange={handleBranchChange}
							placeholder="MN-4000 or branch name"
							disabled={disabled || isSubmitting}
							className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-100"
						/>
						<div className="absolute right-2 top-1/2 -translate-y-1/2">
							{validationState === 'validating' && (
								<span className="inline-block w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
							)}
							{validationState === 'valid' && (
								<span className="text-green-500 text-sm">
									✓
								</span>
							)}
							{validationState === 'invalid' && (
								<span className="text-red-500 text-sm">✗</span>
							)}
						</div>
					</div>
					{validationMessage && (
						<p
							className={`text-xs mt-1 ${validationState === 'valid' ? 'text-green-600' : 'text-red-600'}`}
						>
							{validationMessage}
						</p>
					)}
				</div>

				<div className="flex-1 min-w-[150px]">
					<label htmlFor="pipeline-requester" className="block text-xs font-medium text-slate-600 mb-1">
						Requester
					</label>
					<input
						id="pipeline-requester"
						type="text"
						value={requester}
						onChange={(e) => {
							setRequester(e.target.value);
							setError(null);
						}}
						placeholder="Your name"
						disabled={disabled || isSubmitting}
						className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-100"
					/>
				</div>

				<div>
					<span className="block text-xs font-medium text-transparent mb-1 select-none">
						&nbsp;
					</span>
					<button
						type="submit"
						disabled={!canSubmit}
						className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
					>
						{isSubmitting ? 'Starting...' : 'Start Pipeline'}
					</button>
				</div>
			</div>

			{error && <p className="text-sm text-red-600 mt-2">{error}</p>}
		</form>
	);
}
