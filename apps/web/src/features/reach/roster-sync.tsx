import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { ImportSourceBody, RosterSyncFrequency, RosterSyncView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Field, Select } from '../../components/ui/field';
import { Badge, Card } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { formatDay, formatRelative } from '../../lib/format';
import { toast } from '../../lib/toast';

const KEY = ['roster-sync'];
const DAYS = [1, 2, 3, 4, 5, 6, 0];

function useSync() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api.get<RosterSyncView>('/admin/roster-sync', signal),
  });
}

function Schedule({
  frequency,
  weekday,
  onFrequency,
  onWeekday,
}: {
  frequency: RosterSyncFrequency;
  weekday: number;
  onFrequency: (f: RosterSyncFrequency) => void;
  onWeekday: (d: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <ChoiceGroup<RosterSyncFrequency>
        label={t('reach.sync.frequency')}
        variant="chip"
        value={frequency}
        onChange={onFrequency}
        options={[
          { value: 'daily', label: t('reach.sync.daily') },
          { value: 'weekly', label: t('reach.sync.weekly') },
        ]}
      />
      {frequency === 'weekly' && (
        <Field label={t('reach.sync.weekday')}>
          {({ id }) => (
            <Select
              id={id}
              size="sm"
              value={String(weekday)}
              onChange={(e) => onWeekday(Number(e.target.value))}
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {t(`reach.sync.days.${d}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </div>
  );
}

/** After a completed import from a Google Sheet or REST source: repeat it on a schedule (G9). */
export function SyncOffer({ source, jobId }: { source: ImportSourceBody; jobId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [frequency, setFrequency] = useState<RosterSyncFrequency>('daily');
  const [weekday, setWeekday] = useState(1);
  const save = useMutation({
    mutationFn: () =>
      api.put<RosterSyncView>('/admin/roster-sync', { source, fromJobId: jobId, frequency, weekday }),
    onSuccess: (v) => {
      qc.setQueryData(KEY, v);
      toast.success(t('reach.sync.started'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  if (save.isSuccess) return null;
  return (
    <Card variant="raised" className="grid gap-3 p-5" role="region" aria-labelledby="sync-offer-title">
      <h2 id="sync-offer-title" className="flex items-center gap-2 text-title font-semibold">
        <RefreshCw className="size-5 text-brand-ink" aria-hidden /> {t('reach.sync.offerTitle')}
      </h2>
      <p className="text-meta text-fg-2">{t('reach.sync.offerBody')}</p>
      <Schedule frequency={frequency} weekday={weekday} onFrequency={setFrequency} onWeekday={setWeekday} />
      <div>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          {t('reach.sync.start')}
        </Button>
      </div>
    </Card>
  );
}

/** Admin › Imports: the schedule, the last run, and a large change waiting for approval (G9). */
export function RosterSyncCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const v = useSync();
  const done = (message: string) => (d: RosterSyncView) => {
    qc.setQueryData(KEY, d);
    void qc.invalidateQueries({ queryKey: ['imports'] });
    toast.success(message);
  };
  const failed = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const patch = useMutation({
    mutationFn: (body: Partial<Pick<RosterSyncView, 'enabled' | 'frequency' | 'weekday'>>) =>
      api.patch<RosterSyncView>('/admin/roster-sync', body),
    onSuccess: (d) => qc.setQueryData(KEY, d),
    onError: failed,
  });
  const run = useMutation({
    mutationFn: () => api.post('/admin/roster-sync/run', {}),
    onSuccess: () => toast.success(t('reach.sync.queued')),
    onError: failed,
  });
  const approve = useMutation({
    mutationFn: () => api.post<RosterSyncView>('/admin/roster-sync/approve', {}),
    onSuccess: done(t('reach.sync.approved')),
    onError: failed,
  });
  const reject = useMutation({
    mutationFn: () => api.post<RosterSyncView>('/admin/roster-sync/reject', {}),
    onSuccess: done(t('reach.sync.rejected')),
    onError: failed,
  });
  const stop = useMutation({
    mutationFn: () => api.delete<RosterSyncView>('/admin/roster-sync'),
    onSuccess: done(t('reach.sync.stopped')),
    onError: failed,
  });
  const s = v.data;
  if (!s?.configured) return null;
  const p = s.pending;
  return (
    <Card className="grid gap-4 p-5" role="region" aria-labelledby="roster-sync-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="roster-sync-title" className="flex items-center gap-2 text-title font-semibold">
          <RefreshCw className="size-5 text-brand-ink" aria-hidden /> {t('reach.sync.title')}
        </h2>
        {!s.enabled && <Badge tone="warning">{t('reach.sync.paused')}</Badge>}
      </div>
      <p className="text-meta text-fg-2">{t('reach.sync.intro')}</p>
      <p className="text-meta">{t('reach.sync.source', { source: s.source?.label ?? '' })}</p>
      <p className="text-meta">
        {s.lastRunAt && s.lastStatus
          ? t('reach.sync.last', {
              when: formatRelative(s.lastRunAt),
              status: t(`reach.sync.status.${s.lastStatus}`),
            })
          : t('reach.sync.never')}
      </p>
      {s.lastStatus === 'failed' && s.lastError && (
        <p className="text-meta text-danger-ink">{t('reach.sync.error', { error: s.lastError })}</p>
      )}
      {p && (
        <section
          aria-labelledby="sync-pending-title"
          className="grid gap-3 rounded-[var(--radius-md)] border border-warning bg-warning-surface p-4"
        >
          <h3 id="sync-pending-title" className="font-semibold">
            {t('reach.sync.pendingTitle')}
          </h3>
          <p className="text-meta">
            {t('reach.sync.pendingBody', {
              changed: p.created + p.updated,
              total: p.total,
              pct: Math.round(p.changedShare * 1000) / 10,
            })}
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
            <li>{t('reach.sync.created', { n: p.created })}</li>
            <li>{t('reach.sync.updated', { n: p.updated })}</li>
            <li>{t('reach.sync.unchanged', { n: p.unchanged })}</li>
            {p.skippedClaimed > 0 && <li>{t('reach.sync.skippedClaimed', { n: p.skippedClaimed })}</li>}
            {p.errors > 0 && <li>{t('reach.sync.errors', { n: p.errors })}</li>}
          </ul>
          {p.sample.length > 0 && (
            <details>
              <summary className="min-h-11 cursor-pointer content-center text-meta font-semibold">
                {t('reach.sync.sample')}
              </summary>
              <ul className="grid gap-1 font-mono text-caption">
                {p.sample.map((r) => (
                  <li key={r.rollNumber}>
                    {r.rollNumber}:{' '}
                    {r.change === 'new'
                      ? t('reach.sync.isNew')
                      : r.fields.map((f) => t(`reach.sync.fields.${f}`)).join(', ')}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-caption text-fg-3">
            {t('reach.sync.waitsUntil', { date: formatDay(p.expiresAt) })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={approve.isPending} onClick={() => approve.mutate()}>
              {t('reach.sync.approve')}
            </Button>
            <Button variant="ghost" loading={reject.isPending} onClick={() => reject.mutate()}>
              {t('reach.sync.reject')}
            </Button>
          </div>
        </section>
      )}
      <Schedule
        frequency={s.frequency}
        weekday={s.weekday}
        onFrequency={(frequency) => patch.mutate({ frequency })}
        onWeekday={(weekday) => patch.mutate({ weekday })}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={run.isPending} disabled={!s.enabled} onClick={() => run.mutate()}>
          {t('reach.sync.runNow')}
        </Button>
        <Button size="sm" loading={patch.isPending} onClick={() => patch.mutate({ enabled: !s.enabled })}>
          {s.enabled ? t('reach.sync.pause') : t('reach.sync.resume')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-danger-ink"
          loading={stop.isPending}
          onClick={() => stop.mutate()}
        >
          {t('reach.sync.stop')}
        </Button>
      </div>
    </Card>
  );
}
