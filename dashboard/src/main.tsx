import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { Toaster } from '@/components/ui/sonner';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

createRoot(rootElement).render(
	<StrictMode>
		<App />
		<Toaster position="top-right" richColors />
	</StrictMode>,
);
