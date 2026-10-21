import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/figtree';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/noto-sans-telugu';
import '@fontsource/ibm-plex-mono/400.css';
import './styles/index.css';
import './i18n';
import './lib/preferences';
import { App } from './app/App';
import { installPreloadErrorHandler } from './lib/chunk-reload';

installPreloadErrorHandler();

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
