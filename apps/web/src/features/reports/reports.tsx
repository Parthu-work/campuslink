import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, FileSpreadsheet } from 'lucide-react';
import {
  BRANCHES,
  currentGradYear,
  gradYearLabel,
  type ReportCell,
  type ReportColumn,
  type ReportResultView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { ColumnChart } from '../../components/ui/column-chart';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Select } from '../../components/ui/field';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Table, THead, Td, Th } from '../../components/ui/table';
import { ApiError, apiBlob, saveBlob } from '../../lib/api';
import { useCan } from '../../lib/me';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

const NOW = currentGradYear();
const BATCHES = [NOW + 1, NOW, NOW - 1, NOW - 2, NOW - 3, NOW - 4];

/** Batch and programme, kept in the URL so a report link opens with the same choice. */
function useReportParams() {
  const [params, setParams] = useSearchParams();
  const gradYear = Number(params.get('gradYear')) || NOW;
  const branch = params.get('branch') ?? '';
  const qs = new URLSearchParams({ gradYear: String(gradYear), ...(branch ? { branch } : {}) }).toString();
  const set = (next: { gradYear?: number; branch?: string }) => {
    const g = next.gradYear ?? gradYear;
    const b = next.branch ?? branch;
    setParams({ gradYear: String(g), ...(b ? { branch: b } : {}) }, { replace: true });
  };
  return { gradYear, branch, qs, set };
}

