import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
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
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-fg px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] text-sm font-semibold text-bg"
    >
      <WifiOff className="size-4" aria-hidden /> {t('common.offline')}
    </div>
  );
}
