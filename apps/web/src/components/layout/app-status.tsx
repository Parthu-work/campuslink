import { useTranslation } from '../../i18n/react';
import { History, WifiOff } from 'lucide-react';
import { useOnline, useServiceWorker } from '../../lib/pwa';
import { useSavedCopyAt } from '../../lib/offline-state';
import { formatRelative } from '../../lib/format';

/**
 * The offline banner, mounted once above every route. It also starts the service worker, whose
 * "new version" prompt (lib/service-worker.ts) loads with it a second after first paint. When the
 * screen shows the device's saved copy (B13) it says how old that copy is: quietly while the live
 * data loads, and next to "you're offline" when there is no connection.
 */
export function AppStatus() {
  const { t } = useTranslation();
  const online = useOnline();
  const savedAt = useSavedCopyAt();
  useServiceWorker();
  if (online && savedAt === null) return null;
  const when = savedAt === null ? null : formatRelative(new Date(savedAt));
  // A pill above the bottom tabs (bottom of the screen on desktop): it never covers the top bar's
  // controls and never takes taps (audit PW-9).
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom,0px))] z-[60] flex justify-center px-4 lg:bottom-6"
    >
      {online ? (
        <span className="flex items-center gap-2 rounded-full bg-surface-2 px-4 py-2 text-meta text-fg-2 shadow-[var(--shadow)]">
          <History className="size-4" aria-hidden /> {t('offline.updated', { when })}
        </span>
      ) : (
        <span className="flex items-center gap-2 rounded-full bg-fg px-4 py-2 text-meta font-semibold text-bg shadow-[var(--shadow)]">
          <WifiOff className="size-4" aria-hidden />
          {when ? t('offline.offlineSaved', { when }) : t('common.offline')}
        </span>
      )}
    </div>
  );
}
