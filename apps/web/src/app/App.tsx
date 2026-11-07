import { lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../lib/query-client';
import { useTranslation } from '../i18n/react';
import { Building2, PauseCircle } from 'lucide-react';
import { useSavedCopySettled } from '../lib/offline-probe';
import { ApiError } from '../lib/api';
import { TenantProvider } from '../lib/tenant';
import { useTenantQuery } from '../lib/tenant-context';
import { EmptyState } from '../components/ui/misc';
import { Button } from '../components/ui/button';
import { AppRouter } from './router';
import { SessionBootstrap, Splash } from './guards';
import { AppStatus } from '../components/layout/app-status';
import { BotCheckHost } from '../components/layout/bot-check-host';
import { lazyPart } from '../lib/lazy-part';
import { LazyCollegePicker, LazyPickerLink } from '../features/reach/lazy-picker';
import { loadSonner } from '../lib/toast';

// Loads just after the first render; toasts raised before it mounts are replayed by sonner.
// Celebrations are rare: the host (and its store) load after the first screen, the burst on use.
const CelebrationHost = lazyPart(() =>
  import('../components/layout/celebration-host').then((m) => m.CelebrationHost),
);
const Toaster = lazy(() => loadSonner().then((m) => ({ default: m.Toaster })));

/** The bare root domain, not a college's address (VITE_ROOT_DOMAIN when the build sets it). */
const onRootDomain = () => {
  const root = import.meta.env.VITE_ROOT_DOMAIN as string | undefined;
  const host = location.hostname;
  if (root) return host === root;
  // `dpit.localhost` is a college in development; `campuslink.in` is a bare domain.
  return host === 'localhost' || (!host.endsWith('.localhost') && host.split('.').length <= 2);
};

function TenantGate() {
  const { t } = useTranslation();
  const tenant = useTenantQuery();
  const savedCopySettled = useSavedCopySettled();
  // Offline, the college may still be on its way from the device's saved copy (B13).
  if (tenant.isLoading || (!tenant.data && !savedCopySettled)) return <Splash />;
  // Offline with the college in the device's saved copy (B13): open the app from it.
  const offlineCopy = !!tenant.data && tenant.error instanceof ApiError && tenant.error.code === 'NETWORK';
  if ((tenant.error && !offlineCopy) || !tenant.data) {
    const code = tenant.error instanceof ApiError ? tenant.error.code : null;
    const demo = import.meta.env.DEV ? ['dpit', 'mrce', 'admin'] : [];
    return (
      <main className="gutter grid min-h-dvh place-items-center">
        {code === 'TENANT_SUSPENDED' ? (
          <EmptyState icon={<PauseCircle className="size-6" />} title={t('errors.suspendedTitle')}>
            {t('errors.suspendedBody')}
          </EmptyState>
        ) : code === 'UNKNOWN_TENANT' && onRootDomain() ? (
          // The bare domain (where the Android app starts, prompt 2, G9): pick the college.
          <LazyCollegePicker />
        ) : code === 'UNKNOWN_TENANT' ? (
          <EmptyState icon={<Building2 className="size-6" />} title={t('errors.noCollegeTitle')}>
            <p>{t('errors.noCollegeBody')}</p>
            <LazyPickerLink />
            {demo.length > 0 && (
              <ul className="mt-4 flex flex-wrap justify-center gap-2">
                {demo.map((d) => (
                  <li key={d}>
                    <a
                      className="font-mono text-callout text-brand-ink underline"
                      href={`${location.protocol}//${d}.${location.host}`}
                    >
                      {d}.{location.host}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </EmptyState>
        ) : (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title={t('errors.generic')}
            action={<Button onClick={() => void tenant.refetch()}>{t('common.retry')}</Button>}
          />
        )}
      </main>
    );
  }
  return (
    <TenantProvider tenant={tenant.data}>
      <SessionBootstrap>
        <AppRouter />
      </SessionBootstrap>
    </TenantProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppStatus />
      <TenantGate />
      <BotCheckHost />
      <CelebrationHost />
      <Suspense fallback={null}>
        <Toaster
          position="bottom-center"
          // Above the phone tab bar, never on top of it (NB-5).
          mobileOffset={{ bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))' }}
          // Inverse (text colour on the canvas colour) so a toast reads over any screen in sunlight.
          toastOptions={{
            classNames: {
              toast:
                '!gap-3 !rounded-[var(--radius-lg)] !border-0 !bg-fg !px-4 !py-3 !font-sans !text-bg !shadow-elev-3',
              title: '!text-callout !font-semibold',
              description: '!text-caption !text-bg',
              actionButton: '!min-h-9 !rounded-full !bg-bg !px-3 !text-callout !font-semibold !text-fg',
              cancelButton: '!min-h-9 !rounded-full !bg-transparent !px-3 !text-callout !text-bg',
            },
          }}
        />
      </Suspense>
    </QueryClientProvider>
  );
}
