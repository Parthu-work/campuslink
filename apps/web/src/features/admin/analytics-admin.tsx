import { lazy, Suspense, useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { BRANCHES, REPORTS, type Count, type MonthPoint, type ReportId } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { ColumnChart, type ColumnPoint } from '../../components/ui/column-chart';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Select } from '../../components/ui/field';
import { Card, Skeleton } from '../../components/ui/misc';
import { ProgressBar } from '../../components/ui/progress';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Table, THead, Td, TdNum, Th } from '../../components/ui/table';
import { apiBlob, ApiError, saveBlob } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatMonth, perLocale } from '../../lib/format';
import { useCan } from '../../lib/me';
import { formatNumber } from '../../lib/numbers';
import { analytics, ANALYTICS_DEFAULTS } from '../../lib/queries';
import { toast } from '../../lib/toast';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import type { InsightTab } from './insights-tabs';

const InsightsTab = lazy(() => import('./insights-tabs').then((m) => ({ default: m.InsightsTab })));

const num = (c: Count) => (c === '<5' ? null : c);
const shown = (c: Count) => (c === '<5' ? '<5' : formatNumber(c));
const year = perLocale((l) => new Intl.DateTimeFormat(l, { year: 'numeric' }));

/** Months as chart columns: mid-month, so no timezone moves a month; "<5" draws no column. */
const columns = (points: MonthPoint[]): ColumnPoint[] =>
  points.map((p) => {
    const at = `${p.month}-15T12:00:00Z`;
    return {
      key: p.month,
      label: formatMonth(at),
      detail: year().format(new Date(at)),
      value: num(p.value) ?? 0,
      ...(p.value === '<5' ? { display: '<5' } : {}),
    };
  });

