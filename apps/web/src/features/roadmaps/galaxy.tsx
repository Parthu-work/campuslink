import { lazy, Suspense, useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Map as MapIcon, Orbit, Plus, Search, Sparkles } from 'lucide-react';
import { BRANCHES, ROADMAP_CATEGORIES, type RoadmapSummaryView } from '@campuslink/shared';
import { IntentLink } from '../../components/ui/intent-link';
import { buttonVariants } from '../../components/ui/button-variants';
import { Input, Select } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ProgressBar } from '../../components/ui/progress';
import { Segmented } from '../../components/ui/tab-nav';
import { followedRoadmaps, roadmapDrafts, roadmapsList } from '../../lib/queries';
import { useCan } from '../../lib/me';
import { cn } from '../../lib/cn';
import { defaultRoadmapView, rememberRoadmapView } from '../../lib/roadmaps';
import { SCREEN } from '../../lib/query-client';

export function RoadmapCard({ r }: { r: RoadmapSummaryView }) {
  const { t } = useTranslation();
  return (
    <Card variant="interactive" className="grid h-full gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <IntentLink
          to={`/roadmaps/${r.slug}`}
          className="font-display text-title leading-tight font-semibold after:absolute after:inset-0"
        >
          {r.title}
        </IntentLink>
        {r.featured && (
          <Badge tone="accent">
            <Sparkles className="size-3" aria-hidden /> {t('roadmaps.featured')}
          </Badge>
        )}
      </div>
      <p className="line-clamp-2 text-meta text-fg-2">{r.summary}</p>
      <div className="flex flex-wrap gap-1.5">
        <Badge>{t(`roadmaps.cat.${r.category}`)}</Badge>
        <Badge>{t('roadmaps.steps', { count: r.nodeCount })}</Badge>
        {r.needsReviewCount > 0 && (
          <Badge tone="warning">{t('roadmaps.needsReviewCount', { count: r.needsReviewCount })}</Badge>
        )}
        {r.status !== 'published' && <Badge tone="brand">{t(`roadmaps.status.${r.status}`)}</Badge>}
      </div>
      {r.progress && (
        <div className="grid gap-1">
          <ProgressBar
            value={r.progress.done}
            max={r.progress.total}
            label={t('roadmaps.progressOf', { title: r.title })}
            valueText={t('roadmaps.doneOf', r.progress)}
            tone="success"
            size="sm"
          />
          <span className="text-caption text-fg-3">{t('roadmaps.doneOf', r.progress)}</span>
        </div>
      )}
    </Card>
  );
}

// The Galaxy renderer loads only when the Galaxy view is shown (bundle budget).
const GalaxyCanvas = lazy(() => import('./galaxy-canvas').then((m) => ({ default: m.GalaxyCanvas })));

export function RoadmapsPage() {
  const { t } = useTranslation();
  const canWrite = useCan('roadmaps:write');
  const canReview = useCan('roadmaps:review');
  const canProgress = useCan('roadmaps:progress');
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'graph' | 'list'>(defaultRoadmapView);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const qs = useDeferredValue(
    new URLSearchParams(
      ['q', 'category', 'branch'].flatMap((k) =>
        params.get(k)?.trim() ? [[k, (params.get(k) as string).trim()]] : [],
      ),
    ).toString(),
  );
  const list = useQuery({ ...SCREEN, ...roadmapsList(qs), placeholderData: keepPreviousData });
  // The route loader fetches these with the list, so the filters never jump when they arrive.
  const mine = useQuery({ ...followedRoadmaps(), enabled: canProgress });
  const drafts = useQuery({ ...roadmapDrafts(), enabled: canWrite });
  const rows = list.data ?? [];
  const byCategory = ROADMAP_CATEGORIES.map((c) => [c, rows.filter((r) => r.category === c)] as const).filter(
    ([, rs]) => rs.length,
  );

  return (
    <div className="grid gap-5">
      <PageHeader
        icon={<Orbit />}
        title={t('roadmaps.title')}
        intro={t('roadmaps.intro')}
        actions={
          <>
            {canReview && (
              <Link to="/roadmaps/review" className={buttonVariants({ size: 'sm' })}>
                <ClipboardCheck className="size-4" aria-hidden /> {t('roadmaps.review.title')}
              </Link>
            )}
            {canWrite && (
              <Link to="/roadmaps/new" className={buttonVariants({ size: 'sm', variant: 'primary' })}>
                <Plus className="size-4" aria-hidden /> {t('roadmaps.new')}
              </Link>
            )}
          </>
        }
      />

      {!!mine.data?.length && (
        <section aria-labelledby="my-roadmaps" className="grid gap-2">
          <h2 id="my-roadmaps" className="font-display text-title font-semibold">
            {t('roadmaps.mine')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mine.data.map((r) => (
              <li key={r.id} className="relative">
                <RoadmapCard r={r} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!drafts.data?.length && (
        <section aria-labelledby="my-drafts" className="grid gap-2">
          <h2 id="my-drafts" className="font-display text-title font-semibold">
            {t('roadmaps.drafts')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {drafts.data.map((r) => (
              <li key={r.id} className="relative">
                <RoadmapCard r={r} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
        <label className="relative">
          <span className="sr-only">{t('roadmaps.search')}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-fg-3"
            aria-hidden
          />
          <Input
            type="search"
            enterKeyHint="search"
            value={params.get('q') ?? ''}
            onChange={(e) => set('q', e.target.value)}
            placeholder={t('roadmaps.search')}
            className="pl-12"
          />
        </label>
        <Select
          aria-label={t('roadmaps.category')}
          value={params.get('category') ?? ''}
          onChange={(e) => set('category', e.target.value)}
        >
          <option value="">{t('roadmaps.allCategories')}</option>
          {ROADMAP_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`roadmaps.cat.${c}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('roadmaps.branch')}
          value={params.get('branch') ?? ''}
          onChange={(e) => set('branch', e.target.value)}
        >
          <option value="">{t('roadmaps.allBranches')}</option>
          {BRANCHES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
        <Segmented
          label={t('roadmaps.viewAs')}
          value={view}
          onChange={(v) => {
            setView(v);
            rememberRoadmapView(v);
          }}
          options={[
            ['graph', t('roadmaps.galaxy')],
            ['list', t('roadmaps.list')],
          ]}
        />
      </div>

      {list.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<MapIcon className="size-6" />} title={t('roadmaps.emptyTitle')}>
          {t('roadmaps.emptyBody')}
        </EmptyState>
      ) : view === 'graph' ? (
        <Suspense fallback={<Skeleton className="h-[min(78vh,760px)] rounded-[var(--radius-xl)]" />}>
          <GalaxyCanvas roadmaps={rows} />
        </Suspense>
      ) : (
        <div className="grid gap-6">
          {byCategory.map(([c, rs]) => (
            <section key={c} aria-labelledby={`cat-${c}`} className="grid gap-2">
              <h2 id={`cat-${c}`} className={cn('font-display text-title font-semibold')}>
                {t(`roadmaps.cat.${c}`)}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rs.map((r) => (
                  <li key={r.id} className="relative">
                    <RoadmapCard r={r} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="text-caption text-fg-3">{t('roadmaps.disclaimer')}</p>
    </div>
  );
}
