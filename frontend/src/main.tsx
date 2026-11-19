import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getToken } from './lib/auth';
import { setAuthToken } from './lib/db';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Eski sahifalar bilan bir xil Service Worker (oflayn rejim)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

// SW fonda sinxronlashi uchun token IDB'da ham bo'lsin (kirish/do'kon almashganda yangilanadi)
setAuthToken(getToken());
