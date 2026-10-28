import { useEffect } from 'react';
import { isRouteErrorResponse, Link, useLocation, useNavigate, useRouteError } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CloudOff, Compass, RefreshCw, TriangleAlert } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { forceReload, isChunkLoadError } from '../../lib/chunk-reload';
import { queryClient } from '../../lib/query-client';
import { useTenant } from '../../lib/tenant-context';
import { useOnline } from '../../lib/pwa';
import { buttonVariants } from '../ui/button-variants';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/misc';

/**
 * Every route's error screen. Inside the shell it replaces only the content area, so navigation and
 * sign-out keep working; at the root it fills the page. React Router's developer page never shows.
 */
export function RouteError({ fullPage = false, error: given }: { fullPage?: boolean; error?: unknown }) {
  const routeError = useRouteError();
  const error = given ?? routeError;
  const { t } = useTranslation();
  const tenant = useTenant();
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnline();
  const home = tenant.kind === 'platform' ? '/platform' : '/home';

  useEffect(() => {
    if (import.meta.env.DEV) console.error(error);
  }, [error]);
  // Leaving the error screen forgets reads that failed with nothing to show, so the next visit
  // asks again instead of rethrowing the old error (a screen's main read does not retry on mount).
  useEffect(
    () => () =>
      queryClient.removeQueries({
        predicate: (q) => q.state.status === 'error' && q.state.data === undefined && !q.getObserversCount(),
      }),
    [],
  );

  // A missing route, or a screen whose main read is gone (a deleted post, job or event).
  const notFound =
    (isRouteErrorResponse(error) && error.status === 404) ||
    (error instanceof ApiError && error.status === 404);
  const chunk = isChunkLoadError(error);
  const requestId = error instanceof ApiError ? error.requestId : undefined;

  const homeLink = (
    <Link to={home} className={buttonVariants({ variant: 'ghost' })}>
      {t('errors.goHome')}
    </Link>
  );

  let body;
  if (notFound) {
    body = (
      <EmptyState icon={<Compass className="size-6" />} title={t('errors.notFound')} action={homeLink} />
    );
  } else if (chunk) {
    body = (
      <EmptyState
        icon={online ? <RefreshCw className="size-6" /> : <CloudOff className="size-6" />}
        title={online ? t('errors.updatedTitle') : t('errors.offlineTitle')}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={forceReload}>
              {online ? t('errors.reload') : t('common.retry')}
            </Button>
            {homeLink}
          </div>
        }
      >
        {online ? t('errors.updatedBody') : t('errors.offlineBody')}
      </EmptyState>
    );
  } else {
    body = (
      <EmptyState
        icon={<TriangleAlert className="size-6" />}
        title={t('errors.screenTitle')}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="primary"
              onClick={() => {
                // Failed reads start over (a screen's main read rethrows until it is reset), then a
                // fresh navigation to the same place clears the error and renders the screen again.
                void queryClient.resetQueries({ predicate: (q) => q.state.status === 'error' });
                navigate(
                  { pathname: location.pathname, search: location.search, hash: location.hash },
                  { replace: true, state: location.state },
                );
              }}
            >
              {t('common.retry')}
            </Button>
            {homeLink}
          </div>
        }
      >
        <p>{online ? t('errors.screenBody') : t('errors.offlineBody')}</p>
        {requestId && (
          <p className="mt-2 font-mono text-caption text-fg-3">{t('errors.reference', { id: requestId })}</p>
        )}
      </EmptyState>
    );
  }

  if (!fullPage) return <div role="alert">{body}</div>;
  return (
    <main id="main" className="gutter grid min-h-dvh place-items-center" role="alert">
      {body}
    </main>
  );
}
