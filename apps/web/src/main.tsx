import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/figtree';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/noto-sans-telugu';
import './styles/index.css';
import './i18n';
import { App } from './app/App';

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
