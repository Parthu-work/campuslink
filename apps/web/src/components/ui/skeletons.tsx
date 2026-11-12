import type { ReactNode } from 'react';
import { Skeleton } from './misc';
import { cn } from '../../lib/cn';

/** A loading placeholder in the shape of a ListRow (same height, avatar, two lines). */
export function SkeletonRow({ avatar = true, trailing = false }: { avatar?: boolean; trailing?: boolean }) {
  return (
    <div aria-hidden className="flex min-h-[var(--row-min-h)] items-center gap-3 px-4 py-[var(--row-py)]">
      {avatar && <Skeleton className="size-10 flex-none rounded-full" />}
      <div className="grid flex-1 gap-2">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
      {trailing && <Skeleton className="h-9 w-20 flex-none" />}
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
