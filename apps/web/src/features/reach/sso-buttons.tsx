import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { API_PREFIX, SSO_ERRORS, safeReturnPath, type SsoError, type SsoProvider } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { buttonVariants } from '../../components/ui/button-variants';
import { api } from '../../lib/api';

/**
 * The sign-in page's "Continue with Google / Microsoft" (prompt 2, G9), shown only when the college
 * set single sign-on up. A full-page visit: the identity provider sends the member back here.
 */
export function SsoButtons() {
  const { t } = useTranslation();
  const location = useLocation();
  const q = useQuery({
    queryKey: ['sso-providers'],
    queryFn: ({ signal }) => api.get<{ providers: SsoProvider[] }>('/auth/sso/providers', signal),
    staleTime: 5 * 60_000,
  });
  // Why the last sign-in came back, from the address (#sso_error=…), once.
  const [error] = useState<SsoError | null>(() => {
    const code = /(?:^#|&)sso_error=([a-z]+)/.exec(window.location.hash)?.[1];
    return code && (SSO_ERRORS as readonly string[]).includes(code) ? (code as SsoError) : null;
  });
  useEffect(() => {
    if (error) history.replaceState(history.state, '', window.location.pathname + window.location.search);
  }, [error]);
  const next = safeReturnPath((location.state as { from?: unknown } | null)?.from);
  const providers = q.data?.providers ?? [];
  if (!providers.length && !error) return null;
  return (
    <div className="grid gap-3">
      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-danger bg-danger-surface p-3 text-callout text-danger-ink"
        >
          {t(`reach.sso.error.${error}`)}
        </p>
      )}
      {providers.map((p) => (
        <a
          key={p}
          href={`${API_PREFIX}/auth/sso/${p}/start${next ? `?next=${encodeURIComponent(next)}` : ''}`}
          className={buttonVariants({ variant: 'secondary', size: 'lg', className: 'w-full' })}
        >
          <KeyRound className="size-4" aria-hidden />{' '}
          {t('reach.sso.continue', { provider: t(`reach.sso.${p}`) })}
        </a>
      ))}
      {providers.length > 0 && (
        <div className="flex items-center gap-3 text-caption text-fg-3" aria-hidden>
          <span className="h-px flex-1 bg-line" />
          {t('reach.sso.or')}
          <span className="h-px flex-1 bg-line" />
        </div>
      )}
    </div>
  );
}
