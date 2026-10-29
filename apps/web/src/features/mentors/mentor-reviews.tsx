import { useInfiniteQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/misc';
import { mentorReviews } from '../../lib/queries';
import { ContentMenu } from '../feed/content-menu';

/** Published reviews on the mentor page: first names, session type, rating, and a report menu. */
export function MentorReviews({ mentorId }: { mentorId: string }) {
  const { t } = useTranslation();
  const q = useInfiniteQuery(mentorReviews(mentorId));
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  if (q.isLoading) return <Skeleton className="h-24" />;
  if (!rows.length) return null;
  return (
    <section aria-labelledby="mentor-reviews" className="grid gap-3">
      <h2 id="mentor-reviews" className="eyebrow">
        {t('mentorStats.reviews')}
      </h2>
      <ul className="grid gap-3">
        {rows.map((r) => (
          <li key={r.id} className="grid gap-1.5 rounded-[var(--radius-md)] bg-surface-2 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-meta font-semibold">
                <span
                  role="img"
                  className="inline-flex items-center gap-0.5"
                  aria-label={t('mentorStats.stars', { count: r.rating })}
                >
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      aria-hidden
                      className={i < r.rating ? 'size-4 fill-current text-brand-ink' : 'size-4 text-fg-3'}
                    />
                  ))}
                </span>
                {r.author}
                <span className="font-normal text-fg-3">· {t(`session.type.${r.sessionType}`)}</span>
              </p>
              <ContentMenu
                targetType="review"
                targetId={r.id}
                authorId=""
                authorName={r.author}
                isMine={false}
                blockable={false}
              />
            </div>
            <p className="text-meta whitespace-pre-line">{r.text}</p>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <Button onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
          {t('common.loadMore')}
        </Button>
      )}
    </section>
  );
}
