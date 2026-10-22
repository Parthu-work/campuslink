import { useDeferredValue, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BellPlus, BriefcaseBusiness, ListChecks, Plus, Radar, Search } from 'lucide-react';
import {
  BRANCHES,
  JOB_LEVELS,
  JOB_TYPES,
  type AlertFilters,
  type JobAlertView,
  type JobView,
  type RadarView,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Input, Select } from '../../components/ui/field';
import { Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { api, apiRequest, ApiError } from '../../lib/api';
import { useCan } from '../../lib/me';
import { JobCard } from './job-card';

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

function Section({ title, jobs, empty }: { title: string; jobs: JobView[]; empty?: string }) {
  if (!jobs.length && !empty) return null;
  return (
    <section aria-label={title} className="grid gap-2">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {jobs.length ? (
        <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
          {jobs.map((j) => (
            <li key={j.id} className="snap-start">
              <JobCard job={j} compact />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-3">{empty}</p>
      )}
    </section>
  );
}

function RadarSections() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['jobs', 'radar'], queryFn: () => api.get<RadarView>('/jobs/radar') });
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
      <p className="text-sm text-fg-2" role="status">
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
  const list = useInfiniteQuery({
    queryKey: ['jobs', 'list', qs],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<JobView[]>(`/jobs?${qs}${pageParam ? `${qs ? '&' : ''}cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });
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

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[clamp(26px,4vw,34px)] font-bold">
            <Radar className="size-7 text-accent-ink" aria-hidden /> {t('jobs.title')}
          </h1>
          <p className="text-fg-2">{t('jobs.intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

      <div className="grid gap-3">
        <label className="relative">
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label>
            <span className="sr-only">{t('jobs.levelLabel')}</span>
            <Select
              value={params.get('level') ?? ''}
              onChange={(e) => set('level', e.target.value)}
              className="min-h-10"
            >
              <option value="">{t('jobs.anyLevel')}</option>
              {JOB_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`jobs.level.${l}`)}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span className="sr-only">{t('jobs.typeLabel')}</span>
            <Select
              value={params.get('type') ?? ''}
              onChange={(e) => set('type', e.target.value)}
              className="min-h-10"
            >
              <option value="">{t('jobs.anyType')}</option>
              {JOB_TYPES.map((l) => (
                <option key={l} value={l}>
                  {t(`jobs.type.${l}`)}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span className="sr-only">{t('people.branch')}</span>
            <Select
              value={params.get('branch') ?? ''}
              onChange={(e) => set('branch', e.target.value)}
              className="min-h-10"
            >
              <option value="">{t('people.anyBranch')}</option>
              {BRANCHES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span className="sr-only">{t('jobs.location')}</span>
            <Input
              value={params.get('location') ?? ''}
              onChange={(e) => set('location', e.target.value)}
              placeholder={t('jobs.location')}
              className="min-h-10"
            />
          </label>
        </div>
        {filtering && canSave && (
          <div>
            <AlertButton filters={filters} />
          </div>
        )}
      </div>

      {!filtering && <RadarSections />}

      <section aria-labelledby="all-jobs" className="grid gap-3">
        <h2 id="all-jobs" className="font-display text-lg font-semibold">
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
