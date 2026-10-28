import { useDeferredValue, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { BellPlus, BriefcaseBusiness, ListChecks, Plus, Search, SlidersHorizontal } from 'lucide-react';
import {
  BRANCHES,
  JOB_LEVELS,
  JOB_TYPES,
  type AlertFilters,
  type JobAlertView,
  type JobView,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Input, Select } from '../../components/ui/field';
import { Sheet } from '../../components/ui/dialog';
import { Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { RadarSweep } from '../../components/ui/radar-sweep';
import { api, ApiError } from '../../lib/api';
import { jobsList, jobsRadar } from '../../lib/queries';
import { useCan } from '../../lib/me';
import { JobCard } from './job-card';
import { SCREEN } from '../../lib/query-client';

const FILTER_KEYS = [
  'q',
  'skills',
  'branch',
  'level',
  'mode',
  'type',
  'location',
  'fresher',
  'alumni',
] as const;
/** The refinements behind the Filters button on phones (the search and quick chips stay out). */
const REFINE_KEYS = ['level', 'type', 'branch', 'location'] as const;

function Section({ title, jobs, empty }: { title: string; jobs: JobView[]; empty?: string }) {
  if (!jobs.length && !empty) return null;
  return (
    <section aria-label={title} className="grid gap-2">
      <h2 className="font-display text-title font-semibold">{title}</h2>
      {jobs.length ? (
        <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
          {jobs.map((j) => (
            <li key={j.id} className="snap-start">
              <JobCard job={j} compact />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-fg-3">{empty}</p>
      )}
    </section>
  );
}

function RadarSections() {
  const { t } = useTranslation();
  const q = useQuery(jobsRadar());
  if (q.isLoading)
    return (
      <div className="grid gap-3" aria-hidden>
        <Skeleton className="h-6 w-40" />
        <div className="flex gap-3">
          <Skeleton className="h-44 w-[280px] flex-none" />
          <Skeleton className="h-44 w-[280px] flex-none" />
        </div>
      </div>
    );
  const r = q.data;
  if (!r) return null;
  return (
    <>
      <p className="text-meta text-fg-2" role="status">
        {t('jobs.newThisWeek', { count: r.newThisWeek })}
      </p>
      <Section title={t('jobs.sections.forYou')} jobs={r.forYou} />
      <Section title={t('jobs.sections.alumniCanRefer')} jobs={r.alumniCanRefer} />
      <Section title={t('jobs.sections.fresherFriendly')} jobs={r.fresherFriendly} />
      <Section title={t('jobs.sections.closingSoon')} jobs={r.closingSoon} />
    </>
  );
}

function AlertButton({ filters }: { filters: AlertFilters }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const name = [
    filters.q,
    filters.skills?.join(', '),
    filters.location,
    filters.level && t(`jobs.level.${filters.level}`),
  ]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 60);
  const create = useMutation({
    mutationFn: () =>
      api.post<JobAlertView>('/me/job-alerts', {
        name: name.length >= 2 ? name : t('jobs.myAlert'),
        filters,
      }),
    onSuccess: () => {
      toast.success(t('jobs.alertCreated'));
      void qc.invalidateQueries({ queryKey: ['job-alerts'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Button size="sm" loading={create.isPending} onClick={() => create.mutate()}>
      <BellPlus className="size-4" aria-hidden /> {t('jobs.alertForSearch')}
    </Button>
  );
}

export function JobsPage() {
  const { t } = useTranslation();
  const canPost = useCan('jobs:post');
  const canSave = useCan('jobs:save');
  const [params, setParams] = useSearchParams();
  const alertId = params.get('alert');
  // Opening a job-alert notification applies that alert's filters.
  const alerts = useQuery({
    queryKey: ['job-alerts'],
    queryFn: () => api.get<JobAlertView[]>('/me/job-alerts'),
    enabled: !!alertId && canSave,
  });
  useEffect(() => {
    const a = alerts.data?.find((x) => x.id === alertId);
    if (!a) return;
    const next = new URLSearchParams();
    const f = a.filters;
    if (f.q) next.set('q', f.q);
    if (f.skills?.length) next.set('skills', f.skills.join(','));
    for (const k of ['branch', 'level', 'mode', 'type', 'location'] as const)
      if (f[k]) next.set(k, String(f[k]));
    if (f.fresher) next.set('fresher', 'true');
    setParams(next, { replace: true });
  }, [alerts.data, alertId, setParams]);

  const set = (k: (typeof FILTER_KEYS)[number], v: string) => {
    const next = new URLSearchParams(params);
    next.delete('alert');
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const filtering = FILTER_KEYS.some((k) => params.get(k)?.trim());
  // Typing updates the URL at once; the list follows the deferred value so keystrokes stay smooth.
  const qs = useDeferredValue(
    new URLSearchParams(
      FILTER_KEYS.flatMap((k) => (params.get(k)?.trim() ? [[k, (params.get(k) as string).trim()]] : [])),
    ).toString(),
  );
  const list = useInfiniteQuery({ ...SCREEN, ...jobsList(qs), placeholderData: keepPreviousData });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const filters: AlertFilters = {
    ...(params.get('q') ? { q: params.get('q') as string } : {}),
    ...(params.get('skills') ? { skills: (params.get('skills') as string).split(',').filter(Boolean) } : {}),
    ...(params.get('branch') ? { branch: params.get('branch') as AlertFilters['branch'] } : {}),
    ...(params.get('level') ? { level: params.get('level') as AlertFilters['level'] } : {}),
    ...(params.get('mode') ? { mode: params.get('mode') as AlertFilters['mode'] } : {}),
    ...(params.get('type') ? { type: params.get('type') as AlertFilters['type'] } : {}),
    ...(params.get('location') ? { location: params.get('location') as string } : {}),
    ...(params.get('fresher') ? { fresher: true } : {}),
  };

  const [sheet, setSheet] = useState(false);
  const refining = REFINE_KEYS.filter((k) => params.get(k)?.trim()).length;
  // Level, type, branch and place: inline from 640 px, in a sheet on phones so results show first (IA-11).
  const fields = (visible: boolean) => (
    <>
      <label className="grid gap-1.5">
        <span className={visible ? 'text-meta font-semibold' : 'sr-only'}>{t('jobs.levelLabel')}</span>
        <Select value={params.get('level') ?? ''} onChange={(e) => set('level', e.target.value)} size="sm">
          <option value="">{t('jobs.anyLevel')}</option>
          {JOB_LEVELS.map((l) => (
            <option key={l} value={l}>
              {t(`jobs.level.${l}`)}
            </option>
          ))}
        </Select>
      </label>
      <label className="grid gap-1.5">
        <span className={visible ? 'text-meta font-semibold' : 'sr-only'}>{t('jobs.typeLabel')}</span>
        <Select value={params.get('type') ?? ''} onChange={(e) => set('type', e.target.value)} size="sm">
          <option value="">{t('jobs.anyType')}</option>
          {JOB_TYPES.map((l) => (
            <option key={l} value={l}>
              {t(`jobs.type.${l}`)}
            </option>
          ))}
        </Select>
      </label>
      <label className="grid gap-1.5">
        <span className={visible ? 'text-meta font-semibold' : 'sr-only'}>{t('people.branch')}</span>
        <Select value={params.get('branch') ?? ''} onChange={(e) => set('branch', e.target.value)} size="sm">
          <option value="">{t('people.anyBranch')}</option>
          {BRANCHES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
      </label>
      <label className="grid gap-1.5">
        <span className={visible ? 'text-meta font-semibold' : 'sr-only'}>{t('jobs.location')}</span>
        <Input
          value={params.get('location') ?? ''}
          onChange={(e) => set('location', e.target.value)}
          placeholder={t('jobs.location')}
          className="min-h-11 text-meta"
        />
      </label>
    </>
  );

  return (
    <div className="grid gap-5">
      <PageHeader
        icon={<RadarSweep />}
        title={t('jobs.title')}
        intro={t('jobs.intro')}
        actions={
          <>
            {canSave && (
              <Link to="/jobs/tracker" className={buttonVariants({ size: 'sm' })}>
                <ListChecks className="size-4" aria-hidden /> {t('jobs.tracker')}
              </Link>
            )}
            {canPost && (
              <Link to="/jobs/new" className={buttonVariants({ size: 'sm', variant: 'primary' })}>
                <Plus className="size-4" aria-hidden /> {t('jobs.postJob')}
              </Link>
            )}
          </>
        }
      />

      <div className="grid gap-3">
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t('jobs.search')}</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-fg-3"
              aria-hidden
            />
            <Input
              type="search"
              enterKeyHint="search"
              value={params.get('q') ?? ''}
              onChange={(e) => set('q', e.target.value)}
              placeholder={t('jobs.search')}
              className="pl-11"
            />
          </label>
          <Button className="flex-none sm:hidden" aria-haspopup="dialog" onClick={() => setSheet(true)}>
            <SlidersHorizontal className="size-4" aria-hidden />
            {refining ? t('jobs.filtersCount', { count: refining }) : t('jobs.filters')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t('jobs.quickFilters')} className="flex flex-wrap gap-2">
            <Chip
              pressed={!!params.get('fresher')}
              onClick={() => set('fresher', params.get('fresher') ? '' : 'true')}
            >
              {t('jobs.fresherFriendly')}
            </Chip>
            <Chip
              pressed={!!params.get('alumni')}
              onClick={() => set('alumni', params.get('alumni') ? '' : 'true')}
            >
              {t('jobs.withAlumni')}
            </Chip>
            <Chip
              pressed={params.get('mode') === 'remote'}
              onClick={() => set('mode', params.get('mode') === 'remote' ? '' : 'remote')}
            >
              {t('jobs.mode.remote')}
            </Chip>
          </div>
        </div>
        <div className="hidden gap-2 sm:grid sm:grid-cols-4">{fields(false)}</div>
        <Sheet
          open={sheet}
          onOpenChange={setSheet}
          title={t('jobs.filters')}
          footer={
            <Button variant="primary" className="w-full" onClick={() => setSheet(false)}>
              {t('jobs.showOpenings')}
            </Button>
          }
        >
          <div className="grid gap-4">{fields(true)}</div>
        </Sheet>
        {filtering && canSave && (
          <div>
            <AlertButton filters={filters} />
          </div>
        )}
      </div>

      {!filtering && <RadarSections />}

      <section aria-labelledby="all-jobs" className="grid gap-3">
        <h2 id="all-jobs" className="font-display text-title font-semibold">
          {filtering ? t('jobs.results') : t('jobs.allOpenings')}
        </h2>
        {list.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2" aria-hidden>
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        )}
        {list.isSuccess && !rows.length && (
          <EmptyState
            icon={<BriefcaseBusiness className="size-6" />}
            title={filtering ? t('jobs.noMatches') : t('jobs.empty')}
          >
            {filtering ? t('jobs.noMatchesBody') : t('jobs.emptyBody')}
          </EmptyState>
        )}
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((j) => (
            <li key={j.id}>
              <JobCard job={j} />
            </li>
          ))}
        </ul>
        {list.hasNextPage && (
          <Button loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {t('common.loadMore')}
          </Button>
        )}
      </section>
    </div>
  );
}
