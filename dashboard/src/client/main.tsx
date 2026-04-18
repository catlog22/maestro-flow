import '@/client/theme-init.js'; // Eager theme init -- must be first import
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@/client/i18n/index.js';
import { App } from '@/client/App.js';
import '@/client/styles/globals.css';

// ---------------------------------------------------------------------------
// React 19 entry point
// ---------------------------------------------------------------------------

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
