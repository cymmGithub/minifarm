import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { TestConfigSection } from './components/TestConfigSection';
import { QueueSection } from './components/QueueSection';
import { AboutSection } from './components/AboutSection';

type Page = 'dashboard' | 'about';

function getPage(): Page {
	return window.location.pathname.replace(/\/+$/, '') === '/about'
		? 'about'
		: 'dashboard';
}

function usePage(): [Page, (page: Page) => void] {
	const page = useSyncExternalStore(
		(cb) => {
			window.addEventListener('popstate', cb);
			return () => window.removeEventListener('popstate', cb);
		},
		getPage,
	);

	const navigate = useCallback((next: Page) => {
		const path = next === 'about' ? '/about' : '/';
		window.history.pushState(null, '', path);
		window.dispatchEvent(new PopStateEvent('popstate'));
	}, []);

	return [page, navigate];
}

function App() {
	const [page, navigate] = usePage();
	const isDark = page === 'about';

	useEffect(() => {
		if (page === 'about') window.scrollTo({ top: 0 });
	}, [page]);

	return (
		<div className={`min-h-screen ${isDark ? 'bg-[#0a0a08]' : 'bg-slate-50'} transition-colors duration-300`}>
			<nav className={`border-b sticky top-0 z-[100] backdrop-blur-sm transition-colors duration-300 ${
				isDark
					? 'border-amber-500/10 bg-[#0a0a08]/90'
					: 'border-slate-200 bg-white/80'
			}`}>
				<div className="max-w-6xl mx-auto px-5 flex items-center gap-1 h-12">
					<button
						type="button"
						onClick={() => navigate('dashboard')}
						className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
							page === 'dashboard'
								? isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-100 text-slate-900'
								: isDark ? 'text-amber-500/40 hover:text-amber-500/70' : 'text-slate-500 hover:text-slate-700'
						}`}
					>
						Dashboard
					</button>
					<button
						type="button"
						onClick={() => navigate('about')}
						className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
							page === 'about'
								? isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-100 text-slate-900'
								: isDark ? 'text-amber-500/40 hover:text-amber-500/70' : 'text-slate-500 hover:text-slate-700'
						}`}
					>
						About
					</button>
				</div>
			</nav>

			{page === 'dashboard' ? (
				<div className="max-w-6xl mx-auto px-5 py-8">
					<h1 className="text-2xl font-bold text-slate-800 mb-8">
						Minifarm Dashboard
					</h1>
					<div className="space-y-6">
						<TestConfigSection />
						<QueueSection />
					</div>
				</div>
			) : (
				<AboutSection />
			)}
		</div>
	);
}

export default App;
