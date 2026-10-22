import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Map as MapIcon, Orbit, Plus, Search, Sparkles } from 'lucide-react';
import {
  BRANCHES,
  ROADMAP_CATEGORIES,
  type RoadmapCategory,
  type RoadmapSummaryView,
} from '@campuslink/shared';
import { IntentLink } from '../../components/ui/intent-link';
import { buttonVariants } from '../../components/ui/button-variants';
import { Input, Select } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Segmented } from '../../components/ui/tab-nav';
import { api } from '../../lib/api';
import { roadmapsList } from '../../lib/queries';
import { useCan } from '../../lib/me';
import { cn } from '../../lib/cn';
import { defaultRoadmapView, layoutGalaxy, rememberRoadmapView } from '../../lib/roadmaps';

/** Colour per category (design tokens only). */
const HUE: Record<RoadmapCategory, string> = {
  software: 'var(--brand)',
  'data-ai': 'var(--brand-2)',
  security: 'var(--danger)',
  'design-product': 'var(--warning)',
  'core-engineering': 'var(--accent)',
  'exams-higher-studies': 'var(--fg-2)',
};

function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 overflow-hidden rounded-full bg-surface-2"
    >
      <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function RoadmapCard({ r }: { r: RoadmapSummaryView }) {
  const { t } = useTranslation();
  return (
    <Card className="grid h-full gap-2 p-4 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-2">
        <IntentLink
          to={`/roadmaps/${r.slug}`}
          className="font-display text-lg leading-tight font-semibold after:absolute after:inset-0"
        >
          {r.title}
        </IntentLink>
        {r.featured && (
          <Badge tone="accent">
            <Sparkles className="size-3" aria-hidden /> {t('roadmaps.featured')}
          </Badge>
        )}
      </div>
      <p className="line-clamp-2 text-sm text-fg-2">{r.summary}</p>
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
            done={r.progress.done}
            total={r.progress.total}
            label={t('roadmaps.progressOf', { title: r.title })}
          />
          <span className="text-xs text-fg-3">{t('roadmaps.doneOf', r.progress)}</span>
        </div>
      )}
    </Card>
  );
}

