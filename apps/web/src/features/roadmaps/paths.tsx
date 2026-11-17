import { useDeferredValue } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Compass, Plus, Search } from 'lucide-react';
import {
  BRANCHES,
  DEFAULT_HOURS_PER_WEEK,
  ROADMAP_CATEGORIES,
  type RoadmapSummaryView,
} from '@campuslink/shared';
import { ActionCard } from '../../components/ui/action-card';
import { buttonVariants } from '../../components/ui/button-variants';
import { Input, Select } from '../../components/ui/field';
import { IntentLink } from '../../components/ui/intent-link';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { Card, Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ProgressRing } from '../../components/ui/progress';
import { Toolbar } from '../../components/ui/toolbar';
import { followedRoadmaps, roadmapDrafts, roadmapsList } from '../../lib/queries';
import { useCan, useMe } from '../../lib/me';
import { useTimeText } from '../../lib/roadmaps';
import { SCREEN } from '../../lib/query-client';

/** "about 14 weeks at 6 h a week · 10 steps": a path's size, at the stated pace. */
function useSizeText() {
  const { t } = useTranslation();
  const time = useTimeText();
  return (r: RoadmapSummaryView, pace = DEFAULT_HOURS_PER_WEEK) =>
    [
      t('roadmaps.atPace', { time: time(r.hours, pace), hours: pace }),
      t('roadmaps.steps', { count: r.nodeCount }),
    ].join(' · ');
}

/** A path offered for the member's branch: what it leads to, how long, how many steps. */
function PathCard({ r }: { r: RoadmapSummaryView }) {
  const { t } = useTranslation();
  const size = useSizeText();
  return (
    <Card variant="interactive" className="relative grid h-full content-start gap-2 p-4">
      <IntentLink
        to={`/roadmaps/${r.slug}`}
        className="text-headline font-semibold text-pretty break-words after:absolute after:inset-0"
      >
        {r.title}
      </IntentLink>
      {r.outcome && <p className="text-callout text-fg">{t('roadmaps.leadsTo', { outcome: r.outcome })}</p>}
      <p className="text-callout text-fg-2">{size(r)}</p>
    </Card>
  );
}

/** A followed path as "do this next": its next step, where it is, and Continue. */
function ContinueCard({ r }: { r: RoadmapSummaryView }) {
  const { t } = useTranslation();
  const time = useTimeText();
  const p = r.progress;
  if (!p) return null;
  const ring = (
    <ProgressRing
      value={p.done}
      max={p.total}
      size={48}
      label={t('roadmaps.progressOf', { title: r.title })}
      valueText={t('roadmaps.stepsDone', { done: p.done, total: p.total })}
    />
  );
  if (!p.next)
    return (
      <ActionCard
        level={3}
        leading={ring}
        kicker={r.title}
        title={t('roadmaps.finished', { total: p.total })}
        action={
          <Link to={`/roadmaps/${r.slug}`} className={buttonVariants({ variant: 'secondary' })}>
            {t('roadmaps.lookBack')}
          </Link>
        }
      />
    );
  const pace = p.hoursPerWeek || DEFAULT_HOURS_PER_WEEK;
  const when = time(p.next.estimateHours, pace);
  return (
    <ActionCard
      level={3}
      leading={ring}
      kicker={r.title}
      title={p.next.title}
      meta={[
        t('ui.stepOf', { n: p.done + 1, total: p.total }),
        p.hoursPerWeek
          ? t('roadmaps.atYourPace', { time: when })
          : t('roadmaps.atPace', { time: when, hours: pace }),
      ].join(' · ')}
      action={
        <Link
          to={`/roadmaps/${r.slug}?step=${encodeURIComponent(p.next.id)}`}
          className={buttonVariants({ variant: 'primary', size: 'lg' })}
        >
          {t('roadmaps.continue')} <ArrowRight aria-hidden />
        </Link>
      }
    />
  );
}

/**
 * Career paths (prompt 3, U3): first the paths a member follows, each with its next step and
 * Continue; then paths for their branch; then every path by category, with search and filters.
 */
