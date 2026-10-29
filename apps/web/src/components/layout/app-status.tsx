import { useTranslation } from '../../i18n/react';
import { WifiOff } from 'lucide-react';
import { useOnline, useServiceWorker } from '../../lib/pwa';

/**
 * The offline banner, mounted once above every route. It also starts the service worker, whose
 * "new version" prompt (lib/service-worker.ts) loads with it a second after first paint.
 */
export function AppStatus() {
  const { t } = useTranslation();
  const online = useOnline();
  useServiceWorker();
  if (online) return null;
  // A pill above the bottom tabs (bottom of the screen on desktop): it never covers the top bar's
  // controls and never takes taps (audit PW-9).
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom,0px))] z-[60] flex justify-center px-4 lg:bottom-6"
    >
      <span className="flex items-center gap-2 rounded-full bg-fg px-4 py-2 text-meta font-semibold text-bg shadow-[var(--shadow)]">
        <WifiOff className="size-4" aria-hidden /> {t('common.offline')}
      </span>
    </div>
  );
}
