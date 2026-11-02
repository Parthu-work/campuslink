import { useTranslation } from '../../i18n/react';
import { ApiError } from '../../lib/api';
import { useOnline } from '../../lib/pwa';
import { Button } from './button';
import { EmptyState } from './misc';
import { Illustration } from './illustration';

/**
 * A read that failed, said plainly (audit ST-2: errors must not look like emptiness): offline or
 * not, a retry, and the request id when the API gave one. `compact` fits inside a card or list.
 */
export function ErrorState({
  error,
  onRetry,
  title,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  const retry = onRetry && (
    <Button variant="primary" size={compact ? 'sm' : 'md'} onClick={onRetry}>
      {t('common.retry')}
    </Button>
  );
  if (compact)
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] bg-surface-2 px-4 py-3"
      >
        <p className="text-meta text-fg-2">{online ? t('errors.loadFailed') : t('errors.offlineShort')}</p>
        {retry}
      </div>
    );
  return (
    <div role="alert">
      <EmptyState
        art={<Illustration kind={online ? 'error' : 'offline'} />}
        title={title ?? (online ? t('errors.loadFailedTitle') : t('errors.offlineTitle'))}
        action={retry}
      >
        <p>{online ? t('errors.loadFailed') : t('errors.offlineBody')}</p>
        {requestId && (
          <p className="mt-2 font-mono text-caption text-fg-3">{t('errors.reference', { id: requestId })}</p>
        )}
      </EmptyState>
    </div>
  );
}
