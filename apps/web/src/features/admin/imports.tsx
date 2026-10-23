import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { CheckCircle2, Download, FileSpreadsheet, Link2, Server, Undo2, Upload } from 'lucide-react';
import {
  IMPORT_FIELDS,
  REQUIRED_IMPORT_FIELDS,
  type ImportField,
  type ImportMapping,
  type ImportPreview,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Checkbox, Field, Input, Select } from '../../components/ui/field';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { ProgressBar } from '../../components/ui/progress';
import { Dialog } from '../../components/ui/dialog';
import { FormError } from '../../components/layout/auth-layout';
import { api, apiBlob, ApiError, saveBlob } from '../../lib/api';
import { cn } from '../../lib/cn';

interface Job {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'rolled_back';
  dryRun: boolean;
  progress: number;
  sourceKind: string;
  sourceLabel: string;
  counts: {
    total: number;
    created: number;
    updated: number;
    unchanged: number;
    skippedClaimed: number;
    errors: number;
  };
  rowErrors?: { row: number; field: string; message: string }[];
  createdAt: string;
  rollback?: { removed?: number; restored?: number; keptClaimed?: number } | null;
}
type Source = 'file' | 'gsheet' | 'rest';

export function ImportsAdmin() {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  return (
    <div className="grid gap-5">
      {jobId ? (
        <JobView id={jobId} onNew={() => (setJobId(null), setPreview(null))} />
      ) : preview ? (
        <MappingStep preview={preview} onBack={() => setPreview(null)} onStarted={setJobId} />
      ) : (
        <SourceStep onPreview={setPreview} />
      )}
      <History onOpen={setJobId} current={jobId} />
      <p className="sr-only" aria-live="polite">
        {jobId ? t('admin.running') : ''}
      </p>
    </div>
  );
}

