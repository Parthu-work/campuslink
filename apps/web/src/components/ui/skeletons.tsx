import type { ReactNode } from 'react';
import { Skeleton } from './misc';
import { cn } from '../../lib/cn';

/** A loading placeholder in the shape of a ListRow (same height, avatar or icon, two lines). */
export function SkeletonRow({
  avatar = true,
  icon = false,
  trailing = false,
}: {
  avatar?: boolean;
  /** A small square where the row leads with an icon instead of a face. */
  icon?: boolean;
  trailing?: boolean;
}) {
  return (
    <div aria-hidden className="flex min-h-[var(--row-min-h)] items-center gap-3 px-4 py-[var(--row-py)]">
      {icon ? (
        <Skeleton className="size-5 flex-none rounded-[var(--radius-sm)]" />
      ) : (
        avatar && <Skeleton className="size-10 flex-none rounded-full" />
      )}
      <div className="grid flex-1 gap-2">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
      {trailing && <Skeleton className="h-9 w-20 flex-none" />}
    </div>
  );
}

/**
 * A `ListSection` of `ListRow`s while it loads (prompt 3, U10): the heading if it has one, then
 * the rows in their frame, so the content replaces it in place instead of pushing the screen down.
 */
export function SkeletonRows({
  rows = 3,
  title = false,
  leading = 'avatar',
}: {
  rows?: number;
  title?: boolean;
  leading?: 'avatar' | 'icon' | 'none';
}) {
  return (
    <div className="grid min-w-0 gap-2" aria-hidden>
      {title && (
        <div className="flex min-h-11 items-end px-1">
          <Skeleton className="h-5 w-40" />
        </div>
      )}
      <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-1">
        {Array.from({ length: rows }, (_, i) => (
          <SkeletonRow key={i} avatar={leading === 'avatar'} icon={leading === 'icon'} />
        ))}
      </div>
    </div>
  );
}

/** A `DataTable` while its rows load (prompt 3, U10): the header, then compact rows, the first column wider. */
export function SkeletonTable({ rows = 6, columns = 3 }: { rows?: number; columns?: number }) {
  const cells = Array.from({ length: columns }, (_, c) => c);
  return (
    <div aria-hidden className="overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-1">
      <div className="flex gap-4 border-b border-line bg-surface-2 px-4 py-3">
        {cells.map((c) => (
          <Skeleton key={c} className={c === 0 ? 'h-3.5 w-24' : 'h-3.5 w-16'} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-line px-4 py-2.5 last:border-b-0">
          {cells.map((c) =>
            c === 0 ? (
              <span key={c} className="flex min-w-0 flex-1 items-center gap-3">
                <Skeleton className="size-8 flex-none rounded-full" />
                <Skeleton className="h-4 w-40 max-w-full" />
              </span>
            ) : (
              <Skeleton key={c} className="h-4 w-16 flex-none" />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

/** A loading placeholder for a card: a title, two lines and a button. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('grid gap-3 rounded-[var(--radius-md)] border border-line bg-surface-1 p-4', className)}
    >
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="h-3.5 w-3/5" />
      <Skeleton className="mt-1 h-11 w-32" />
    </div>
  );
}

/** A loading placeholder for a chart: bars on a baseline, in the chart's own height. */
export function SkeletonChart({ height = 160 }: { height?: number }) {
  return (
    <div aria-hidden className="flex items-end gap-2 border-b border-line px-2" style={{ height }}>
      {[0.45, 0.7, 0.55, 0.9, 0.65, 0.8, 0.5].map((h, i) => (
        <Skeleton key={i} className="flex-1 rounded-b-none" style={{ height: `${h * 100}%` }} />
      ))}
    </div>
  );
}

/** A keyboard key ("Ctrl", "K") for shortcuts in tips and the command palette. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid min-w-6 place-items-center rounded-[var(--radius-sm)] border border-b-2 border-line-strong bg-surface-2 px-1.5 font-sans text-caption font-semibold text-fg-2">
      {children}
    </kbd>
  );
}
