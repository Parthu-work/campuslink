import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../lib/toast';
import { WifiOff } from 'lucide-react';
import { applyUpdate, useOnline, useServiceWorker, useUpdateAvailable } from '../../lib/pwa';

const UPDATE_TOAST = 'app-update';

/** Offline banner and the "new version" prompt. Mounted once, above every route. */
export function AppStatus() {
  const { t } = useTranslation();
  const online = useOnline();
  const update = useUpdateAvailable();
  useServiceWorker();
  useEffect(() => {
    if (!update) return;
    toast(t('pwa.updateTitle'), {
      id: UPDATE_TOAST,
      description: t('pwa.updateBody'),
      duration: Number.POSITIVE_INFINITY,
      action: { label: t('pwa.reload'), onClick: applyUpdate },
    });
  }, [update, t]);
  if (online) return null;
  // A pill above the bottom tabs (bottom of the screen on desktop): it never covers the top bar's
  // controls and never takes taps (audit PW-9).
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom,0px))] z-[60] flex justify-center px-4 lg:bottom-6"
    >
      <span className="flex items-center gap-2 rounded-full bg-fg px-4 py-2 text-sm font-semibold text-bg shadow-[var(--shadow)]">
        <WifiOff className="size-4" aria-hidden /> {t('common.offline')}
      </span>
    </div>
  );
}
