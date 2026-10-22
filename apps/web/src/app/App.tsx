import { lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../lib/query-client';
import { useTranslation } from 'react-i18next';
import { Building2, PauseCircle } from 'lucide-react';
import { ApiError } from '../lib/api';
import { TenantProvider } from '../lib/tenant';
import { useTenantQuery } from '../lib/tenant-context';
import { EmptyState } from '../components/ui/misc';
import { Button } from '../components/ui/button';
import { AppRouter } from './router';
import { SessionBootstrap, Splash } from './guards';
import { AppStatus } from '../components/layout/app-status';
import { BotCheckHost } from '../components/layout/bot-check-host';
import { loadSonner } from '../lib/toast';

// Loads just after the first render; toasts raised before it mounts are replayed by sonner.
const Toaster = lazy(() => loadSonner().then((m) => ({ default: m.Toaster })));

function TenantGate() {
  const { t } = useTranslation();
  const tenant = useTenantQuery();
  if (tenant.isLoading) return <Splash />;
  if (tenant.error || !tenant.data) {
    const code = tenant.error instanceof ApiError ? tenant.error.code : null;
    const demo = import.meta.env.DEV ? ['dpit', 'mrce', 'admin'] : [];
    return (
      <main className="gutter grid min-h-dvh place-items-center">
        {code === 'TENANT_SUSPENDED' ? (
          <EmptyState icon={<PauseCircle className="size-6" />} title={t('errors.suspendedTitle')}>
            {t('errors.suspendedBody')}
          </EmptyState>
        ) : code === 'UNKNOWN_TENANT' ? (
          <EmptyState icon={<Building2 className="size-6" />} title={t('errors.noCollegeTitle')}>
            <p>{t('errors.noCollegeBody')}</p>
            {demo.length > 0 && (
              <ul className="mt-4 flex flex-wrap justify-center gap-2">
                {demo.map((d) => (
                  <li key={d}>
                    <a
                      className="font-mono text-sm text-brand-ink underline"
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
              title: '!text-meta !font-semibold',
              description: '!text-caption !text-bg',
              actionButton: '!min-h-9 !rounded-full !bg-bg !px-3 !text-meta !font-semibold !text-fg',
              cancelButton: '!min-h-9 !rounded-full !bg-transparent !px-3 !text-meta !text-bg',
            },
          }}
        />
      </Suspense>
    </QueryClientProvider>
  );
}
