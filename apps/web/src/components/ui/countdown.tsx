import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { countdown } from '../../lib/countdown';
import { formatDateTime } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { cn } from '../../lib/cn';

/**
 * "Closes in 2 days", "Starts in 3 min", "Happening now" (ADR 0015). Quiet until the urgency
 * window (a day by default), then warm. The exact date and time are on hover (title), on a long
 * press (the chip shows it for a few seconds) and for screen readers (its label). Never announced
 * as it ticks (no live region), and not a tab stop.
 */
export function Countdown({
  at,
  endsAt,
  kind = 'closes',
  urgentWithinMs,
  className,
}: {
  at: string | Date;
  /** For things that run for a while (a session): "Happening now" until then. */
  endsAt?: string | Date;
  kind?: 'closes' | 'starts';
  urgentWithinMs?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const now = useNow(30_000);
  const [exactShown, setExactShown] = useState(false);
  const press = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!exactShown) return;
    const id = setTimeout(() => setExactShown(false), 3000);
    return () => clearTimeout(id);
  }, [exactShown]);
  const c = countdown(at, {
    now,
    ...(endsAt ? { endsAt } : {}),
    ...(urgentWithinMs ? { urgentWithinMs } : {}),
  });
  const label =
    c.phase === 'before'
      ? t(kind === 'starts' ? 'ui.starts' : 'ui.closes', { when: c.when })
      : c.phase === 'during' && kind === 'starts'
        ? t('ui.live')
        : t('ui.closed');
  const exact = formatDateTime(at);
  return (
    <time
      dateTime={new Date(at).toISOString()}
      title={exact}
      aria-label={`${label}, ${exact}`}
      onPointerDown={() => (press.current = setTimeout(() => setExactShown(true), 500))}
      onPointerUp={() => clearTimeout(press.current)}
      onPointerLeave={() => clearTimeout(press.current)}
      className={cn(
        'inline-flex min-h-7 w-fit items-center rounded-[var(--radius-sm)] px-2 text-caption font-semibold whitespace-nowrap tabular-nums select-none',
        c.phase === 'after'
          ? 'bg-surface-2 text-fg-3'
          : c.urgent
            ? 'bg-warning-surface text-warning-ink'
            : 'bg-surface-2 text-fg-2',
        className,
      )}
    >
      {exactShown ? exact : label}
    </time>
  );
}
