import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="font-mono text-amber-500/80 p-8">
      hello minifarm about
    </div>
  </StrictMode>
);