function Galaxy({ roadmaps }: { roadmaps: RoadmapSummaryView[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // One column on phones so labels stay readable.
  const [columns] = useState(() =>
    typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches ? 1 : 2,
  );
  const { groups, width, height } = useMemo(
    () => layoutGalaxy(roadmaps, ROADMAP_CATEGORIES, columns),
    [roadmaps, columns],
  );
  const [focus, setFocus] = useState<RoadmapSummaryView | null>(null);
  return (
    <Card className="relative overflow-hidden p-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={t('roadmaps.galaxyLabel')}
        className="block h-auto w-full bg-[radial-gradient(ellipse_at_50%_40%,var(--surface-2),var(--surface-1)_75%)]"
      >
        {groups.map((g) => {
          const hue = HUE[g.category as RoadmapCategory];
          return (
            <g key={g.category}>
              <text
                x={g.cx}
                y={g.titleY}
                textAnchor="middle"
                className="fill-[var(--fg-2)] font-display text-[20px] font-semibold"
                aria-hidden
              >
                {t(`roadmaps.cat.${g.category}`)}
              </text>
              <circle cx={g.cx} cy={g.cy} r={4} fill={hue} opacity={0.6} aria-hidden />
              {g.stars.map((s) => (
                <line
                  key={`l-${s.roadmap.id}`}
                  x1={g.cx}
                  y1={g.cy}
                  x2={s.x}
                  y2={s.y}
                  stroke={hue}
                  strokeOpacity={0.3}
                  aria-hidden
                />
              ))}
              {g.stars.map((s) => {
                const p = s.roadmap.progress;
                const done = p ? p.done / Math.max(1, p.total) : 0;
                const name =
                  s.roadmap.title.length > 18 ? `${s.roadmap.title.slice(0, 17)}…` : s.roadmap.title;
                return (
                  <a
                    key={s.roadmap.id}
                    href={`/roadmaps/${s.roadmap.slug}`}
                    aria-label={`${s.roadmap.title}, ${t('roadmaps.steps', { count: s.roadmap.nodeCount })}${
                      p ? `, ${t('roadmaps.doneOf', p)}` : ''
                    }`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/roadmaps/${s.roadmap.slug}`);
                    }}
                    onFocus={() => setFocus(s.roadmap)}
                    onMouseEnter={() => setFocus(s.roadmap)}
                    className="group outline-none"
                  >
                    <circle
                      cx={s.x}
                      cy={s.y}
                      r={s.r + 9}
                      fill={hue}
                      opacity={0.16 + done * 0.3}
                      className="transition-opacity group-hover:opacity-50 group-focus-visible:opacity-60"
                    />
                    <circle
                      cx={s.x}
                      cy={s.y}
                      r={s.r}
                      fill={hue}
                      stroke={done > 0 ? 'var(--success)' : 'var(--surface-1)'}
                      strokeWidth={done > 0 ? 4 : 2}
                    />
                    <circle
                      cx={s.x}
                      cy={s.y}
                      r={s.r + 14}
                      fill="none"
                      stroke="var(--fg)"
                      strokeWidth={3}
                      className="opacity-0 group-focus-visible:opacity-100"
                    />
                    <text
                      x={s.label.x}
                      y={s.label.y}
                      textAnchor={s.label.anchor}
                      className="pointer-events-none fill-[var(--fg)] text-[15px] font-medium"
                    >
                      {name}
                    </text>
                  </a>
                );
              })}
            </g>
          );
        })}
      </svg>
      {focus && (
        <p
          className="pointer-events-none absolute inset-x-3 bottom-3 rounded-[var(--radius-sm)] border border-line bg-[var(--glass)] p-3 text-sm backdrop-blur"
          aria-live="polite"
        >
          <span className="font-semibold">{focus.title}</span> · {focus.summary.slice(0, 140)}
          {focus.summary.length > 140 ? '…' : ''}
        </p>
      )}
    </Card>
  );
}

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
  const list = useQuery({ ...roadmapsList(qs), placeholderData: keepPreviousData });
  const mine = useQuery({
    queryKey: ['roadmaps', 'following'],
    queryFn: () => api.get<RoadmapSummaryView[]>('/roadmaps?mine=following'),
    enabled: canProgress,
  });
  const drafts = useQuery({
    queryKey: ['roadmaps', 'drafts'],
    queryFn: () => api.get<RoadmapSummaryView[]>('/roadmaps?status=draft'),
    enabled: canWrite,
  });
  const rows = list.data ?? [];
  const byCategory = ROADMAP_CATEGORIES.map((c) => [c, rows.filter((r) => r.category === c)] as const).filter(
    ([, rs]) => rs.length,
  );

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[clamp(26px,4vw,34px)] font-bold">
            <Orbit className="size-7 text-brand-ink" aria-hidden /> {t('roadmaps.title')}
          </h1>
          <p className="max-w-[60ch] text-fg-2">{t('roadmaps.intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

      {!!mine.data?.length && (
        <section aria-labelledby="my-roadmaps" className="grid gap-2">
          <h2 id="my-roadmaps" className="font-display text-lg font-semibold">
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
          <h2 id="my-drafts" className="font-display text-lg font-semibold">
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
        <Galaxy roadmaps={rows} />
      ) : (
        <div className="grid gap-6">
          {byCategory.map(([c, rs]) => (
            <section key={c} aria-labelledby={`cat-${c}`} className="grid gap-2">
              <h2 id={`cat-${c}`} className={cn('font-display text-lg font-semibold')}>
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
      <p className="text-xs text-fg-3">{t('roadmaps.disclaimer')}</p>
    </div>
  );
}
