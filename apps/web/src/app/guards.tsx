import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useTranslation } from '../i18n/react';
import { BadgeCheck, CloudOff, Loader2, ShieldAlert, ToggleLeft } from 'lucide-react';
import { ROLE_PERMISSIONS, safeReturnPath, type Feature, type Permission } from '@campuslink/shared';
import { useSession } from '../lib/session';
import { refreshSession } from '../lib/api';
import { useMe } from '../lib/me';
import { useTenant } from '../lib/tenant-context';
import { EmptyState } from '../components/ui/misc';
import { ShellSkeleton } from '../components/layout/skeletons';
import { Button } from '../components/ui/button';
import { buttonVariants } from '../components/ui/button-variants';
import { useOnline } from '../lib/pwa';

// Only admins ever see it, once: not part of the first load.
const MfaGate = lazy(() => import('../features/auth/mfa-gate').then((m) => ({ default: m.MfaGate })));
// Only members under 18 waiting for a guardian see it.
const GuardianGate = lazy(() =>
  import('../features/guardian/guardian-gate').then((m) => ({ default: m.GuardianGate })),
);

/**
 * Boot only (college lookup, session): the launch mark index.html painted, so the hand-over is
 * seamless; a spinner fades in under it after 200 ms.
 */
export function Splash() {
  const { t } = useTranslation();
  return (
    <div className="launch" role="status">
      {/* The spinner hangs below the icon, so the icon stays exactly where index.html put it. */}
      <span className="relative grid">
        <img src="/icons/icon.svg" alt="" width={56} height={56} />
        <Loader2
          className="delayed-in absolute top-full left-1/2 mt-5 -ml-3 size-6 animate-spin text-brand-ink motion-reduce:animate-none"
          aria-hidden
        />
      </span>
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}

/** On first load, trade the httpOnly refresh cookie for an in-memory access token. */
export function SessionBootstrap({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  useEffect(() => {
    // startBoot (main.tsx) has usually settled the session by now. Read the live status: a refresh
    // that finished between render and this effect must not be followed by a second rotation.
    if (useSession.getState().status === 'unknown') void refreshSession();
  }, []);
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
      <Suspense fallback={<Splash />}>
        <MfaGate />
      </Suspense>
    );
  }
  // Under 18 and waiting for a guardian: only verification (in the app) and the guardian step.
  if (me.guardianPending && location.pathname !== '/verify') {
    return (
      <Suspense fallback={<Splash />}>
        <GuardianGate />
      </Suspense>
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

/**
 * UX mirror of the API's authorization: any one of the permissions opens the page, and a page of a
 * feature the college has switched off (Admin › Features) says so, even from a saved link.
 */
export function RequirePermission({
  permission,
  feature,
  children,
}: {
  permission: Permission | Permission[];
  feature?: Feature | undefined;
  children: ReactNode;
}) {
  const { data: me } = useMe();
  const { t } = useTranslation();
  const tenant = useTenant();
  const wanted = Array.isArray(permission) ? permission : [permission];
  const home = (
    <Link
      to={tenant.kind === 'platform' ? '/platform' : '/home'}
      className={buttonVariants({ variant: 'ghost' })}
    >
      {t('errors.goHome')}
    </Link>
  );
  if (feature && tenant.features?.[feature] === false)
    return (
      <EmptyState icon={<ToggleLeft className="size-6" />} title={t('errors.featureOffTitle')} action={home}>
        {t('errors.featureOffBody')}
      </EmptyState>
    );
  if (wanted.some((p) => me?.permissions.includes(p))) return <>{children}</>;
  // Unverified members get the reason and the way forward, not a dead end (audit IA-7).
  // Only when verifying would actually open it (an unverified student is never sent to verify for
  // the admin area).
  const needsVerification =
    !!me && !me.verified && wanted.some((p) => me.roles.some((r) => ROLE_PERMISSIONS[r].includes(p)));
  return needsVerification ? (
    <EmptyState
      icon={<BadgeCheck className="size-6" />}
      title={t('errors.verifyFirstTitle')}
      action={
        <Link to="/verify" className={buttonVariants({ variant: 'primary' })}>
          {t('home.verifyCta')}
        </Link>
      }
    >
      {t('errors.verifyFirstBody')}
    </EmptyState>
  ) : (
    <EmptyState icon={<ShieldAlert className="size-6" />} title={t('errors.forbidden')} action={home}>
      {t('errors.forbiddenBody')}
    </EmptyState>
  );
}
