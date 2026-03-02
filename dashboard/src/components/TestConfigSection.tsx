import { useState, useEffect, useCallback } from 'react';
import { fetchFilter, setFilter, fetchClientsStatus } from '../utils/api';
import { CollapsibleSection } from './CollapsibleSection';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Client } from '../types';

const DEFAULT_CLIENTS_COUNT = 12;
const CLIENTS_STORAGE_KEY = 'pipeline-clients-count';
const DEBUG_MODE = import.meta.env.VITE_DEBUG_MODE === 'on';

function ClientSlot({ client }: { client: Client | null }) {
	if (!client) {
		return (
			<div className="w-8 h-8 rounded border-2 border-dashed border-slate-200 bg-slate-50" />
		);
	}

	const bgColor = client.alive === true ? 'bg-emerald-500' : 'bg-red-500';

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className={`w-8 h-8 rounded ${bgColor} cursor-help`} />
			</TooltipTrigger>
			<TooltipContent side="top" className="text-xs">
				<div className="space-y-1">
					<p>
						<span className="text-slate-400">ID:</span> {client.id}
					</p>
					<p>
						<span className="text-slate-400">URL:</span>{' '}
						{client.url}
					</p>
					<p>
						<span className="text-slate-400">MAC:</span>{' '}
						{client.mac || '-'}
					</p>
					<p>
						<span className="text-slate-400">Workers:</span>{' '}
						{client.workers}
					</p>
				</div>
			</TooltipContent>
		</Tooltip>
	);
}

export function TestConfigSection() {
	// Filter state
	const [pattern, setPattern] = useState('');
	const [savedPattern, setSavedPattern] = useState('');
	const [isApplying, setIsApplying] = useState(false);
	const [filterError, setFilterError] = useState<string | null>(null);

	// Clients count (persisted in localStorage)
	const [clientsCount, setClientsCount] = useState(() => {
		const stored = localStorage.getItem(CLIENTS_STORAGE_KEY);
		return stored ? parseInt(stored, 10) : DEFAULT_CLIENTS_COUNT;
	});

	// Connected clients state
	const [clients, setClients] = useState<Client[]>([]);
	const [clientsLoading, setClientsLoading] = useState(false);
	const [clientsError, setClientsError] = useState<string | null>(null);

	const loadFilter = useCallback(async () => {
		try {
			const data = await fetchFilter();
			setPattern(data.pattern || '');
			setSavedPattern(data.pattern || '');
		} catch (err) {
			setFilterError(
				err instanceof Error ? err.message : 'Failed to load filter',
			);
		}
	}, []);

	const loadClients = useCallback(async () => {
		setClientsLoading(true);
		setClientsError(null);
		try {
			const data = await fetchClientsStatus();
			setClients(data);
		} catch (err) {
			setClientsError(
				err instanceof Error ? err.message : 'Failed to load clients',
			);
		} finally {
			setClientsLoading(false);
		}
	}, []);

	useEffect(() => {
		loadFilter();
		loadClients();
	}, [loadFilter, loadClients]);

	async function applyFilter(newPattern: string) {
		setIsApplying(true);
		setFilterError(null);
		try {
			const data = await setFilter(newPattern);
			setPattern(newPattern);
			setSavedPattern(data.pattern || '');
		} catch (err) {
			setFilterError(
				err instanceof Error ? err.message : 'Failed to apply filter',
			);
		} finally {
			setIsApplying(false);
		}
	}

	function handleApply() {
		applyFilter(pattern.trim());
	}

	function handleClear() {
		applyFilter('');
	}

	function handleKeyPress(e: React.KeyboardEvent) {
		if (e.key === 'Enter') {
			handleApply();
		}
	}

	function handleClientsChange(value: number) {
		const clamped = Math.max(1, Math.min(20, value || DEFAULT_CLIENTS_COUNT));
		setClientsCount(clamped);
		localStorage.setItem(CLIENTS_STORAGE_KEY, clamped.toString());
	}

	// Grid: 12 slots (pad with nulls if fewer clients connected)
	const slots = Array.from({ length: DEFAULT_CLIENTS_COUNT }, (_, i) => clients[i] || null);

	const refreshButton = (
		<button
			type="button"
			onClick={loadClients}
			disabled={clientsLoading}
			className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
		>
			{clientsLoading ? 'Loading...' : 'Refresh'}
		</button>
	);

	if (!DEBUG_MODE) {
		return null;
	}

	const debugBadge = (
		<span className="text-xs font-normal text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
			DEBUG_MODE=on
		</span>
	);

	return (
		<TooltipProvider>
			<CollapsibleSection
				title="Test Config"
				rightContent={refreshButton}
				badge={debugBadge}
			>
				{/* Filter Row */}
				<div className="flex flex-wrap gap-3 items-center mb-3">
					<input
						type="text"
						value={pattern}
						onChange={(e) => setPattern(e.target.value)}
						onKeyDown={handleKeyPress}
						placeholder="Enter test filter pattern (e.g., mhn)"
						className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						disabled={isApplying}
					/>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={handleApply}
							disabled={isApplying}
							className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
						>
							{isApplying ? 'Applying...' : 'Apply'}
						</button>
						<button
							type="button"
							onClick={handleClear}
							disabled={isApplying}
							className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 disabled:bg-slate-100 disabled:cursor-not-allowed transition-colors"
						>
							Clear
						</button>
					</div>
				</div>

				{filterError && (
					<p className="text-sm text-red-600 mb-2">{filterError}</p>
				)}

				<div
					className={`text-sm ${savedPattern ? 'text-emerald-600' : 'text-slate-500'}`}
				>
					{savedPattern ? (
						<>
							<span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-2" />
							Filter active: "{savedPattern}"
						</>
					) : (
						<>
							<span className="inline-block w-2 h-2 rounded-full bg-slate-300 mr-2" />
							No filter active — all tests will run
						</>
					)}
				</div>

				{/* Clients Row */}
				<div className="mt-4 pt-4 border-t border-slate-200">
					{clientsError && (
						<p className="text-sm text-red-600 mb-3">
							{clientsError}
						</p>
					)}

					<div className="flex flex-wrap items-center gap-4 mb-3">
						<div className="flex items-center gap-2">
							<label
								htmlFor="clients-count"
								className="text-sm text-slate-600"
							>
								Clients count:
							</label>
							<input
								id="clients-count"
								type="number"
								min={1}
								max={clients.length || DEFAULT_CLIENTS_COUNT}
								value={clientsCount}
								onChange={(e) =>
									handleClientsChange(
										parseInt(e.target.value, 10),
									)
								}
								className="w-16 px-2 py-1 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
							/>
						</div>
						<span className="text-sm text-slate-500">
							({clients.length} connected)
						</span>
					</div>

					<div className="grid grid-cols-6 sm:grid-cols-12 gap-2">
						{slots.map((client, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: Fixed 12-slot grid where position IS the key
							<ClientSlot key={i} client={client} />
						))}
					</div>
				</div>
			</CollapsibleSection>
		</TooltipProvider>
	);
}
