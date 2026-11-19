import { Skeleton } from './misc';

/**
 * Placeholders in the shape of what they stand for (prompt 3, U10: skeletons that match the final
 * layout), so the content replaces them in place instead of pushing the screen down. Decorative:
 * the screen's own status line says it is loading.
 */

/** A `ListSection` of `ListRow`s: an optional heading, then rows with a leading circle or icon. */
export function RowsSkeleton({
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
      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-1">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex min-h-[var(--row-min-h)] items-center gap-3 px-4 py-[var(--row-py)]">
            {leading === 'avatar' && <Skeleton className="size-10 flex-none rounded-full" />}
            {leading === 'icon' && <Skeleton className="size-5 flex-none rounded-[var(--radius-sm)]" />}
            <span className="grid min-w-0 flex-1 gap-1.5">
              <Skeleton className="h-4 w-2/3 max-w-72" />
              <Skeleton className="h-3.5 w-1/2 max-w-56" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A `DataTable` while its rows load: the header, then compact rows with the first column wider. */
export function TableSkeleton({ rows = 6, columns = 3 }: { rows?: number; columns?: number }) {
  const cells = Array.from({ length: columns }, (_, c) => c);
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-1"
      data-density="compact"
    >
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
