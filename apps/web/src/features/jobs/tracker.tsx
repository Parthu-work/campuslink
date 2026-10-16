import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, BellRing, ListChecks, Trash2 } from 'lucide-react';
import { TRACK_STATUSES, type JobAlertView, type TrackStatus, type TrackedJobView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { useTrack } from '../../lib/jobs';

function TrackedRow({ row }: { row: TrackedJobView }) {
  const { t } = useTranslation();
  const track = useTrack({ id: row.jobId });
  return (
    <li>
      <Card className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center">
        <div className="min-w-0">
          <h3 className="font-semibold">
            {row.job ? (
              <Link to={`/jobs/${row.jobId}`} className="hover:underline">
                {row.title}
              </Link>
            ) : (
              row.title
            )}
          </h3>
          <p className="text-sm text-fg-2">
            {row.company} · {t('jobs.updated', { when: formatRelative(row.updatedAt) })}
          </p>
          {!row.job && <Badge tone="warning">{t('jobs.listingGone')}</Badge>}
          {row.job && row.job.status !== 'open' && (
            <Badge tone="warning">{t(`jobs.statusLabel.${row.job.status}`)}</Badge>
          )}
          {row.note && <p className="mt-1 text-sm text-fg-2">“{row.note}”</p>}
        </div>
        <label className="grid gap-1 text-xs font-semibold">
          <span className="sr-only">{t('jobs.statusFor', { title: row.title })}</span>
          <Select
            value={row.status}
            onChange={(e) => track.mutate({ status: e.target.value as TrackStatus })}
            className="min-h-10"
            disabled={!row.job}
          >
            {TRACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`jobs.track.${s}`)}
              </option>
            ))}
          </Select>
        </label>
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
      <p className="text-sm text-fg-2">{t('jobs.alertsIntro')}</p>
      {q.data && !q.data.length && <p className="text-sm text-fg-3">{t('jobs.noAlerts')}</p>}
      <ul className="grid gap-2">
        {q.data?.map((a) => (
          <li key={a.id} className="flex items-center gap-2">
            <Link
              to={`/jobs?alert=${a.id}`}
              className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline"
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
    queryKey: ['job-tracker'],
    queryFn: () => api.get<TrackedJobView[]>('/me/job-tracker'),
  });
  const groups = TRACK_STATUSES.map((s) => [s, (q.data ?? []).filter((r) => r.status === s)] as const).filter(
    ([, rows]) => rows.length,
  );
  return (
    <div className="mx-auto grid w-full max-w-[860px] gap-5">
      <Link
        to="/jobs"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-ink hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> {t('jobs.back')}
      </Link>
      <div>
        <h1 className="text-[clamp(26px,4vw,34px)] font-bold">{t('jobs.tracker')}</h1>
        <p className="text-fg-2">{t('jobs.trackerIntro')}</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid content-start gap-5">
          {q.isLoading && <Skeleton className="h-32" />}
          {q.isSuccess && !q.data.length && (
            <EmptyState icon={<ListChecks className="size-6" />} title={t('jobs.trackerEmpty')}>
              {t('jobs.trackerEmptyBody')}
            </EmptyState>
          )}
          {groups.map(([status, rows]) => (
            <section key={status} aria-labelledby={`tr-${status}`} className="grid gap-2">
              <h2 id={`tr-${status}`} className="font-semibold">
                {t(`jobs.track.${status}`)} <span className="font-mono text-sm text-fg-3">{rows.length}</span>
              </h2>
              <ul className="grid gap-2">
                {rows.map((r) => (
                  <TrackedRow key={r.jobId} row={r} />
                ))}
              </ul>
            </section>
          ))}
        </div>
        <Alerts />
      </div>
    </div>
  );
}
