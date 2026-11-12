import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TimelineItem {
  id: string;
  /** When ("Mon 10 Nov, 3:00 pm" or "Round 2"). */
  time: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** Past, happening now, or still to come. */
  state: 'past' | 'current' | 'future';
  /** A status badge (Selected, Not selected). */
  badge?: ReactNode;
}

/**
 * Things in time order (ADR 0015): a session's agenda, a drive's rounds, a roadmap's history. A
 * vertical line with a dot per item; the current one is filled in the college's colour.
 */
export function Timeline({ items, label }: { items: TimelineItem[]; label?: string }) {
  return (
    <ol className="grid" aria-label={label}>
      {items.map((item, i) => (
        <li
          key={item.id}
          aria-current={item.state === 'current' ? 'step' : undefined}
          className="relative flex gap-3 pb-5 last:pb-0"
        >
          {i < items.length - 1 && (
            <span aria-hidden className="absolute top-4 bottom-0 left-[0.4375rem] w-px bg-line-strong" />
          )}
          <span
            aria-hidden
            className={cn(
              'relative mt-1 size-3.5 flex-none rounded-full border-2',
              item.state === 'current' && 'border-brand bg-brand',
              item.state === 'past' && 'border-line-strong bg-line-strong',
              item.state === 'future' && 'border-line-strong bg-surface-1',
            )}
          />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-caption text-fg-3">{item.time}</span>
            <span className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'text-body font-medium text-pretty break-words',
                  item.state === 'past' && 'text-fg-2',
                )}
              >
                {item.title}
              </span>
              {item.badge}
            </span>
            {item.meta && <span className="text-callout text-fg-2">{item.meta}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