export function PathsPage() {
  const { t } = useTranslation();
  const canWrite = useCan('roadmaps:write');
  const canReview = useCan('roadmaps:review');
  const canProgress = useCan('roadmaps:progress');
  const { data: me } = useMe();
  const size = useSizeText();
  const [params, setParams] = useSearchParams();
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
  const filtered = qs.length > 0;
  const list = useQuery({ ...SCREEN, ...roadmapsList(qs), placeholderData: keepPreviousData });
  // The route loader fetches these with the list, so the sections never jump when they arrive.
  const mine = useQuery({ ...followedRoadmaps(), enabled: canProgress });
  const drafts = useQuery({ ...roadmapDrafts(), enabled: canWrite });
  const rows = list.data ?? [];
  const followed = new Set((mine.data ?? []).map((r) => r.id));
  const branch = me?.branch ?? null;
  const forBranch =
    branch && !filtered ? rows.filter((r) => r.branches.includes(branch) && !followed.has(r.id)) : [];
  const byCategory = ROADMAP_CATEGORIES.map((c) => [c, rows.filter((r) => r.category === c)] as const).filter(
    ([, rs]) => rs.length,
  );
  const active = (params.get('category') ? 1 : 0) + (params.get('branch') ? 1 : 0);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('roadmaps.pathsTitle')}
        size="display"
        about={t('roadmaps.intro')}
        primary={
          canWrite ? (
            <Link to="/roadmaps/new" className={buttonVariants({ variant: 'primary' })}>
              <Plus aria-hidden /> {t('roadmaps.newPath')}
            </Link>
          ) : undefined
        }
        {...(canReview ? { overflow: [{ label: t('roadmaps.review.title'), to: '/roadmaps/review' }] } : {})}
      />

      {!!mine.data?.length && (
        <section aria-labelledby="continue" className="grid gap-3">
          <h2 id="continue" className="text-title font-semibold">
            {t('roadmaps.continue')}
          </h2>
          <ul className="grid gap-3 lg:grid-cols-2">
            {mine.data.map((r) => (
              <li key={r.id} className="min-w-0">
                <ContinueCard r={r} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!drafts.data?.length && (
        <ListSection title={t('roadmaps.drafts')}>
          {drafts.data.map((r) => (
            <ListRow
              key={r.id}
              to={`/roadmaps/${r.slug}`}
              title={r.title}
              meta={[t(`roadmaps.status.${r.status}`), t('roadmaps.steps', { count: r.nodeCount })].join(
                ' · ',
              )}
            />
          ))}
        </ListSection>
      )}

      {forBranch.length > 0 && (
        <section aria-labelledby="for-branch" className="grid gap-3">
          <h2 id="for-branch" className="text-title font-semibold">
            {t('roadmaps.forBranch', { branch })}
          </h2>
          {/* A row that scrolls sideways on phones, a grid from tablet width. The scroller is
              relative so nothing visually hidden inside it widens the page. */}
          <ul className="relative -mx-[var(--gutter)] flex snap-x gap-3 overflow-x-auto px-[var(--gutter)] pb-1 [contain:inline-size] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3 [&::-webkit-scrollbar]:hidden">
            {forBranch.map((r) => (
              <li key={r.id} className="w-[min(18rem,80%)] flex-none snap-start md:w-auto">
                <PathCard r={r} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="all-paths" className="grid gap-4">
        <h2 id="all-paths" className="text-title font-semibold">
          {t('roadmaps.allPaths')}
        </h2>
        <Toolbar
          search={
            <label className="relative block">
              <span className="sr-only">{t('roadmaps.search')}</span>
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-fg-3"
                aria-hidden
              />
              <Input
                type="search"
                enterKeyHint="search"
                value={params.get('q') ?? ''}
                onChange={(e) => set('q', e.target.value)}
                placeholder={t('roadmaps.search')}
                className="pl-11"
              />
            </label>
          }
          activeFilters={active}
          onClearFilters={() => {
            const next = new URLSearchParams(params);
            next.delete('category');
            next.delete('branch');
            setParams(next, { replace: true });
          }}
          filters={
            <>
              <div role="group" aria-label={t('roadmaps.category')} className="flex flex-wrap gap-2">
                {ROADMAP_CATEGORIES.map((c) => (
                  <Chip
                    key={c}
                    pressed={params.get('category') === c}
                    onClick={() => set('category', params.get('category') === c ? '' : c)}
                  >
                    {t(`roadmaps.cat.${c}`)}
                  </Chip>
                ))}
              </div>
              <Select
                aria-label={t('roadmaps.branch')}
                size="sm"
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
            </>
          }
        />
        {list.isLoading ? (
          <div className="grid gap-2" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : !rows.length ? (
          <EmptyState icon={<Compass />} title={t('roadmaps.emptyTitle')}>
            {t('roadmaps.emptyBody')}
          </EmptyState>
        ) : (
          byCategory.map(([c, rs]) => (
            <ListSection key={c} title={t(`roadmaps.cat.${c}`)} level={3}>
              {rs.map((r) => (
                <ListRow
                  key={r.id}
                  to={`/roadmaps/${r.slug}`}
                  title={r.title}
                  meta={[r.outcome && t('roadmaps.leadsTo', { outcome: r.outcome }), size(r)]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </ListSection>
          ))
        )}
      </section>
    </div>
  );
}
