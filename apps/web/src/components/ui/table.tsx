import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/**
 * Data tables for the quiet professional screens (admin, analytics): a focusable, labelled scroll
 * region on narrow screens, a sticky header, airy rows and tabular numerals.
 */
export function Table({
  label,
  caption,
  children,
  className,
}: {
  /** Names the scroll region for screen readers; also used as the caption when none is given. */
  label: string;
  caption?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      // Inline-size containment: a wide table scrolls inside its region instead of widening every
      // grid and flex parent up the tree (and with them, the page).
      className={cn(
        'overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface-1 [contain:inline-size]',
        className,
      )}
    >
      <table className="w-full border-collapse text-left text-meta tabular-nums">
        <caption className="sr-only">{caption ?? label}</caption>
        {children}
      </table>
    </div>
  );
}

export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} className={cn('sticky top-0 z-[1] bg-surface-2', props.className)} />;
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-3 text-caption font-semibold tracking-wide whitespace-nowrap text-fg-2',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-t border-line px-4 py-3 align-middle', className)} {...props} />;
}

/** Right-aligned numeric cell. */
export function TdNum({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <Td className={cn('text-right font-medium', className)} {...props} />;
}
