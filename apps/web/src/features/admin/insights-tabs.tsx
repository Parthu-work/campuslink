import { useQuery } from '@tanstack/react-query';
import { gradYearLabel, type Count, type InsightsView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { ColumnChart } from '../../components/ui/column-chart';
import { ErrorState } from '../../components/ui/error-state';
import { Card, Skeleton } from '../../components/ui/misc';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Table, THead, Td, TdNum, Th } from '../../components/ui/table';
import { formatDay } from '../../lib/format';
import { formatNumber } from '../../lib/numbers';
import * as q from '../../lib/queries';

export type InsightTab = 'activation' | 'retention' | 'mentorship' | 'placements';

const shown = (c: Count) => (c === '<5' ? '<5' : formatNumber(c));
const percent = (n: number | null) => (n === null ? '—' : `${n}%`);

function Activation({ v }: { v: InsightsView }) {
  const { t } = useTranslation();
  const a = v.activation;
  return (
    <div className="grid gap-4">
      <StatGrid className="md:grid-cols-3 lg:grid-cols-5">
        <StatCard label={t('insights.invited')} value={shown(a.invited)} />
        <StatCard label={t('insights.signedUp')} value={shown(a.signedUp)} />
        <StatCard label={t('insights.verified')} value={shown(a.verified)} />
        <StatCard
          label={t('insights.activated')}
          value={shown(a.activated)}
          hint={t('insights.activatedHint', { matured: shown(a.matured) })}
        />
        <StatCard label={t('insights.activationPct')} value={percent(a.activationPct)} />
      </StatGrid>
      <p className="text-caption text-fg-3">{t('insights.activationNote')}</p>
      <Card className="p-4">
        <ColumnChart
          title={t('insights.weeklyActive')}
          description={t('insights.weeklyActiveHint')}
          labelHeader={t('insights.week')}
          valueHeader={t('insights.members')}
          points={v.weeklyActive.map((w) => ({
            key: w.week,
            label: formatDay(`${w.week}T12:00:00Z`),
            value: w.total === '<5' ? 0 : w.total,
            detail: t('insights.byRole', {
              students: shown(w.students),
              alumni: shown(w.alumni),
              staff: shown(w.staff),
            }),
            ...(w.total === '<5' ? { display: '<5' } : {}),
          }))}
        />
      </Card>
    </div>
  );
}

function Retention({ v }: { v: InsightsView }) {
  const { t } = useTranslation();
  const weeks = v.retention[0]?.retained.length ?? 0;
  return (
    <div className="grid gap-3">
      <p className="max-w-[65ch] text-meta text-fg-2">{t('insights.retentionIntro')}</p>
      <Table label={t('insights.retention')}>
        <THead>
          <tr>
            <Th>{t('insights.signupWeek')}</Th>
            <Th className="text-right">{t('insights.cohort')}</Th>
            {Array.from({ length: weeks }, (_, k) => (
              <Th key={k} className="text-right">
                {t('insights.weekN', { n: k + 1 })}
              </Th>
            ))}
          </tr>
        </THead>
        <tbody>
          {v.retention.map((c) => (
            <tr key={c.week}>
              <Td>{formatDay(`${c.week}T12:00:00Z`)}</Td>
              <TdNum>{shown(c.size)}</TdNum>
              {c.retained.map((r, k) => (
                <TdNum key={k}>{r === null ? '—' : `${r}%`}</TdNum>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function Mentorship({ v }: { v: InsightsView }) {
  const { t } = useTranslation();
  const m = v.mentorship;
  return (
    <div className="grid gap-3">
      <StatGrid className="md:grid-cols-4">
        <StatCard label={t('insights.requests')} value={shown(m.requests)} />
        <StatCard label={t('insights.converted')} value={shown(m.converted)} />
        <StatCard label={t('insights.conversionPct')} value={percent(m.conversionPct)} />
        <StatCard
          label={t('insights.medianReply')}
          value={m.medianReplyHours === null ? '—' : t('insights.hours', { n: m.medianReplyHours })}
        />
      </StatGrid>
      <p className="text-caption text-fg-3">{t('insights.mentorshipNote')}</p>
    </div>
  );
}

function Placements({ v }: { v: InsightsView }) {
  const { t } = useTranslation();
  const p = v.placements;
  return (
    <div className="grid gap-3">
      <p className="text-meta text-fg-2">{t('insights.batch', { year: gradYearLabel(p.gradYear) })}</p>
      <StatGrid className="md:grid-cols-3">
        <StatCard
          label={t('insights.registrationPct')}
          value={percent(p.registrationPct)}
          hint={t('insights.registrationHint', {
            registered: shown(p.registered),
            total: shown(p.finalYear),
          })}
        />
        <StatCard
          label={t('insights.offersPer100')}
          value={p.offersPer100 === null ? '—' : String(p.offersPer100)}
        />
        <StatCard
          label={t('insights.questionsPerStudent')}
          value={p.questionsPerActiveStudent === null ? '—' : String(p.questionsPerActiveStudent)}
          hint={t('insights.questionsHint', {
            questions: shown(p.studyQuestions),
            students: shown(p.activeStudents),
          })}
        />
      </StatGrid>
    </div>
  );
}

/** One of Admin › Analytics' product tabs (B9): counts suppressed under 5, ratios only from shown counts. */
export function InsightsTab({ tab }: { tab: InsightTab }) {
  const { t } = useTranslation();
  const r = useQuery(q.insights());
  if (r.isLoading) return <Skeleton className="h-64 rounded-[var(--radius-lg)]" />;
  if (r.isError) return <ErrorState error={r.error} onRetry={() => void r.refetch()} />;
  const v = r.data;
  if (!v) return null;
  return (
    <div className="grid gap-3">
      <p className="text-caption text-fg-3">
        {t('insights.window', { since: formatDay(`${v.since}T12:00:00Z`) })} · {t('analytics.suppressed')}
      </p>
      {tab === 'activation' && <Activation v={v} />}
      {tab === 'retention' && <Retention v={v} />}
      {tab === 'mentorship' && <Mentorship v={v} />}
      {tab === 'placements' && <Placements v={v} />}
    </div>
  );
}
