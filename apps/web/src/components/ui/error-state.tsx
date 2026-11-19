import { CloudOff, RotateCw, TriangleAlert } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useOnline } from '../../lib/pwa';
import { Button } from './button';

/** The API's reference for a failed request, one tap away (prompt 3, U10): support asks for it, members rarely need it. */
export function ErrorDetails({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  if (!requestId) return null;
  return (
    <details className="text-caption text-fg-3">
      <summary className="inline-flex min-h-11 cursor-pointer items-center">{t('common.details')}</summary>
      <p className="font-mono break-all select-all">{t('errors.reference', { id: requestId })}</p>
    </details>
  );
}

/**
 * A read that failed, said plainly in one line (audit ST-2: errors must not look like emptiness;
 * prompt 3, U10: one inline pattern everywhere): "Couldn't load this" or the offline line, Retry,
 * and the request's reference behind Details. `compact` only tightens the padding for a card or a
 * list row.
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
  const Icon = online ? TriangleAlert : CloudOff;
  return (
    <div
      role="alert"
      className={cn(
        'grid gap-1 rounded-[var(--radius-md)] border border-line bg-surface-2',
        compact ? 'px-3 py-2' : 'px-4 py-3',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="flex min-w-0 items-start gap-2 text-callout font-semibold text-fg">
          <Icon
            className={cn('mt-0.5 size-4 flex-none', online ? 'text-danger-ink' : 'text-fg-2')}
            aria-hidden
          />
          <span>{title ?? (online ? t('errors.loadFailedTitle') : t('errors.offlineShort'))}</span>
        </p>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RotateCw className="size-4" aria-hidden /> {t('common.retry')}
          </Button>
        )}
      </div>
      <ErrorDetails error={error} />
    </div>
  );
}
