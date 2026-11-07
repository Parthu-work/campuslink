import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * "Do this next" (ADR 0015): one task, one button, an optional deadline chip. The single pattern
 * for the most urgent item on Home, a followed path's next step, a session about to start.
 * `action` is one Button (primary) or a link styled as one; nothing else competes with it.
 */
export function ActionCard({
  title,
  kicker,
  meta,
  deadline,
  leading,
  action,
  level = 2,
  className,
}: {
  title: ReactNode;
  /** What kind of thing this is ("Next session", "Your path"), in sentence case. */
  kicker?: ReactNode;
  meta?: ReactNode;
  /** A Countdown chip. */
  deadline?: ReactNode;
  /** An avatar or a small figure (a ring) on the left. */
  leading?: ReactNode;
  action: ReactNode;
  level?: 2 | 3;
  className?: string;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <article
      className={cn(
        'grid min-w-0 gap-4 rounded-[var(--radius-md)] border border-line bg-surface-1 p-4 sm:p-5',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {leading && <div className="flex-none">{leading}</div>}
        <div className="grid min-w-0 flex-1 gap-1">
          {(kicker || deadline) && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              {kicker && <span className="text-callout font-medium text-brand-ink">{kicker}</span>}
              {deadline}
            </div>
          )}
          <Heading className="text-headline font-semibold text-pretty break-words">{title}</Heading>
          {meta && <p className="text-callout text-fg-2">{meta}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">{action}</div>
    </article>
  );
}
