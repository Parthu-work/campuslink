import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldAlert } from 'lucide-react';
import type { Permission } from '@campuslink/shared';
import { useSession } from '../lib/session';
import { refreshSession } from '../lib/api';
import { useMe } from '../lib/me';
import { AuthLayout } from '../components/layout/auth-layout';
import { MfaSetup } from '../features/auth/mfa-setup';
import { EmptyState } from '../components/ui/misc';

export function Splash() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh place-items-center" role="status">
      <Loader2 className="size-8 animate-spin text-brand-ink motion-reduce:animate-none" aria-hidden />
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
  const location = useLocation();
  const { data: me, isLoading } = useMe();
  const { t } = useTranslation();
  if (status !== 'signed-in') return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  if (isLoading || !me) return <Splash />;
  if (me.mfaRequired && !me.mfaEnabled) {
    return (
      <AuthLayout title={t('mfa.setupTitle')} subtitle={t('mfa.setupWhy')}>
        <MfaSetup onDone={() => undefined} />
      </AuthLayout>
    );
  }
  return <>{children}</>;
}

export function PublicOnly({ children, home }: { children: ReactNode; home: string }) {
  const status = useSession((s) => s.status);
  return status === 'signed-in' ? <Navigate to={home} replace /> : <>{children}</>;
}

export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { data: me } = useMe();
  const { t } = useTranslation();
  if (!me?.permissions.includes(permission))
    return <EmptyState icon={<ShieldAlert className="size-6" />} title={t('errors.forbidden')} />;
  return <>{children}</>;
}