function Filters({ p }: { p: ReturnType<typeof useReportParams> }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
      <Field label={t('reports.batch')}>
        {({ id }) => (
          <Select id={id} value={p.gradYear} onChange={(e) => p.set({ gradYear: Number(e.target.value) })}>
            {BATCHES.map((y) => (
              <option key={y} value={y}>
                {t('reports.batchLabel', { year: gradYearLabel(y) })}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('reports.programme')}>
        {({ id }) => (
          <Select id={id} value={p.branch} onChange={(e) => p.set({ branch: e.target.value })}>
            <option value="">{t('reports.allProgrammes')}</option>
            {BRANCHES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

const shownCount = (v: number | '<5') => (v === '<5' ? '<5' : String(v));

/**
 * Admin › Reports (B8): the principal's view of this batch (placement %, median band, recruiters
 * and the five-year trend), then every report the college can generate.
 */
export function ReportsDashboard() {
  const { t } = useTranslation();
  const p = useReportParams();
  const dash = useQuery({ ...SCREEN, ...q.reportsDashboard(p.qs), placeholderData: (prev) => prev });
  const defs = useQuery(q.reportDefinitions());
  const d = dash.data;
  return (
    <div className="grid gap-6">
      <p className="max-w-[70ch] text-fg-2">{t('reports.intro')}</p>
      <Filters p={p} />
      {dash.isLoading && <Skeleton className="h-40" />}
      {dash.isError && !d && <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />}
      {d && (
        <>
          <StatGrid>
            <StatCard
              label={t('reports.placementPct')}
              value={d.placementPct === null ? '—' : `${d.placementPct}%`}
              hint={t('reports.placementPctHint')}
            />
            <StatCard label={t('reports.placed')} value={shownCount(d.placed)} />
            <StatCard label={t('reports.seeking')} value={shownCount(d.seeking)} />
            <StatCard label={t('reports.finalYear')} value={shownCount(d.finalYear)} />
            <StatCard
              label={t('reports.medianBand')}
              value={d.medianBand ? t(`reports.band.${d.medianBand}`) : '—'}
            />
            <StatCard label={t('reports.higherStudies')} value={shownCount(d.higherStudies)} />
          </StatGrid>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card className="p-4">
              <ColumnChart
                title={t('reports.trend')}
                description={t('reports.trendHint')}
                labelHeader={t('reports.batch')}
                valueHeader={t('reports.placementPct')}
                format={(n) => `${n}%`}
                points={d.trend.map((x) => ({
                  key: String(x.gradYear),
                  label: gradYearLabel(x.gradYear),
                  value: x.placementPct ?? 0,
                  ...(x.placementPct === null ? { display: '—' } : {}),
                }))}
              />
            </Card>
            <Card className="grid content-start gap-3 p-4">
              <h2 className="font-semibold">{t('reports.topRecruiters')}</h2>
              {d.topRecruiters.length ? (
                <ol className="grid gap-2">
                  {d.topRecruiters.map((r, i) => (
                    <li key={r.company} className="flex items-center justify-between gap-3 text-meta">
                      <span className="min-w-0 truncate">
                        {i + 1}. {r.company}
                      </span>
                      <span className="text-fg-2 tabular-nums">
                        {t('reports.studentsN', { n: shownCount(r.students) })}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-meta text-fg-3">{t('reports.noRecruiters')}</p>
              )}
            </Card>
          </div>
        </>
      )}
      <section aria-labelledby="reports-list" className="grid gap-3">
        <h2 id="reports-list" className="text-title font-semibold">
          {t('reports.all')}
        </h2>
        {defs.isLoading && <Skeleton className="h-32" />}
        <ul className="grid gap-3 sm:grid-cols-2">
          {defs.data?.map((r) => (
            <li key={r.id}>
              <IntentLink to={`/admin/reports/${r.id}?${p.qs}`} className="block rounded-[var(--radius-lg)]">
                <Card variant="interactive" className="grid gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="brand">{t(`reports.framework.${r.framework}`)}</Badge>
                    {r.needsReview && <Badge tone="warning">{t('reports.needsReview')}</Badge>}
                    {r.threeYears && <Badge>{t('reports.threeYears')}</Badge>}
                  </div>
                  <h3 className="font-semibold">{r.title}</h3>
                  <p className="text-caption text-fg-3">{t('reports.version', { version: r.version })}</p>
                </Card>
              </IntentLink>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function cellText(
  t: (k: string, o?: Record<string, unknown>) => string,
  c: ReportColumn,
  v: ReportCell | undefined,
) {
  if (v === null || v === undefined || v === '') return '—';
  if (c.kind === 'band') return t(`reports.band.${String(v)}`);
  if (c.kind === 'percent' && typeof v === 'number') return `${v}%`;
  return String(v);
}

function ResultTable({ r }: { r: ReportResultView }) {
  const { t } = useTranslation();
  const numeric = (c: ReportColumn) => c.kind !== 'text' && c.kind !== 'band';
  return (
    <Table label={r.title}>
      <THead>
        <tr>
          {r.columns.map((c) => (
            <Th key={c.key} className={numeric(c) ? 'text-right' : undefined}>
              {c.label}
            </Th>
          ))}
        </tr>
      </THead>
      <tbody>
        {r.rows.map((row, i) => (
          <tr key={i}>
            {r.columns.map((c) => (
              <Td key={c.key} className={numeric(c) ? 'text-right tabular-nums' : undefined}>
                {cellText(t, c, row[c.key])}
              </Td>
            ))}
          </tr>
        ))}
        {r.totals && (
          <tr className="border-t-2 border-line-strong font-semibold">
            {r.columns.map((c) => (
              <Td key={c.key} className={numeric(c) ? 'text-right tabular-nums' : undefined}>
                {r.totals?.[c.key] === undefined ? '' : cellText(t, c, r.totals[c.key])}
              </Td>
            ))}
          </tr>
        )}
      </tbody>
    </Table>
  );
}

/** One report: the table (counts under 5 suppressed), its notes and source, and the downloads. */
export function ReportPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const p = useReportParams();
  const canExport = useCan('reports:export');
  const r = useQuery({ ...SCREEN, ...q.outcomeReport(id, p.qs), placeholderData: (prev) => prev });
  const [busy, setBusy] = useState<'' | 'csv' | 'xlsx' | 'evidence'>('');
  const download = async (what: 'csv' | 'xlsx' | 'evidence') => {
    setBusy(what);
    try {
      const path =
        what === 'evidence'
          ? `/admin/outcome-reports/${id}/evidence?${p.qs}`
          : `/admin/outcome-reports/${id}/export?${p.qs}&format=${what}`;
      const name = `${id}-${gradYearLabel(p.gradYear)}${p.branch ? `-${p.branch}` : ''}${what === 'evidence' ? '-evidence.xlsx' : `.${what}`}`;
      saveBlob(await apiBlob(path), name);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setBusy('');
    }
  };
  const v = r.data;
  return (
    <div className="grid gap-5">
      <BackLink to={`/admin/reports?${p.qs}`}>{t('reports.back')}</BackLink>
      {r.isLoading && <Skeleton className="h-64" />}
      {v && (
        <>
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="brand">{t(`reports.framework.${v.framework}`)}</Badge>
              <span className="text-caption text-fg-3">{t('reports.version', { version: v.version })}</span>
            </div>
            <h2 className="text-title font-semibold">{v.title}</h2>
            <p className="text-meta text-fg-2">
              {[
                v.params.branch ?? t('reports.allProgrammes'),
                v.params.gradYears.map(gradYearLabel).join(', '),
              ].join(' · ')}
            </p>
          </div>
          {v.needsReview && (
            <Card className="flex items-start gap-3 bg-warning-surface p-4 text-warning-ink">
              <AlertTriangle className="mt-0.5 size-5 flex-none" aria-hidden />
              <p className="text-meta">{t('reports.needsReviewBody')}</p>
            </Card>
          )}
          <Filters p={p} />
          {v.rows.length ? (
            <ResultTable r={v} />
          ) : (
            <p className="text-meta text-fg-3">{t('reports.empty')}</p>
          )}
          {v.notes.length > 0 && (
            <ul className="ml-5 grid list-disc gap-1 text-meta text-fg-2">
              {v.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <details className="rounded-[var(--radius-md)] bg-surface-2 p-3 text-meta">
            <summary className="cursor-pointer font-semibold">{t('reports.source')}</summary>
            <p className="mt-2 text-fg-2">{v.sourceNote}</p>
          </details>
          {canExport && (
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-2">
                <Button loading={busy === 'xlsx'} onClick={() => void download('xlsx')}>
                  <Download className="size-4" aria-hidden /> {t('reports.downloadExcel')}
                </Button>
                <Button loading={busy === 'csv'} onClick={() => void download('csv')}>
                  <Download className="size-4" aria-hidden /> {t('reports.downloadCsv')}
                </Button>
                <Button
                  variant="primary"
                  loading={busy === 'evidence'}
                  onClick={() => void download('evidence')}
                >
                  <FileSpreadsheet className="size-4" aria-hidden /> {t('reports.evidence')}
                </Button>
              </div>
              <p className="text-caption text-fg-3">{t('reports.evidenceHint')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
