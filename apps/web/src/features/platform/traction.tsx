import { useQuery } from '@tanstack/react-query';
import type { Count, PlatformInsightRow } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { DataTable } from '../../components/ui/data-table';
import { ErrorState } from '../../components/ui/error-state';
import { Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { formatNumber } from '../../lib/numbers';
import { platformInsights } from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';

const shown = (c: Count) => (c === '<5' ? '<5' : formatNumber(c));
const COLUMNS = [
  'active7d',
  'active28d',
  'signUps',
  'requests',
  'sessions',
  'driveRegistrations',
  'offersVerified',
  'studyQuestions',
] as const satisfies readonly (keyof PlatformInsightRow)[];

/**
 * Platform › Traction (B9): every college's product metrics side by side, from per-college
 * aggregates only (never member rows). Opening it is recorded in the audit log.
 */
export function PlatformTraction() {
  const { t } = useTranslation();
  const r = useQuery({ ...SCREEN, ...platformInsights() });
  const v = r.data;
  return (
    <div className="grid gap-5">
      <PageHeader title={t('traction.title')} intro={t('traction.intro')} />
      {r.isLoading && <Skeleton className="h-48" />}
      {r.isError && !v && <ErrorState error={r.error} onRetry={() => void r.refetch()} />}
      {v && (
        <>
          <StatGrid className="md:grid-cols-4">
            <StatCard label={t('traction.col.active7d')} value={shown(v.totals.active7d)} />
            <StatCard label={t('traction.col.active28d')} value={shown(v.totals.active28d)} />
            <StatCard label={t('traction.col.signUps')} value={shown(v.totals.signUps)} />
            <StatCard label={t('traction.col.sessions')} value={shown(v.totals.sessions)} />
          </StatGrid>
          <p className="text-caption text-fg-3">{t('traction.window', { weeks: v.weeks })}</p>
          {/* One table pattern (prompt 3, U9): every column sorts. */}
          <DataTable
            label={t('traction.title')}
            rows={v.colleges}
            rowKey={(c) => c.tenantId}
            initialSort={{ key: 'active7d', dir: 'desc' }}
            columns={[
              {
                key: 'college',
                header: t('traction.college'),
                sort: (c) => c.name.toLowerCase(),
                cell: (c) => (
                  <span className="block min-w-44">
                    {c.name}
                    <span className="block font-mono text-caption text-fg-3">{c.slug}</span>
                  </span>
                ),
              },
              ...COLUMNS.map((k) => ({
                key: k,
                header: t(`traction.col.${k}`),
                numeric: true,
                // "<5" sorts between 0 and 5: its place reveals nothing more than "<5" does.
                sort: (c: PlatformInsightRow) => (c[k] === '<5' ? 2.5 : c[k]),
                cell: (c: PlatformInsightRow) => shown(c[k]),
              })),
            ]}
          />
        </>
      )}
    </div>
  );
}
