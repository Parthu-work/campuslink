import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import type { FeedbackView } from '@campuslink/shared';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { api } from '../../lib/api';
import { formatRelative } from '../../lib/format';

interface Overview {
  requests30d: Record<string, number>;
  sessions: {
    upcomingSessions: number;
    completed30d: number;
    cancelled30d: number;
    noShows30d: number;
    feedback30d: number;
  };
}

/** Mentorship oversight: aggregate counts and private feedback (never conversations). */
export function MentorshipAdmin() {
  const { t } = useTranslation();
  const ov = useQuery({
    queryKey: ['admin-mentorship'],
    queryFn: () => api.get<Overview>('/admin/mentorship/overview'),
  });
  const fb = useQuery({
    queryKey: ['admin-feedback'],
    queryFn: () => api.get<FeedbackView[]>('/admin/mentorship/feedback'),
  });
  const tiles = ov.data
    ? ([
        [t('admin.mentorship.requests'), Object.values(ov.data.requests30d).reduce((a, b) => a + b, 0)],
        [t('admin.mentorship.accepted'), ov.data.requests30d.accepted ?? 0],
        [t('admin.mentorship.upcoming'), ov.data.sessions.upcomingSessions],
        [t('admin.mentorship.completed'), ov.data.sessions.completed30d],
        [t('admin.mentorship.cancelled'), ov.data.sessions.cancelled30d],
        [t('admin.mentorship.noShows'), ov.data.sessions.noShows30d],
      ] as const)
    : [];
  return (
    <>
      <p className="text-meta text-fg-2">{t('admin.mentorship.intro')}</p>
      {ov.isLoading ? (
        <Skeleton className="h-28" />
      ) : (
        <StatGrid className="md:grid-cols-3">
          {tiles.map(([label, value]) => (
            <StatCard key={label} label={label} value={value} />
          ))}
        </StatGrid>
      )}
      <section className="grid gap-2" aria-labelledby="fb-h">
        <h2 id="fb-h" className="text-title font-semibold">
          {t('admin.mentorship.feedback')}
        </h2>
        {fb.isSuccess && !fb.data.length && <p className="text-meta text-fg-3">{t('mentor.noFeedback')}</p>}
        <ul className="grid gap-2">
          {fb.data?.map((f) => (
            <li key={f.id}>
              <Card className="grid gap-1 p-4">
                <p className="text-meta">
                  <b>{f.mentee.name}</b> → <b>{f.mentor.name}</b>
                </p>
                <span role="img" aria-label={t('sessions.stars', { count: f.rating })} className="flex">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      aria-hidden
                      className={
                        n <= f.rating ? 'size-4 fill-[var(--accent)] text-accent-ink' : 'size-4 text-fg-3'
                      }
                    />
                  ))}
                </span>
                <div className="flex flex-wrap gap-1">
                  {f.tags.map((tag) => (
                    <Badge key={tag}>{t(`sessions.tag.${tag}`)}</Badge>
                  ))}
                </div>
                {f.comment && <p className="text-meta">{f.comment}</p>}
                <p className="text-caption text-fg-3">{formatRelative(f.createdAt)}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
