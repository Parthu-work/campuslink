import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BarChart3, Download, Printer } from 'lucide-react';
import {
  BRANCHES,
  REPORTS,
  type AnalyticsView,
  type Count,
  type MonthPoint,
  type ReportId,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/field';
import { Card, Skeleton } from '../../components/ui/misc';
import { api, apiBlob, ApiError, saveBlob } from '../../lib/api';
import { useCan } from '../../lib/me';
import { cn } from '../../lib/cn';

const num = (c: Count) => (c === '<5' ? null : c);

function Tile({ label, value, hint }: { label: string; value: Count | string; hint?: string | undefined }) {
  return (
    <Card className="grid gap-1 p-4">
      <span className="text-sm text-fg-2">{label}</span>
      <span className="font-display text-3xl font-bold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
    </Card>
  );
}

/** Single-series monthly bars (one hue), with hover/focus tooltip and a table view. */
function MonthBars({ title, points }: { title: string; points: MonthPoint[] }) {
  const { t } = useTranslation();
  const [active, setActive] = useState<number | null>(null);
  const W = 560;
  const H = 180;
  const pad = { l: 8, r: 8, t: 18, b: 26 };
  const max = Math.max(1, ...points.map((p) => num(p.value) ?? 0));
  const bw = (W - pad.l - pad.r) / Math.max(1, points.length);
  const label = (m: string) =>
    new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(
      new Date(`${m}-01T00:00:00Z`),
    );
  const cur = active !== null ? points[active] : null;
  return (
    <Card className="grid gap-2 p-4">
      <h3 className="font-semibold">{title}</h3>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="group" aria-label={title}>
          <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--line)" />
          {points.map((p, i) => {
            const v = num(p.value);
            const h = v === null ? 0 : ((H - pad.t - pad.b) * v) / max;
            const x = pad.l + i * bw + 1;
            const w = Math.max(2, bw - 2);
            return (
              <g
                key={p.month}
                tabIndex={0}
                role="img"
                aria-label={`${label(p.month)}: ${p.value}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="outline-none"
              >
                {/* Hit target taller than the bar. */}
                <rect x={x} y={pad.t} width={w} height={H - pad.t - pad.b} fill="transparent" />
                {v === null ? (
                  <text
                    x={x + w / 2}
                    y={H - pad.b - 6}
                    textAnchor="middle"
                    className="fill-[var(--fg-3)] text-[11px]"
                  >
                    {'<5'}
                  </text>
                ) : (
                  <path
                    d={`M ${x} ${H - pad.b} V ${H - pad.b - h + Math.min(4, h)} Q ${x} ${H - pad.b - h} ${x + Math.min(4, h)} ${H - pad.b - h} H ${x + w - Math.min(4, h)} Q ${x + w} ${H - pad.b - h} ${x + w} ${H - pad.b - h + Math.min(4, h)} V ${H - pad.b} Z`}
                    fill="var(--brand)"
                    opacity={active === null || active === i ? 1 : 0.55}
                  />
                )}
                <text x={x + w / 2} y={H - 8} textAnchor="middle" className="fill-[var(--fg-3)] text-[11px]">
                  {label(p.month)}
                </text>
              </g>
            );
          })}
        </svg>
        {cur && (
          <div
            className="pointer-events-none absolute top-0 right-0 rounded-[var(--radius-sm)] border border-line bg-surface-1 px-2 py-1 text-xs shadow-[var(--shadow)]"
            role="status"
          >
            <span className="font-semibold">{label(cur.month)}</span> ·{' '}
            <span className="tabular-nums">{cur.value}</span>
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-fg-2">{t('analytics.showTable')}</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="text-fg-3">
              <th className="py-1 font-medium">{t('analytics.month')}</th>
              <th className="py-1 font-medium">{t('analytics.count')}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.month} className="border-t border-line">
                <td className="py-1">{p.month}</td>
                <td className="py-1 tabular-nums">{p.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

/** Magnitude by outcome: horizontal bars in one hue, labelled in text ink. */
function OutcomeBars({ title, rows }: { title: string; rows: [string, Count][] }) {
  const max = Math.max(1, ...rows.map(([, v]) => num(v) ?? 0));
  return (
    <Card className="grid gap-2 p-4">
      <h3 className="font-semibold">{title}</h3>
      <dl className="grid gap-2">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[120px_1fr_44px] items-center gap-2 text-sm">
            <dt className="text-fg-2">{k}</dt>
            <dd className="h-3 rounded-full bg-surface-2" aria-hidden>
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${((num(v) ?? 0) / max) * 100}%` }}
              />
            </dd>
            <dd className="text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function AnalyticsAdmin() {
  const { t } = useTranslation();
  const canExport = useCan('reports:export');
  const [months, setMonths] = useState(6);
  const [branch, setBranch] = useState('');
  const [gradYear, setGradYear] = useState('');
  const qs = new URLSearchParams({
    months: String(months),
    ...(branch ? { branch } : {}),
    ...(gradYear ? { gradYear } : {}),
  }).toString();
  const q = useQuery({
    queryKey: ['analytics', qs],
    queryFn: () => api.get<AnalyticsView>(`/admin/analytics?${qs}`),
  });
  const exportCsv = async (report: ReportId) => {
    try {
      saveBlob(await apiBlob(`/admin/analytics/export?${qs}&report=${report}`), `${report}.csv`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
    }
  };
  const v = q.data;
  const years = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() + 4 - i);
  return (
    <div className="grid gap-5 print:gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-2xl font-bold">
            <BarChart3 className="size-6 text-brand-ink" aria-hidden /> {t('analytics.title')}
          </h2>
          <p className="max-w-[65ch] text-sm text-fg-2">{t('analytics.intro')}</p>
        </div>
        <Button size="sm" className="print:hidden" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden /> {t('analytics.print')}
        </Button>
      </div>
      {/* Filters in one row above the charts. */}
      <div className="grid gap-2 sm:grid-cols-3 print:hidden">
        <Select
          aria-label={t('analytics.period')}
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
        >
          {[3, 6, 12, 24].map((m) => (
            <option key={m} value={m}>
              {t('analytics.lastMonths', { count: m })}
            </option>
          ))}
        </Select>
        <Select aria-label={t('analytics.branch')} value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">{t('analytics.allBranches')}</option>
          {BRANCHES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('analytics.batch')}
          value={gradYear}
          onChange={(e) => setGradYear(e.target.value)}
        >
          <option value="">{t('analytics.allBatches')}</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </div>
      {q.isLoading || !v ? (
        <Skeleton className="h-80" />
      ) : (
        <>
          <p className="text-xs text-fg-3">
            {t('analytics.meta', { year: v.academicYear })} · {t('analytics.suppressed')}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={t('analytics.students')} value={v.members.students} />
            <Tile label={t('analytics.alumni')} value={v.members.alumni} />
            {v.scope === 'college' && (
              <Tile
                label={t('analytics.active30')}
                value={v.active.last30}
                hint={t('analytics.active7', { value: v.active.last7 })}
              />
            )}
            <Tile
              label={t('analytics.participation')}
              value={v.alumniParticipation.rate === null ? '—' : `${v.alumniParticipation.rate}%`}
              hint={t('analytics.participationHint', {
                active: v.alumniParticipation.active,
                total: v.alumniParticipation.total,
              })}
            />
            <Tile
              label={t('analytics.sessionsTotal')}
              value={v.sessions.total}
              hint={
                v.sessions.averageRating
                  ? t('analytics.rating', { rating: v.sessions.averageRating })
                  : undefined
              }
            />
            <Tile label={t('analytics.openJobs')} value={v.jobs.open} />
            <Tile
              label={t('analytics.eventsHeld')}
              value={v.events.held}
              hint={t('analytics.attended', { rsvps: v.events.rsvps, attended: v.events.attended })}
            />
            {v.scope === 'college' && (
              <Tile label={t('analytics.pending')} value={v.members.pendingVerification} />
            )}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <MonthBars title={t('analytics.sessionsByMonth')} points={v.sessions.completed} />
            <MonthBars title={t('analytics.jobsByMonth')} points={v.jobs.posted} />
          </div>
          <OutcomeBars
            title={t('analytics.referrals')}
            rows={(['requested', 'referred', 'declined', 'expired', 'pending'] as const).map((k) => [
              t(`analytics.ref.${k}`),
              v.referrals[k],
            ])}
          />
          <section aria-labelledby="engagement" className="grid gap-2">
            <h3 id="engagement" className="font-semibold">
              {t('analytics.engagement')}
            </h3>
            {/* Focusable so keyboard users can scroll it on phones (A11Y-3). */}
            <div
              className="overflow-x-auto rounded-[var(--radius-md)] border border-line"
              tabIndex={0}
              role="region"
              aria-labelledby="engagement"
            >
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-surface-2 text-fg-2">
                  <tr>
                    {['branch', 'batch', 'members', 'posts', 'answers', 'sessions', 'steps'].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className={cn(
                          'px-3 py-2 font-medium',
                          h !== 'branch' && h !== 'batch' && 'text-right',
                        )}
                      >
                        {t(`analytics.col.${h}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {v.engagement.map((r) => (
                    <tr key={`${r.branch}-${r.gradYear}`} className="border-t border-line">
                      <td className="px-3 py-2">{r.branch ?? t('analytics.notSet')}</td>
                      <td className="px-3 py-2">{r.gradYear ?? t('analytics.notSet')}</td>
                      {[r.members, r.posts, r.answers, r.sessions, r.roadmapSteps].map((c, i) => (
                        <td key={i} className="px-3 py-2 text-right tabular-nums">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {canExport && (
            <section aria-labelledby="exports" className="grid gap-2 print:hidden">
              <h3 id="exports" className="font-semibold">
                {t('analytics.exports')}
              </h3>
              <div className="flex flex-wrap gap-2">
                {REPORTS.map((r) => (
                  <Button key={r} size="sm" onClick={() => void exportCsv(r)}>
                    <Download className="size-4" aria-hidden /> {t(`analytics.report.${r}`)}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-fg-3">{t('analytics.exportHint')}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
