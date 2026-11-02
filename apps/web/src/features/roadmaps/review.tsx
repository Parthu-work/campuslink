import { Link } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { ClipboardCheck, Download, Library, RefreshCw } from 'lucide-react';
import type { ReviewQueueItem, RoadmapCategory } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { BackLink } from '../../components/ui/back-link';
import { api, ApiError } from '../../lib/api';
import { formatDay, formatRelative } from '../../lib/format';
import { SCREEN } from '../../lib/query-client';

interface LibraryItem {
  key: string;
  title: string;
  category: RoadmapCategory;
  nodeCount: number;
  needsReviewCount: number;
  lastReviewedAt: string;
  installed: boolean;
  slug: string | null;
  updateAvailable: boolean;
}

function LibraryPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['roadmaps', 'library'],
    queryFn: () => api.get<LibraryItem[]>('/roadmaps/library'),
  });
  const install = useMutation({
    mutationFn: (key: string) =>
      api.post<{ installed: boolean; proposed: boolean }>(`/roadmaps/library/${key}`, {}),
    onSuccess: (r) => {
      toast.success(r.proposed ? t('roadmaps.library.proposed') : t('roadmaps.library.installed'));
      void qc.invalidateQueries({ queryKey: ['roadmaps'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <section aria-labelledby="library" className="grid gap-2">
      <h2 id="library" className="flex items-center gap-2 font-display text-title font-semibold">
        <Library className="size-5 text-brand-ink" aria-hidden /> {t('roadmaps.library.title')}
      </h2>
      <p className="text-meta text-fg-2">{t('roadmaps.library.intro')}</p>
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {(q.data ?? []).map((l) => (
            <li key={l.key}>
              <Card className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  {l.slug ? (
                    <Link
                      to={`/roadmaps/${l.slug}`}
                      className="inline-flex min-h-6 items-center font-semibold hover:underline"
                    >
                      {l.title}
                    </Link>
                  ) : (
                    <span className="font-semibold">{l.title}</span>
                  )}
                  <p className="text-caption text-fg-3">
                    {t(`roadmaps.cat.${l.category}`)} · {t('roadmaps.steps', { count: l.nodeCount })} ·{' '}
                    {t('roadmaps.lastReviewed', { date: formatDay(l.lastReviewedAt) })}
                  </p>
                </div>
                {!l.installed ? (
                  <Button
                    size="sm"
                    loading={install.isPending && install.variables === l.key}
                    onClick={() => install.mutate(l.key)}
                  >
                    <Download className="size-4" aria-hidden /> {t('roadmaps.library.install')}
                  </Button>
                ) : l.updateAvailable ? (
                  <Button
                    size="sm"
                    loading={install.isPending && install.variables === l.key}
                    onClick={() => install.mutate(l.key)}
                  >
                    <RefreshCw className="size-4" aria-hidden /> {t('roadmaps.library.update')}
                  </Button>
                ) : (
                  <Badge tone="success">{t('roadmaps.library.upToDate')}</Badge>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RoadmapReviewPage() {
  const { t } = useTranslation();
  const q = useQuery({
    ...SCREEN,
    queryKey: ['roadmaps', 'review-queue'],
    queryFn: () => api.get<ReviewQueueItem[]>('/roadmaps/review-queue'),
  });
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <BackLink to="/roadmaps">{t('roadmaps.title')}</BackLink>
        <PageHeader
          icon={<ClipboardCheck />}
          title={t('roadmaps.review.title')}
          intro={t('roadmaps.review.intro')}
        />
      </div>
      <section aria-labelledby="queue" className="grid gap-2">
        <h2 id="queue" className="font-display text-title font-semibold">
          {t('roadmaps.review.waiting')}
        </h2>
        {q.isLoading ? (
          <Skeleton className="h-24" />
        ) : !q.data?.length ? (
          <EmptyState icon={<ClipboardCheck className="size-6" />} title={t('roadmaps.review.empty')} />
        ) : (
          <ul className="grid gap-2">
            {q.data.map((i) => (
              <li key={`${i.roadmapId}-${i.version}`}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div>
                    <Link
                      to={`/roadmaps/${i.slug}/history`}
                      className="inline-flex min-h-6 items-center font-semibold hover:underline"
                    >
                      {i.title} · v{i.version}
                    </Link>
                    <p className="text-meta text-fg-2">{i.changeNote}</p>
                    <p className="text-caption text-fg-3">
                      {i.author ? i.author.name : t('roadmaps.libraryAuthor')} ·{' '}
                      {formatRelative(i.submittedAt)}
                    </p>
                  </div>
                  {i.isMine ? (
                    <Badge>{t('roadmaps.review.yours')}</Badge>
                  ) : (
                    <Link
                      to={`/roadmaps/${i.slug}/history`}
                      className="inline-flex min-h-11 items-center text-meta font-semibold text-brand-ink"
                    >
                      {t('roadmaps.review.open')}
                    </Link>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      <LibraryPanel />
    </div>
  );
}
