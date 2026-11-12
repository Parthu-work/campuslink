import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { IntentLink } from './intent-link';
import { cn } from '../../lib/cn';

/**
 * One row of a list (ADR 0015): a leading avatar or icon, a title that wraps (never an ellipsis,
 * X5), a meta line, and a trailing action or a chevron. The whole row is the target (at least
 * 44 px; 56 by default, 44 in compact density). With `to` the row is a link; a trailing action
 * still works on its own (it sits above the link's stretched hit area).
 *
 * Render rows inside a `ListSection` (or any `<ul>`): each row is an `<li>`.
 */
export function ListRow({
  title,
  meta,
  leading,
  trailing,
  to,
  onClick,
  chevron,
  selected,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  /** An action (a small button) or a status (a badge, a count). */
  trailing?: ReactNode;
  /** The row opens this screen. */
  to?: string;
  /** The row does this (when it is not a link). */
  onClick?: () => void;
  /** A chevron after the content; default on for link rows without a trailing action. */
  chevron?: boolean;
  /** Marks the row as the one shown beside the list (list and detail on desktop). */
  selected?: boolean;
  className?: string;
}) {
  const showChevron = chevron ?? (!!to && !trailing);
  const body = (
    <>
      {leading && <span className="flex flex-none items-center text-fg-2 [&>svg]:size-5">{leading}</span>}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-body font-medium text-pretty break-words text-fg">{title}</span>
        {meta && <span className="text-callout text-pretty break-words text-fg-2">{meta}</span>}
      </span>
    </>
  );
  const hit =
    'flex min-w-0 flex-1 items-center gap-3 text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[""] focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-[var(--focus-ring)]';
  return (
    <li
      className={cn(
        'relative flex min-h-[var(--row-min-h)] items-center gap-3 px-4 py-[var(--row-py)]',
        (to || onClick) && 'transition-colors duration-[var(--dur-press)] hover:bg-hover active:bg-press',
        selected && 'bg-brand-surface',
        className,
      )}
      aria-current={selected || undefined}
    >
      {to ? (
        <IntentLink to={to} className={hit}>
          {body}
        </IntentLink>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={hit}>
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      )}
      {trailing && <span className="relative z-[1] flex flex-none items-center gap-2">{trailing}</span>}
      {showChevron && <ChevronRight className="size-5 flex-none text-fg-3 rtl:rotate-180" aria-hidden />}
    </li>
  );
}

/**
 * A titled group of rows (ADR 0015): replaces cards full of hand-made rows. One surface with
 * dividers, never a card inside a card. `action` is a quiet link beside the title ("See all").
 */
export function ListSection({
  title,
  action,
  children,
  footer,
  level = 2,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  level?: 2 | 3;
  className?: string;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section className={cn('grid min-w-0 gap-2', className)}>
      {(title || action) && (
        <div className="flex min-h-11 items-end justify-between gap-3 px-1">
          {title && <Heading className="text-headline font-semibold">{title}</Heading>}
          {action && <div className="flex-none">{action}</div>}
        </div>
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-1">
        {children}
      </ul>
      {footer}
    </section>
  );
}
