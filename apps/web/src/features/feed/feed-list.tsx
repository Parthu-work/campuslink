import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { FeedEntry, PostView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Card, Skeleton } from '../../components/ui/misc';
import { apiRequest } from '../../lib/api';
import { ItemCard, PostCard } from './post-card';

export function PostSkeleton() {
  return (
    <Card className="grid gap-3 p-4" aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="grid flex-1 gap-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-9 w-full" />
    </Card>
  );
}

type Row = FeedEntry;

/**
 * Infinite, virtualised list of feed entries (window scrolling, measured rows). Only rows near the
 * viewport are in the DOM, so long sessions stay fast on low-end phones.
 */
export function FeedList({
  queryKey,
  path,
  label,
  empty,
  posts = false,
}: {
  queryKey: readonly unknown[];
  /** API path; `cursor` is appended. */
  path: string;
  label: string;
  empty: ReactNode;
  /** The endpoint returns PostView[] rather than FeedEntry[]. */
  posts?: boolean;
}) {
  const { t } = useTranslation();
  const q = useInfiniteQuery({
    queryKey,
    initialPageParam: '',
    queryFn: async ({ pageParam }) => {
      const sep = path.includes('?') ? '&' : '?';
      const r = await apiRequest<FeedEntry[] | PostView[]>(
        `${path}${pageParam ? `${sep}cursor=${encodeURIComponent(pageParam)}` : ''}`,
      );
      const rows: Row[] = posts
        ? (r.data as PostView[]).map((post) => ({ type: 'post', post }))
        : (r.data as FeedEntry[]);
      return { rows, next: r.meta?.nextCursor ?? null };
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    setMargin(listRef.current ? listRef.current.getBoundingClientRect().top + window.scrollY : 0);
  }, [q.isSuccess]);
  const v = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 300,
    overscan: 4,
    gap: 12,
    scrollMargin: margin,
  });
  const items = v.getVirtualItems();
  const last = items.at(-1);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  useEffect(() => {
    if (last && last.index >= rows.length - 3 && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [last, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (q.isLoading)
    return (
      <div className="grid gap-3" aria-busy="true" aria-label={label}>
        <PostSkeleton />
        <PostSkeleton />
        <PostSkeleton />
      </div>
    );
  if (q.isError)
    return (
      <Card className="grid justify-items-center gap-3 p-6 text-center">
        <p className="text-fg-2">{t('feed.loadFailed')}</p>
        <Button onClick={() => void q.refetch()}>{t('common.retry')}</Button>
      </Card>
    );
  if (!rows.length) return <>{empty}</>;
  return (
    <>
      <div
        ref={listRef}
        role="feed"
        aria-label={label}
        aria-busy={isFetchingNextPage}
        className="relative"
        style={{ height: v.getTotalSize() }}
      >
        {items.map((it) => {
          const row = rows[it.index];
          if (!row) return null;
          return (
            <div
              key={row.type === 'post' ? `p${row.post.id}` : `i${row.item.id}`}
              data-index={it.index}
              ref={v.measureElement}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${it.start - v.options.scrollMargin}px)` }}
            >
              {row.type === 'post' ? <PostCard post={row.post} /> : <ItemCard item={row.item} />}
            </div>
          );
        })}
      </div>
      {isFetchingNextPage && <PostSkeleton />}
      {!hasNextPage && rows.length > 5 && (
        <p className="py-4 text-center text-sm text-fg-3">{t('feed.end')}</p>
      )}
    </>
  );
}
