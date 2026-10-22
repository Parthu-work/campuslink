import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { CheckCircle2, Pause, Play, RefreshCw, Rss, Trash2, TriangleAlert } from 'lucide-react';
import { FETCH_INTERVALS, type SourceView, type Topic } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input, Select } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { TopicPicker } from '../feed/composer-form';

interface Starter {
  key: string;
  name: string;
  publisher: string;
  url: string;
  topics: Topic[];
  verifiedAt: string | null;
  added: boolean;
}
type TestResult =
  | { ok: true; title: string; format: string; items: { title: string; url: string }[] }
  | { ok: false; error: string };

const HEALTH_TONE = { ok: 'success', new: 'neutral', failing: 'warning', blocked: 'danger' } as const;
const fail = (t: (k: string) => string) => (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'));

function AddSource({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [intervalMin, setIntervalMin] = useState(180);
  const [result, setResult] = useState<TestResult | null>(null);
  const test = useMutation({
    mutationFn: () => api.post<TestResult>('/admin/sources/test', { url: url.trim() }),
    onSuccess: (r) => {
      setResult(r);
      if (r.ok && !name) setName(r.title.slice(0, 80));
    },
    onError: fail(t),
  });
  const add = useMutation({
    mutationFn: () => api.post('/admin/sources', { name: name.trim(), url: url.trim(), topics, intervalMin }),
    onSuccess: () => {
      toast.success(t('sources.added'));
      void qc.invalidateQueries({ queryKey: ['admin-sources'] });
      onDone();
    },
    onError: fail(t),
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <Field label={t('sources.url')} hint={t('sources.urlHint')}>
        {({ id, describedBy }) => (
          <div className="flex gap-2">
            <Input
              id={id}
              aria-describedby={describedBy}
              type="url"
              placeholder="https://"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setResult(null);
              }}
            />
            <Button
              loading={test.isPending}
              disabled={!/^https:\/\/.+/.test(url.trim())}
              onClick={() => test.mutate()}
            >
              {t('sources.test')}
            </Button>
          </div>
        )}
      </Field>
      {result && (
        <div role="status" className="rounded-[var(--radius-sm)] border border-line p-3 text-sm">
          {result.ok ? (
            <>
              <p className="flex items-center gap-1.5 font-semibold text-success">
                <CheckCircle2 className="size-4" aria-hidden />{' '}
                {t('sources.testOk', { title: result.title, format: result.format.toUpperCase() })}
              </p>
              <ul className="mt-2 grid gap-1 text-fg-2">
                {result.items.map((i) => (
                  <li key={i.url} className="truncate">
                    {i.title}
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
      <Field label={t('sources.name')}>
        {({ id }) => <Input id={id} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <TopicPicker value={topics} onChange={setTopics} max={5} />
      <Field label={t('sources.interval')} hint={t('sources.intervalHint')}>
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={intervalMin}
            onChange={(e) => setIntervalMin(Number(e.target.value))}
          >
            {FETCH_INTERVALS.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? t('sources.minutes', { count: m }) : t('sources.hours', { count: m / 60 })}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!result?.ok || name.trim().length < 2}
          loading={add.isPending}
        >
          {t('sources.add')}
        </Button>
      </div>
    </form>
  );
}

function SourceRow({ s }: { s: SourceView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-sources'] });
  const [confirm, setConfirm] = useState(false);
  const toggle = useMutation({
    mutationFn: () =>
      api.patch(`/admin/sources/${s.id}`, { status: s.status === 'active' ? 'paused' : 'active' }),
    onSuccess: refresh,
    onError: fail(t),
  });
  const fetchNow = useMutation({
    mutationFn: () => api.post(`/admin/sources/${s.id}/fetch`, {}),
    onSuccess: () => {
      toast.success(t('sources.queued'));
      setTimeout(refresh, 3000);
    },
    onError: fail(t),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/sources/${s.id}`),
    onSuccess: refresh,
    onError: fail(t),
  });
  const h = s.health;
  return (
    <li>
      <Card className="grid gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <b className="min-w-0 flex-1 truncate">{s.name}</b>
          <Badge tone={s.status === 'paused' ? 'neutral' : HEALTH_TONE[h.state]}>
            {s.status === 'paused' ? t('sources.paused') : t(`sources.health.${h.state}`)}
          </Badge>
        </div>
        <p className="truncate font-mono text-xs text-fg-3">{s.url}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-fg-3">{t('sources.items7d')}</dt>
            <dd className="font-mono">{h.itemsLast7d}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-3">{t('sources.held7d')}</dt>
            <dd className="font-mono">{h.heldLast7d}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-3">{t('sources.followers')}</dt>
            <dd className="font-mono">{s.followers}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-3">{t('sources.lastFetch')}</dt>
            <dd>{h.lastFetchedAt ? formatRelative(h.lastFetchedAt) : t('sources.never')}</dd>
          </div>
        </dl>
        {h.lastError && (
          <p className="text-sm text-danger">
            {t('sources.lastError', { error: h.lastError, count: h.consecutiveFailures })}
          </p>
        )}
        {h.nextFetchAt && (
          <p className="text-xs text-fg-3">{t('sources.next', { when: formatRelative(h.nextFetchAt) })}</p>
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
        description={t('sources.removeBody')}
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

/** Content sources: health per source, tested additions and the verified starter list. */
export function SourcesAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const list = useQuery({
    queryKey: ['admin-sources'],
    queryFn: () => api.get<SourceView[]>('/admin/sources'),
  });
  const starters = useQuery({
    queryKey: ['admin-sources', 'starter'],
    queryFn: () => api.get<Starter[]>('/admin/sources/starter'),
  });
  const addStarter = useMutation({
    mutationFn: (key: string) => api.post(`/admin/sources/starter/${key}`, {}),
    onSuccess: () => {
      toast.success(t('sources.added'));
      void qc.invalidateQueries({ queryKey: ['admin-sources'] });
    },
    onError: fail(t),
  });
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[60ch] text-fg-2">{t('sources.intro')}</p>
        <Button variant="primary" onClick={() => setAdding(true)}>
          {t('sources.addTitle')}
        </Button>
      </div>
      {list.isLoading && <Skeleton className="h-32" />}
      {list.data && !list.data.length && (
        <EmptyState icon={<Rss className="size-6" />} title={t('sources.empty')}>
          {t('sources.emptyBody')}
        </EmptyState>
      )}
      <ul className="grid gap-3">
        {list.data?.map((s) => (
          <SourceRow key={s.id} s={s} />
        ))}
      </ul>
      <section aria-labelledby="starter" className="grid gap-3">
        <h2 id="starter" className="text-lg font-semibold">
          {t('sources.starter')}
        </h2>
        <p className="text-sm text-fg-2">{t('sources.starterIntro')}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {starters.data?.map((s) => (
            <li key={s.key}>
              <Card className="grid h-full gap-1.5 p-3">
                <b className="text-sm">{s.name}</b>
                <p className="text-xs text-fg-3">
                  {s.publisher} · {new URL(s.url).hostname}
                </p>
                <p className="text-xs">
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
                  <span className="sr-only"> {s.name}</span>
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      </section>
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title={t('sources.addTitle')}
        description={t('sources.addBody')}
      >
        {adding && <AddSource onDone={() => setAdding(false)} />}
      </Dialog>
    </div>
  );
}