/** Magnitude by outcome: a bar in one hue per row, with the count in text (never colour-only). */
function OutcomeBars({ title, rows }: { title: string; rows: [string, Count][] }) {
  const max = Math.max(1, ...rows.map(([, v]) => num(v) ?? 0));
  return (
    <Card variant="raised" className="grid gap-3 p-5">
      <h3 className="font-semibold">{title}</h3>
      <dl className="grid gap-3">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[7rem_minmax(0,1fr)_3rem] items-center gap-3 text-meta">
            <dt className="text-fg-2">{k}</dt>
            <dd>
              <ProgressBar value={num(v) ?? 0} max={max} />
            </dd>
            <dd className="text-right font-semibold tabular-nums">{shown(v)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/**
 * Admin › Analytics: college or cohort aggregates for a period, filtered by branch and batch.
 * Counts only (every one through `suppress()` on the server, "<5" here); the charts are the shared
 * `ColumnChart`, each with a table view, and the engagement breakdown is a `Table`.
 */
function AnalyticsOverview() {
  const { t } = useTranslation();
  const canExport = useCan('reports:export');
  const [filters, setFilters] = useState(ANALYTICS_DEFAULTS);
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch }));
  const q = useQuery(analytics(filters));
  const exportCsv = async (report: ReportId) => {
    const qs = new URLSearchParams({
      months: String(filters.months),
      ...(filters.branch ? { branch: filters.branch } : {}),
      ...(filters.gradYear ? { gradYear: filters.gradYear } : {}),
      report,
    });
    try {
      saveBlob(await apiBlob(`/admin/analytics/export?${qs}`), `${report}.csv`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
    }
  };
  const v = q.data;
  const years = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() + 4 - i);
  return (
    <div className="grid gap-5 print:gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[65ch] text-meta text-fg-2">{t('analytics.intro')}</p>
        <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden /> {t('analytics.print')}
        </Button>
      </div>
      {/* Filters in one row above the charts, each with a visible label. */}
      <div className="grid gap-3 sm:grid-cols-3 print:hidden">
        <Field label={t('analytics.period')}>
          {({ id }) => (
            <Select id={id} value={filters.months} onChange={(e) => set({ months: Number(e.target.value) })}>
              {[3, 6, 12, 24].map((m) => (
                <option key={m} value={m}>
                  {t('analytics.lastMonths', { count: m })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('analytics.branch')}>
          {({ id }) => (
            <Select id={id} value={filters.branch} onChange={(e) => set({ branch: e.target.value })}>
              <option value="">{t('analytics.allBranches')}</option>
              {BRANCHES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('analytics.batch')}>
          {({ id }) => (
            <Select id={id} value={filters.gradYear} onChange={(e) => set({ gradYear: e.target.value })}>
              <option value="">{t('analytics.allBatches')}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !v ? (
        <div className="grid gap-3">
          <Skeleton className="h-28 rounded-[var(--radius-lg)]" />
          <Skeleton className="h-64 rounded-[var(--radius-lg)]" />
        </div>
      ) : (
        <div className={cn('grid gap-5', q.isPlaceholderData && 'opacity-70 transition-opacity')}>
          <p className="text-caption text-fg-3">
            {t('analytics.meta', { year: v.academicYear })} · {t('analytics.suppressed')}
          </p>
          <StatGrid className="md:grid-cols-3 lg:grid-cols-4">
            <StatCard label={t('analytics.students')} value={shown(v.members.students)} />
            <StatCard label={t('analytics.alumni')} value={shown(v.members.alumni)} />
            {v.scope === 'college' && (
              <StatCard
                label={t('analytics.active30')}
                value={shown(v.active.last30)}
                hint={t('analytics.active7', { value: shown(v.active.last7) })}
              />
            )}
            <StatCard
              label={t('analytics.participation')}
              value={v.alumniParticipation.rate === null ? '—' : `${v.alumniParticipation.rate}%`}
              hint={t('analytics.participationHint', {
                active: shown(v.alumniParticipation.active),
                total: shown(v.alumniParticipation.total),
              })}
            />
            <StatCard
              label={t('analytics.sessionsTotal')}
              value={shown(v.sessions.total)}
              hint={
                v.sessions.averageRating
                  ? t('analytics.rating', { rating: v.sessions.averageRating })
                  : undefined
              }
            />
            <StatCard label={t('analytics.openJobs')} value={shown(v.jobs.open)} />
            <StatCard
              label={t('analytics.eventsHeld')}
              value={shown(v.events.held)}
              hint={t('analytics.attended', {
                rsvps: shown(v.events.rsvps),
                attended: shown(v.events.attended),
              })}
            />
            {v.scope === 'college' && (
              <StatCard
                label={t('analytics.pending')}
                value={shown(v.members.pendingVerification)}
                tone={num(v.members.pendingVerification) ? 'warning' : 'default'}
              />
            )}
          </StatGrid>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card variant="raised" className="p-5">
              <ColumnChart
                title={t('analytics.sessionsByMonth')}
                points={columns(v.sessions.completed)}
                labelHeader={t('analytics.month')}
                valueHeader={t('analytics.count')}
              />
            </Card>
            <Card variant="raised" className="p-5">
              <ColumnChart
                title={t('analytics.jobsByMonth')}
                points={columns(v.jobs.posted)}
                labelHeader={t('analytics.month')}
                valueHeader={t('analytics.count')}
              />
            </Card>
          </div>
          <OutcomeBars
            title={t('analytics.referrals')}
            rows={(['requested', 'referred', 'declined', 'expired', 'pending'] as const).map((k) => [
              t(`analytics.ref.${k}`),
              v.referrals[k],
            ])}
          />
          <section aria-labelledby="engagement" className="grid gap-3">
            <h3 id="engagement" className="font-semibold">
              {t('analytics.engagement')}
            </h3>
            {v.engagement.length ? (
              <Table label={t('analytics.engagement')}>
                <THead>
                  <tr>
                    {(['branch', 'batch', 'members', 'posts', 'answers', 'sessions', 'steps'] as const).map(
                      (h) => (
                        <Th key={h} className={cn(h !== 'branch' && h !== 'batch' && 'text-right')}>
                          {t(`analytics.col.${h}`)}
                        </Th>
                      ),
                    )}
                  </tr>
                </THead>
                <tbody>
                  {v.engagement.map((r) => (
                    <tr key={`${r.branch}-${r.gradYear}`}>
                      <Td>{r.branch ?? t('analytics.notSet')}</Td>
                      <Td>{r.gradYear ?? t('analytics.notSet')}</Td>
                      {[r.members, r.posts, r.answers, r.sessions, r.roadmapSteps].map((c, i) => (
                        <TdNum key={i}>{shown(c)}</TdNum>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-meta text-fg-2">{t('analytics.noEngagement')}</p>
            )}
          </section>
          {canExport && (
            <section aria-labelledby="exports" className="grid gap-3 print:hidden">
              <h3 id="exports" className="font-semibold">
                {t('analytics.exports')}
              </h3>
              <div className="flex flex-wrap gap-2">
                {REPORTS.map((r) => (
                  <Button key={r} variant="outline" size="sm" onClick={() => void exportCsv(r)}>
                    <Download className="size-4" aria-hidden /> {t(`analytics.report.${r}`)}
                  </Button>
                ))}
              </div>
              <p className="text-caption text-fg-3">{t('analytics.exportHint')}</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

type AnalyticsTab = 'overview' | InsightTab;
const INSIGHT_TABS: readonly InsightTab[] = ['activation', 'retention', 'mentorship', 'placements'];

/**
 * Admin › Analytics: the period overview for everyone with cohort analytics, and for the college's
 * placement cell and admins the product tabs (B9): activation, retention, mentorship, placements.
 */
export function AnalyticsAdmin() {
  const { t } = useTranslation();
  const canProduct = useCan('analytics:tenant');
  const [tab, setTab] = useState<AnalyticsTab>('overview');
  if (!canProduct) return <AnalyticsOverview />;
  const idBase = 'analytics';
  return (
    <div className="grid gap-4">
      <Tabs<AnalyticsTab>
        label={t('insights.tabsLabel')}
        idBase={idBase}
        value={tab}
        onChange={setTab}
        tabs={(['overview', ...INSIGHT_TABS] as const).map((id) => ({ id, label: t(`insights.tab.${id}`) }))}
      />
      <TabPanel idBase={idBase} id={tab}>
        {tab === 'overview' ? (
          <AnalyticsOverview />
        ) : (
          <Suspense fallback={<Skeleton className="h-64 rounded-[var(--radius-lg)]" />}>
            <InsightsTab tab={tab} />
          </Suspense>
        )}
      </TabPanel>
    </div>
  );
}
