import { useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { CheckCircle2, Pause, Play, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { JOB_SOURCE_KINDS, type JobSourceKind, type JobSourceView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Checkbox, Field, Input, Select } from '../../components/ui/field';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { formatRelative } from '../../lib/format';

interface Starter {
  key: string;
  kind: JobSourceKind;
  board: string;
  company: string;
  verifiedAt: string | null;
  added: boolean;
}
type TestResult =
  | { ok: true; total: number; kept: number; sample: { title: string; location: string }[] }
  | { ok: false; error: string };
const TONE = { ok: 'success', new: 'neutral', failing: 'warning', blocked: 'danger' } as const;

function AddJobSource({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [kind, setKind] = useState<JobSourceKind>('greenhouse');
  const [name, setName] = useState('');
  const [board, setBoard] = useState('');
  const [query, setQuery] = useState('');
  const [where, setWhere] = useState('');
  const [url, setUrl] = useState('');
  const [indiaOnly, setIndiaOnly] = useState(true);
  const [result, setResult] = useState<TestResult | null>(null);
  const body = () => ({
    kind,
    name: name.trim(),
    indiaOnly,
    ...(kind === 'adzuna'
      ? { query: query.trim(), ...(where.trim() ? { where: where.trim() } : {}) }
      : kind === 'rss'
        ? { url: url.trim() }
        : { board: board.trim() }),
  });
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const test = useMutation({
    mutationFn: () => api.post<TestResult>('/admin/job-sources/test', body()),
    onSuccess: setResult,
    onError: fail,
  });
  const add = useMutation({
    mutationFn: () => api.post('/admin/job-sources', body()),
    onSuccess: () => {
      toast.success(t('jobSources.added'));
      void qc.invalidateQueries({ queryKey: ['admin-job-sources'] });
      onDone();
    },
    onError: fail,
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <Field label={t('jobSources.kindLabel')} hint={t(`jobSources.kindHint.${kind}`)}>
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={kind}
            onChange={(e) => (setKind(e.target.value as JobSourceKind), setResult(null))}
          >
            {JOB_SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`jobSources.kind.${k}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {kind === 'adzuna' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('jobSources.query')}>
            {({ id }) => <Input id={id} value={query} onChange={(e) => setQuery(e.target.value)} />}
          </Field>
          <Field label={t('jobSources.where')}>
            {({ id }) => <Input id={id} value={where} onChange={(e) => setWhere(e.target.value)} />}
          </Field>
        </div>
      ) : kind === 'rss' ? (
        <Field label={t('jobSources.url')}>
          {({ id }) => (
            <Input
              id={id}
              type="url"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
        </Field>
      ) : (
        <Field label={t('jobSources.board')} hint={t('jobSources.boardHint')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={board}
              onChange={(e) => setBoard(e.target.value)}
            />
          )}
        </Field>
      )}
      <Field label={t('jobSources.name')} hint={t('jobSources.nameHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      {kind !== 'rss' && kind !== 'adzuna' && (
        <Checkbox id="india-only" checked={indiaOnly} onChange={setIndiaOnly}>
          {t('jobSources.indiaOnly')}
        </Checkbox>
      )}
      <div>
        <Button loading={test.isPending} disabled={name.trim().length < 2} onClick={() => test.mutate()}>
          {t('sources.test')}
        </Button>
      </div>
      {result && (
        <div role="status" className="rounded-[var(--radius-sm)] border border-line p-3 text-meta">
          {result.ok ? (
            <>
              <p className="flex items-center gap-1.5 font-semibold text-success">
                <CheckCircle2 className="size-4" aria-hidden />{' '}
                {t('jobSources.testOk', { total: result.total, kept: result.kept })}
              </p>
              <ul className="mt-2 grid gap-1 text-fg-2">
                {result.sample.map((j, i) => (
                  <li key={i} className="truncate">
                    {j.title} · {j.location}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="flex items-center gap-1.5 font-semibold text-danger">
              <TriangleAlert className="size-4" aria-hidden /> {result.error}
            </p>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={!result?.ok} loading={add.isPending}>
          {t('sources.add')}
        </Button>
      </div>
    </form>
  );
}

function SourceRow({ s }: { s: JobSourceView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-job-sources'] });
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const toggle = useMutation({
    mutationFn: () =>
      api.patch(`/admin/job-sources/${s.id}`, { status: s.status === 'active' ? 'paused' : 'active' }),
    onSuccess: refresh,
    onError: fail,
  });
  const fetchNow = useMutation({
    mutationFn: () => api.post(`/admin/job-sources/${s.id}/fetch`, {}),
    onSuccess: () => {
      toast.success(t('sources.queued'));
      setTimeout(refresh, 3000);
    },
    onError: fail,
  });
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/job-sources/${s.id}`),
    onSuccess: refresh,
    onError: fail,
  });
  const h = s.health;
  return (
    <li>
      <Card className="grid gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <b className="min-w-0 flex-1 truncate">{s.name}</b>
          <Badge>{t(`jobSources.kind.${s.kind}`)}</Badge>
          <Badge tone={s.status === 'paused' ? 'neutral' : TONE[h.state]}>
            {s.status === 'paused' ? t('sources.paused') : t(`sources.health.${h.state}`)}
          </Badge>
        </div>
        <p className="truncate font-mono text-caption text-fg-3">{s.target}</p>
        <p className="text-meta text-fg-2">
          {t('jobSources.openJobs', { count: h.openJobs })} ·{' '}
          {h.lastFetchedAt
            ? t('jobSources.fetched', { when: formatRelative(h.lastFetchedAt) })
            : t('sources.never')}
        </p>
        {h.lastError && (
          <p className="text-meta text-danger">
            {t('sources.lastError', { error: h.lastError, count: h.consecutiveFailures })}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            loading={fetchNow.isPending}
            disabled={s.status === 'paused'}
            onClick={() => fetchNow.mutate()}
          >
            <RefreshCw className="size-4" aria-hidden /> {t('sources.fetchNow')}
          </Button>
          <Button size="sm" loading={toggle.isPending} onClick={() => toggle.mutate()}>
            {s.status === 'active' ? (
              <Pause className="size-4" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            {s.status === 'active' ? t('sources.pause') : t('sources.resume')}
          </Button>
          <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>
            <Trash2 className="size-4" aria-hidden /> {t('admin.remove')}
          </Button>
        </div>
      </Card>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('sources.removeTitle', { name: s.name })}
        description={t('jobSources.removeBody')}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            {t('admin.remove')}
          </Button>
        </div>
      </Dialog>
    </li>
  );
}

/** Admin → Job sources: ATS boards, Adzuna searches and RSS notices, with health and a verified starter list. */
export function JobSourcesAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const list = useQuery({
    queryKey: ['admin-job-sources'],
    queryFn: () => api.get<JobSourceView[]>('/admin/job-sources'),
  });
  const starters = useQuery({
    queryKey: ['admin-job-sources', 'starter'],
    queryFn: () => api.get<Starter[]>('/admin/job-sources/starter'),
  });
  const addStarter = useMutation({
    mutationFn: (key: string) => api.post(`/admin/job-sources/starter/${key}`, {}),
    onSuccess: () => {
      toast.success(t('jobSources.added'));
      void qc.invalidateQueries({ queryKey: ['admin-job-sources'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-fg-2">{t('jobSources.intro')}</p>
        <Button variant="primary" onClick={() => setAdding(true)}>
          {t('jobSources.addTitle')}
        </Button>
      </div>
      {list.isLoading && <Skeleton className="h-32" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && !list.data.length && (
        <EmptyState art={<Illustration kind="empty" />} title={t('jobSources.empty')}>
          {t('jobSources.emptyBody')}
        </EmptyState>
      )}
      <ul className="grid gap-3">
        {list.data?.map((s) => (
          <SourceRow key={s.id} s={s} />
        ))}
      </ul>
      <section aria-labelledby="job-starter" className="grid gap-3">
        <h2 id="job-starter" className="text-title font-semibold">
          {t('jobSources.starter')}
        </h2>
        <p className="text-meta text-fg-2">{t('jobSources.starterIntro')}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {starters.data?.map((s) => (
            <li key={s.key}>
              <Card className="grid h-full gap-1.5 p-3">
                <b className="text-meta">{s.company}</b>
                <p className="text-caption text-fg-3">
                  {t(`jobSources.kind.${s.kind}`)} · {s.board}
                </p>
                <p className="text-caption">
                  {s.verifiedAt ? (
                    <Badge tone="success">{t('sources.verifiedOn', { date: s.verifiedAt })}</Badge>
                  ) : (
                    <Badge tone="warning">{t('sources.unverified')}</Badge>
                  )}
                </p>
                <Button
                  size="sm"
                  className="justify-self-start"
                  disabled={s.added || !s.verifiedAt}
                  loading={addStarter.isPending && addStarter.variables === s.key}
                  onClick={() => addStarter.mutate(s.key)}
                >
                  {s.added ? t('sources.alreadyAdded') : t('sources.add')}
                  <span className="sr-only"> {s.company}</span>
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      </section>
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title={t('jobSources.addTitle')}
        description={t('jobSources.addBody')}
      >
        {adding && <AddJobSource onDone={() => setAdding(false)} />}
      </Dialog>
    </div>
  );
}
