import { StrictMode, startTransition } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted faces (ADR 0008); each subset downloads only when its characters are on screen.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/anek-telugu';
import './styles/index.css';
import { i18nReady } from './i18n';
import './lib/preferences';
import { App } from './app/App';
import { installPreloadErrorHandler } from './lib/chunk-reload';
import { startBoot } from './lib/boot';
import { warmLanding } from './lib/preload';

installPreloadErrorHandler();
const boot = startBoot();
void boot.college.then((college) => warmLanding(college.kind, boot.session)).catch(() => undefined);

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

// Strings first (one small file, fetched alongside the college and the session), then the app. The
// first render is a transition, so React yields to the browser between components instead of
// holding the main thread (the launch mark from index.html stays on screen meanwhile).
void i18nReady.finally(() =>
  startTransition(() =>
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  ),
);
