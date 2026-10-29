import { Link } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { BellRing, Trash2 } from 'lucide-react';
import { TRACK_STATUSES, type JobAlertView, type TrackStatus, type TrackedJobView } from '@campuslink/shared';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Illustration } from '../../components/ui/illustration';
import { CompanyMark } from './job-card';
import { PageHeader } from '../../components/ui/page-header';
import { api, ApiError } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { useTrack } from '../../lib/jobs';
import { SCREEN } from '../../lib/query-client';

/** One application on the board; the status select moves it between columns (keyboard friendly). */
function TrackedRow({ row }: { row: TrackedJobView }) {
  const { t } = useTranslation();
  const track = useTrack({ id: row.jobId });
  return (
    <li>
      <Card variant="raised" className="grid gap-2.5 p-3.5">
        <div className="flex items-start gap-3">
          <CompanyMark name={row.company} />
          <div className="min-w-0 flex-1">
            <h3 className="text-body leading-snug font-semibold">
              {row.job ? (
                <Link to={`/jobs/${row.jobId}`} className="hover:underline">
                  {row.title}
                </Link>
              ) : (
                row.title
              )}
            </h3>
            <p className="truncate text-meta text-fg-2">{row.company}</p>
          </div>
        </div>
        {(!row.job || row.job.status !== 'open') && (
          <Badge tone="warning" className="justify-self-start">
            {row.job ? t(`jobs.statusLabel.${row.job.status}`) : t('jobs.listingGone')}
          </Badge>
        )}
        {row.note && <p className="text-meta text-fg-2">“{row.note}”</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-fg-3">
            {t('jobs.updated', { when: formatRelative(row.updatedAt) })}
          </span>
          <label>
            <span className="sr-only">{t('jobs.statusFor', { title: row.title })}</span>
            <Select
              value={row.status}
              onChange={(e) => track.mutate({ status: e.target.value as TrackStatus })}
              size="sm"
              disabled={!row.job}
            >
              {TRACK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`jobs.track.${s}`)}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>
    </li>
  );
}

function Alerts() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['job-alerts'], queryFn: () => api.get<JobAlertView[]>('/me/job-alerts') });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/me/job-alerts/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['job-alerts'] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Card className="grid gap-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <BellRing className="size-5 text-accent-ink" aria-hidden /> {t('jobs.alerts')}
      </h2>
      <p className="text-meta text-fg-2">{t('jobs.alertsIntro')}</p>
      {q.data && !q.data.length && <p className="text-meta text-fg-3">{t('jobs.noAlerts')}</p>}
      <ul className="grid gap-2">
        {q.data?.map((a) => (
          <li key={a.id} className="flex items-center gap-2">
            <Link
              to={`/jobs?alert=${a.id}`}
              className="min-w-0 flex-1 truncate text-meta font-semibold hover:underline"
            >
              {a.name}
            </Link>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('jobs.deleteAlert', { name: a.name })}
              onClick={() => del.mutate(a.id)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function TrackerPage() {
  const { t } = useTranslation();
  const q = useQuery({
    ...SCREEN,
    queryKey: ['job-tracker'],
    queryFn: () => api.get<TrackedJobView[]>('/me/job-tracker'),
  });
  const rows = q.data ?? [];
  // The four active stages are always columns; closed ones appear only when they hold something.
  const columns = TRACK_STATUSES.filter(
    (s) => ['saved', 'applied', 'interviewing', 'offer'].includes(s) || rows.some((r) => r.status === s),
  );
  return (
    <div className="grid gap-5">
      <BackLink to="/jobs">{t('jobs.back')}</BackLink>
      <PageHeader title={t('jobs.tracker')} intro={t('jobs.trackerIntro')} />
      {q.isLoading && <Skeleton className="h-64 rounded-[var(--radius-xl)]" />}
      {q.isSuccess && !rows.length && (
        <EmptyState art={<Illustration kind="empty" />} title={t('jobs.trackerEmpty')}>
          {t('jobs.trackerEmptyBody')}
        </EmptyState>
      )}
      {rows.length > 0 && (
        // A kanban (§8.7): columns scroll sideways on phones, sit side by side on wide screens.
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto overscroll-x-contain px-4 pb-2 lg:mx-0 lg:grid lg:auto-cols-fr lg:grid-flow-col lg:overflow-visible lg:px-0">
          {columns.map((status) => {
            const list = rows.filter((r) => r.status === status);
            return (
              <section
                key={status}
                aria-labelledby={`tr-${status}`}
                className="grid w-[min(300px,82vw)] flex-none snap-start content-start gap-2 rounded-[var(--radius-xl)] bg-surface-2 p-3 lg:w-auto"
              >
                <h2
                  id={`tr-${status}`}
                  className="flex items-center justify-between px-1 text-meta font-semibold"
                >
                  {t(`jobs.track.${status}`)}
                  <span className="rounded-full bg-surface-1 px-2 text-caption text-fg-2 tabular-nums">
                    {list.length}
                  </span>
                </h2>
                {list.length ? (
                  <ul className="grid gap-2">
                    {list.map((r) => (
                      <TrackedRow key={r.jobId} row={r} />
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-[var(--radius-md)] border border-dashed border-line-strong px-3 py-6 text-center text-caption text-fg-3">
                    {t('jobs.columnEmpty')}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
      <div className="max-w-xl">
        <Alerts />
      </div>
    </div>
  );
}
