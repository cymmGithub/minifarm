import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AboutSection } from './AboutSection';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AboutSection />
  </StrictMode>
);
