import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CloudOff, Loader2, ShieldAlert } from 'lucide-react';
import { safeReturnPath, type Permission } from '@campuslink/shared';
import { useSession } from '../lib/session';
import { refreshSession } from '../lib/api';
import { useMe } from '../lib/me';
import { AuthLayout } from '../components/layout/auth-layout';
import { MfaSetup } from '../features/auth/mfa-setup';
import { EmptyState } from '../components/ui/misc';
import { ShellSkeleton } from '../components/layout/skeletons';
import { Button } from '../components/ui/button';
import { useOnline } from '../lib/pwa';

/** Boot only (college lookup, session): a calm blank canvas; the spinner fades in after 200 ms. */
export function Splash() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh place-items-center" role="status">
      <Loader2
        className="delayed-in size-8 animate-spin text-brand-ink motion-reduce:animate-none"
        aria-hidden
      />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}

/** On first load, trade the httpOnly refresh cookie for an in-memory access token. */
export function SessionBootstrap({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  useEffect(() => {
    if (status === 'unknown') void refreshSession();
  }, [status]);
  return status === 'unknown' ? <Splash /> : <>{children}</>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const byChoice = useSession((s) => s.byChoice);
  const location = useLocation();
  const { data: me, isLoading, isError, refetch } = useMe();
  const online = useOnline();
  const { t } = useTranslation();
  if (status !== 'signed-in')
    return (
      <Navigate
        to="/sign-in"
        replace
        // Return here after signing in, unless the member signed out on purpose.
        state={byChoice ? undefined : { from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  if (!me && isError)
    return (
      <main id="main" className="gutter grid min-h-dvh place-items-center">
        <EmptyState
          icon={online ? <ShieldAlert className="size-6" /> : <CloudOff className="size-6" />}
          title={online ? t('errors.screenTitle') : t('errors.offlineTitle')}
          action={
            <Button variant="primary" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {online ? t('errors.generic') : t('errors.offlineBootBody')}
        </EmptyState>
      </main>
    );
  if (isLoading || !me) return <ShellSkeleton />;
  if (me.mfaRequired && !me.mfaEnabled) {
    return (
      <AuthLayout title={t('mfa.setupTitle')} subtitle={t('mfa.setupWhy')}>
        <MfaSetup onDone={() => undefined} />
      </AuthLayout>
    );
  }
  return <>{children}</>;
}

/** Public pages send signed-in members on: back to where sign-in was asked for, else home. */
export function PublicOnly({ children, home }: { children: ReactNode; home: string }) {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status !== 'signed-in') return <>{children}</>;
  const from = safeReturnPath((location.state as { from?: unknown } | null)?.from);
  return <Navigate to={from ?? home} replace />;
}

/** UX mirror of the API's authorization: any one of the permissions opens the page. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission | Permission[];
  children: ReactNode;
}) {
  const { data: me } = useMe();
  const { t } = useTranslation();
  const wanted = Array.isArray(permission) ? permission : [permission];
  if (!wanted.some((p) => me?.permissions.includes(p)))
    return <EmptyState icon={<ShieldAlert className="size-6" />} title={t('errors.forbidden')} />;
  return <>{children}</>;
}
