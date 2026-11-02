import { useQuery } from '@tanstack/react-query';
import type { Count, PlatformInsightRow } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { ErrorState } from '../../components/ui/error-state';
import { Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Table, THead, Td, TdNum, Th } from '../../components/ui/table';
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
          <Table label={t('traction.title')}>
            <THead>
              <tr>
                <Th>{t('traction.college')}</Th>
                {COLUMNS.map((c) => (
                  <Th key={c} className="text-right">
                    {t(`traction.col.${c}`)}
                  </Th>
                ))}
              </tr>
            </THead>
            <tbody>
              {v.colleges.map((c) => (
                <tr key={c.tenantId}>
                  <Td>
                    {c.name}
                    <span className="block font-mono text-caption text-fg-3">{c.slug}</span>
                  </Td>
                  {COLUMNS.map((k) => (
                    <TdNum key={k}>{shown(c[k])}</TdNum>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