function SourceStep({ onPreview }: { onPreview: (p: ImportPreview) => void }) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Source>('file');
  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const run = async (fn: () => Promise<ImportPreview>) => {
    setBusy(true);
    setError(undefined);
    try {
      onPreview(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };
  const uploadFile = (file: File) => {
    const fd = new FormData();
    fd.set('file', file);
    void run(() => api.upload<ImportPreview>('/admin/imports/preview/upload', fd));
  };
  const tabs: [Source, string, typeof Upload][] = [
    ['file', t('admin.upload'), Upload],
    ['gsheet', t('admin.gsheet'), Link2],
    ['rest', t('admin.rest'), Server],
  ];
  return (
    <Card className="grid gap-4 p-5">
      <h2 className="text-title font-semibold">{t('admin.source')}</h2>
      <div role="group" aria-label={t('admin.source')} className="flex flex-wrap gap-2">
        {tabs.map(([k, label, Icon]) => (
          <Chip key={k} pressed={source === k} onClick={() => setSource(k)}>
            <Icon className="size-4" aria-hidden /> {label}
          </Chip>
        ))}
      </div>
      <FormError message={error} />
      {source === 'file' && (
        <div
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) uploadFile(f);
          }}
          className={cn(
            'grid justify-items-center gap-3 rounded-[var(--radius-md)] border-2 border-dashed border-line-strong px-4 py-10 text-center',
            drag && 'border-brand bg-surface-2',
          )}
        >
          <FileSpreadsheet className="size-8 text-brand-ink" aria-hidden />
          <p className="text-fg-2">{t('admin.dropHere')}</p>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
            aria-label={t('admin.chooseFile')}
          />
          <Button variant="primary" loading={busy} onClick={() => fileInput.current?.click()}>
            {t('admin.chooseFile')}
          </Button>
        </div>
      )}
      {source === 'gsheet' && (
        <form
          className="grid max-w-xl gap-3"
          onSubmit={(e) => (
            e.preventDefault(),
            void run(() => api.post<ImportPreview>('/admin/imports/preview/remote', { kind: 'gsheet', url }))
          )}
        >
          <Field label={t('admin.gsheetUrl')} hint={t('admin.gsheetHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                required
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={busy} className="justify-self-start">
            {t('admin.fetch')}
          </Button>
        </form>
      )}
      {source === 'rest' && (
        <form
          className="grid max-w-xl gap-3"
          onSubmit={(e) => (
            e.preventDefault(),
            void run(() =>
              api.post<ImportPreview>('/admin/imports/preview/remote', {
                kind: 'rest',
                url,
                ...(path ? { recordsPath: path } : {}),
                ...(token ? { bearerToken: token } : {}),
              }),
            )
          )}
        >
          <Field label={t('admin.restUrl')}>
            {({ id }) => (
              <Input id={id} type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
            )}
          </Field>
          <Field label={t('admin.recordsPath')}>
            {({ id }) => (
              <Input id={id} value={path} onChange={(e) => setPath(e.target.value)} className="font-mono" />
            )}
          </Field>
          <Field label={t('admin.token')}>
            {({ id }) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={busy} className="justify-self-start">
            {t('admin.fetch')}
          </Button>
        </form>
      )}
    </Card>
  );
}

function MappingStep({
  preview,
  onBack,
  onStarted,
}: {
  preview: ImportPreview;
  onBack: () => void;
  onStarted: (id: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [columns, setColumns] = useState<ImportMapping['columns']>(preview.suggestedMapping);
  const [defaultKind, setDefaultKind] = useState<ImportMapping['defaultKind']>('derive');
  const [dryRun, setDryRun] = useState(true);
  const [error, setError] = useState<string>();
  const start = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/admin/imports', {
        previewId: preview.previewId,
        mapping: { columns, defaultKind },
        dryRun,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['imports'] });
      onStarted(r.id);
    },
    onError: (e: Error) => setError(e.message),
  });
  const missing = REQUIRED_IMPORT_FIELDS.filter((f) => !columns[f]);
  const mapped = IMPORT_FIELDS.filter((f) => columns[f]);
  return (
    <Card className="grid gap-5 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-title font-semibold">{t('admin.mapTitle')}</h2>
        <Badge>{t('admin.rows', { count: preview.totalRows })}</Badge>
      </div>
      <p className="text-meta text-fg-2">{t('admin.mapIntro')}</p>
      <FormError message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        {IMPORT_FIELDS.map((f: ImportField) => (
          <Field key={f} label={`${t(`admin.field.${f}`)}${REQUIRED_IMPORT_FIELDS.includes(f) ? ' *' : ''}`}>
            {({ id }) => (
              <Select
                id={id}
                value={columns[f] ?? ''}
                onChange={(e) => setColumns({ ...columns, [f]: e.target.value || undefined })}
                aria-invalid={REQUIRED_IMPORT_FIELDS.includes(f) && !columns[f]}
              >
                <option value="">{t('admin.notMapped')}</option>
                {preview.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ))}
        {!columns.kind && (
          <Field label={t('admin.kindLabel')}>
            {({ id }) => (
              <Select
                id={id}
                value={defaultKind}
                onChange={(e) => setDefaultKind(e.target.value as ImportMapping['defaultKind'])}
              >
                {(['derive', 'student', 'alumni'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`admin.kind.${k}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
      <section className="grid gap-2">
        <h3 className="eyebrow">{t('admin.previewRows')}</h3>
        <div
          className="overflow-x-auto rounded-[var(--radius-md)] border border-line"
          tabIndex={0}
          role="region"
          aria-label={t('admin.previewRows')}
        >
          <table className="w-full min-w-[560px] text-left text-meta">
            <thead className="border-b border-line bg-surface-2 text-caption text-fg-2">
              <tr>
                {mapped.map((f) => (
                  <th key={f} scope="col" className="px-3 py-2 font-medium">
                    {t(`admin.field.${f}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {mapped.map((f) => (
                    <td key={f} className="max-w-[220px] truncate px-3 py-2 font-mono text-caption">
                      {r[columns[f] ?? ''] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Checkbox id="dry-run" checked={dryRun} onChange={setDryRun}>
        {t('admin.dryRun')}
      </Checkbox>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          loading={start.isPending}
          disabled={missing.length > 0}
          onClick={() => start.mutate()}
        >
          {dryRun ? t('admin.startDry') : t('admin.start')}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          {t('common.back')}
        </Button>
      </div>
    </Card>
  );
}

function JobView({ id, onNew }: { id: string; onNew: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const job = useQuery({
    queryKey: ['import', id],
    queryFn: () => api.get<Job>(`/admin/imports/${id}`),
    refetchInterval: (q) =>
      q.state.data && ['completed', 'failed', 'rolled_back'].includes(q.state.data.status) ? false : 1000,
  });
  const done = job.data && ['completed', 'failed', 'rolled_back'].includes(job.data.status);
  useEffect(() => {
    if (done) void qc.invalidateQueries({ queryKey: ['imports'] });
  }, [done, qc]);
  const rollback = useMutation({
    mutationFn: () =>
      api.post<{ removed: number; restored: number; keptClaimed: number }>(`/admin/imports/${id}/rollback`),
    onSuccess: (r) => {
      setConfirm(false);
      toast.success(t('admin.rolledBackSummary', r));
      void qc.invalidateQueries({ queryKey: ['import', id] });
      void qc.invalidateQueries({ queryKey: ['imports'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!job.data) return <Skeleton className="h-48" />;
  const j = job.data;
  const title =
    j.status === 'completed'
      ? j.dryRun
        ? t('admin.dryDone')
        : t('admin.completed')
      : j.status === 'failed'
        ? t('admin.failed')
        : j.status === 'rolled_back'
          ? t('admin.rolledBack')
          : t('admin.running');
  const tiles: [string, number, ('success' | 'danger' | undefined)?][] = [
    [t('admin.created'), j.counts.created, 'success'],
    [t('admin.updated'), j.counts.updated],
    [t('admin.unchanged'), j.counts.unchanged],
    [t('admin.skippedClaimed'), j.counts.skippedClaimed],
    [t('admin.errorsCount'), j.counts.errors, j.counts.errors ? 'danger' : undefined],
  ];
  return (
    <Card className="grid gap-5 p-5">
      <div className="flex flex-wrap items-center gap-3">
        {done && j.status === 'completed' && <CheckCircle2 className="size-6 text-success" aria-hidden />}
        <h2 className="text-title font-semibold" role="status">
          {title}
        </h2>
        <Badge className="ml-auto">{j.sourceLabel}</Badge>
      </div>
      {!done && (
        <ProgressBar
          value={Math.max(3, j.progress)}
          max={100}
          label={t('admin.running')}
          valueText={`${j.progress}%`}
        />
      )}
      <StatGrid className="sm:grid-cols-5 md:grid-cols-5">
        {tiles.map(([label, n, tone]) => (
          <StatCard key={label} size="sm" label={label} value={n} tone={tone ?? 'default'} />
        ))}
      </StatGrid>
      {j.rowErrors && j.rowErrors.length > 0 && (
        <div
          className="overflow-x-auto rounded-[var(--radius-md)] border border-line"
          tabIndex={0}
          role="region"
          aria-label={t('admin.errorsCount')}
        >
          <table className="w-full min-w-[420px] text-left text-meta">
            <thead className="border-b border-line bg-surface-2 text-caption text-fg-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('admin.row')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('admin.column')}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t('admin.problem')}
                </th>
              </tr>
            </thead>
            <tbody>
              {j.rowErrors.slice(0, 20).map((e, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-mono text-caption tabular">{e.row}</td>
                  <td className="px-3 py-2 text-caption">
                    {IMPORT_FIELDS.includes(e.field as ImportField) ? t(`admin.field.${e.field}`) : e.field}
                  </td>
                  <td className="px-3 py-2 text-caption">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {j.counts.errors > 0 && done && (
          <Button
            onClick={async () =>
              saveBlob(
                await apiBlob(`/admin/imports/${id}/errors.csv`),
                `import-problems-${id.slice(-6)}.csv`,
              )
            }
          >
            <Download className="size-4" aria-hidden /> {t('admin.downloadErrors')}
          </Button>
        )}
        {j.status === 'completed' && !j.dryRun && (
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            <Undo2 className="size-4" aria-hidden /> {t('admin.rollback')}
          </Button>
        )}
        {done && (
          <Button variant="primary" onClick={onNew}>
            {t('admin.newImport')}
          </Button>
        )}
      </div>
      {confirm && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirm(false)}
          title={t('admin.rollback')}
          description={t('admin.rollbackConfirm')}
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={rollback.isPending} onClick={() => rollback.mutate()}>
              {t('admin.rollback')}
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  );
}

function History({ onOpen, current }: { onOpen: (id: string) => void; current: string | null }) {
  const { t, i18n } = useTranslation();
  const jobs = useQuery({ queryKey: ['imports'], queryFn: () => api.get<Job[]>('/admin/imports') });
  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} compact />;
  if (!jobs.data?.length)
    return jobs.isLoading ? (
      <Skeleton className="h-24" />
    ) : (
      <EmptyState art={<Illustration kind="empty" />} title={t('admin.noImports')} />
    );
  return (
    <section className="grid gap-2">
      <h2 className="eyebrow">{t('admin.history')}</h2>
      <ul className="grid gap-2">
        {jobs.data.map((j) => (
          <li key={j.id}>
            <button
              type="button"
              onClick={() => onOpen(j.id)}
              aria-current={current === j.id}
              className="flex w-full flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-line bg-surface-1 p-3 text-left text-meta hover:border-line-strong aria-[current=true]:border-brand"
            >
              <b className="min-w-0 flex-1 truncate">{j.sourceLabel}</b>
              {j.dryRun && <Badge>dry run</Badge>}
              <Badge
                tone={j.status === 'completed' ? 'success' : j.status === 'failed' ? 'danger' : 'neutral'}
              >
                {j.status.replace('_', ' ')}
              </Badge>
              <span className="font-mono text-caption text-fg-3 tabular">
                +{j.counts.created} · ~{j.counts.updated} · !{j.counts.errors}
              </span>
              <span className="font-mono text-caption text-fg-3">
                {new Date(j.createdAt).toLocaleString(i18n.language)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
