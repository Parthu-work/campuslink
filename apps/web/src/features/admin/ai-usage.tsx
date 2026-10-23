import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Activity, CircleAlert, PauseCircle } from 'lucide-react';
import { STUDY_PERIODS, type AiUsageView, type Count, type StudyPeriod } from '@campuslink/shared';
import { Badge, Skeleton } from '../../components/ui/misc';
import { ProgressBar } from '../../components/ui/progress';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Segmented } from '../../components/ui/tab-nav';
import { Table, THead, Td, TdNum, Th } from '../../components/ui/table';
import { ColumnChart } from '../../components/ui/column-chart';
import { aiUsage } from '../../lib/queries';
import { formatDateTime, formatTime } from '../../lib/format';
import { formatCompact, formatMoney, formatNumber, formatUtcDay } from '../../lib/numbers';
import { cn } from '../../lib/cn';

const count = (c: Count) => (c === '<5' ? '<5' : formatNumber(c));

/**
 * Admin › AI assistant › Usage (spec §7, §10): the month against the budget, tokens per day, a cost
 * estimate from the prices the admin entered, failures, the processing queue and how much of
 * each subject is searchable. College totals only, never a member's usage.
 */
export function AiUsagePanel() {
  const { t } = useTranslation();
  const [days, setDays] = useState<StudyPeriod>(30);
  const q = useQuery(aiUsage(days));
  const v = q.data;
  if (!v) return <Skeleton className="h-72" />;
  const money = (n: number | null) => (n === null ? '—' : formatMoney(n, v.cost.currency));
  const total = v.series.reduce((n, d) => n + d.chat + d.embedding + d.other, 0);
  return (
    <div className={cn('grid gap-5', q.isFetching && 'opacity-70 transition-opacity')}>
      <Segmented<`${StudyPeriod}`>
        label={t('ai.usage.period')}
        value={`${days}`}
        options={STUDY_PERIODS.map((d) => [`${d}`, t('ai.usage.lastDays', { count: d })] as const)}
        onChange={(d) => setDays(Number(d) as StudyPeriod)}
        className="w-fit"
      />
      <Budget v={v} />
      <StatGrid>
        <StatCard label={t('ai.usage.tokens')} value={formatCompact(total)} />
        <StatCard
          label={t('ai.usage.cost')}
          value={v.cost.priced ? money(v.cost.period) : '—'}
          hint={v.cost.priced ? t('ai.usage.costHint') : t('ai.usage.noPrices')}
        />
        <StatCard label={t('ai.usage.answers')} value={count(v.answers.total)} />
        <StatCard
          label={t('ai.usage.failed')}
          value={count(v.answers.failed)}
          tone={v.answers.failed === 0 ? 'default' : 'warning'}
          hint={t('ai.usage.notCovered', { n: count(v.answers.notCovered) })}
        />
      </StatGrid>
      <ColumnChart
        title={t('ai.usage.perDay')}
        description={t('ai.usage.perDayHint')}
        labelHeader={t('ai.usage.day')}
        valueHeader={t('ai.usage.tokens')}
        points={v.series.map((d) => ({
          key: d.day,
          label: formatUtcDay(d.day),
          value: d.chat + d.embedding + d.other,
          detail: t('ai.usage.breakdown', {
            chat: formatCompact(d.chat),
            embedding: formatCompact(d.embedding),
            other: formatCompact(d.other),
          }),
        }))}
      />
      <Health v={v} />
      {v.models.length > 0 && (
        <Table label={t('ai.usage.byModel')}>
          <THead>
            <tr>
              <Th>{t('ai.usage.model')}</Th>
              <Th>{t('ai.usage.kind')}</Th>
              <Th className="text-right">{t('ai.usage.requests')}</Th>
              <Th className="text-right">{t('ai.usage.input')}</Th>
              <Th className="text-right">{t('ai.usage.output')}</Th>
              <Th className="text-right">{t('ai.usage.estimate')}</Th>
            </tr>
          </THead>
          <tbody>
            {v.models.map((m) => (
              <tr key={`${m.kind}|${m.model}`}>
                <Td className="font-mono text-caption">{m.model}</Td>
                <Td>{t(`ai.usage.kinds.${m.kind}`)}</Td>
                <TdNum>{count(m.requests)}</TdNum>
                <TdNum>{formatNumber(m.inputTokens)}</TdNum>
                <TdNum>{formatNumber(m.outputTokens)}</TdNum>
                <TdNum>{money(m.cost)}</TdNum>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Coverage v={v} />
    </div>
  );
}

/** This month's tokens against the budget: the meter turns amber at 80% and red when used up. */
function Budget({ v }: { v: AiUsageView }) {
  const { t } = useTranslation();
  const m = v.month;
  const resets = formatUtcDay(m.resetsAt.slice(0, 10));
  if (!m.budget)
    return <p className="text-meta text-fg-2">{t('ai.usage.noBudget', { used: formatNumber(m.used) })}</p>;
  const pct = m.percent ?? 0;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{t('ai.usage.month')}</p>
        <p className="text-meta text-fg-2">
          {t('ai.usage.monthOf', {
            used: formatNumber(m.used),
            budget: formatNumber(m.budget),
            percent: pct,
          })}
        </p>
      </div>
      <ProgressBar
        value={m.used}
        max={m.budget}
        size="lg"
        tone={m.exhausted ? 'danger' : pct >= 80 ? 'warning' : 'brand'}
        label={t('ai.usage.month')}
        valueText={t('ai.usage.monthOf', {
          used: formatNumber(m.used),
          budget: formatNumber(m.budget),
          percent: pct,
        })}
      />
      <p className="text-caption text-fg-3">
        {m.exhausted ? t('ai.usage.exhausted', { date: resets }) : t('ai.usage.resets', { date: resets })}
        {v.cost.priced && v.cost.month !== null && (
          <> · {t('ai.usage.monthCost', { cost: formatMoney(v.cost.month, v.cost.currency) })}</>
        )}
      </p>
    </div>
  );
}

/** Failures and the queue: what an admin may need to act on. */
function Health({ v }: { v: AiUsageView }) {
  const { t } = useTranslation();
  const q = v.queue;
  return (
    <div className="grid gap-3 rounded-[var(--radius-md)] border border-line p-4" aria-live="polite">
      <h3 className="flex items-center gap-2 font-semibold">
        <Activity className="size-4 text-brand-ink" aria-hidden /> {t('ai.usage.health')}
      </h3>
      {v.breaker.open && v.breaker.until && (
        <p className="flex items-start gap-2 text-meta text-warning-ink">
          <PauseCircle className="mt-0.5 size-4 flex-none" aria-hidden />
          {t('ai.usage.paused', { time: formatTime(v.breaker.until) })}
        </p>
      )}
      {v.lastError ? (
        <p className="flex items-start gap-2 text-meta text-fg-2">
          <CircleAlert className="mt-0.5 size-4 flex-none text-warning-ink" aria-hidden />
          {t('ai.usage.lastError', { error: v.lastError.message, when: formatDateTime(v.lastError.at) })}
        </p>
      ) : (
        <p className="text-meta text-fg-2">{t('ai.usage.noErrors')}</p>
      )}
      <ul className="flex flex-wrap gap-2 text-meta">
        <li>
          <Badge tone={q.processing ? 'info' : 'neutral'}>
            {t('ai.usage.processing', { count: q.processing })}
          </Badge>
        </li>
        <li>
          <Badge tone={q.failed ? 'danger' : 'neutral'}>
            {t('ai.usage.failedMaterial', { count: q.failed })}
          </Badge>
        </li>
        <li>
          <Badge tone={q.embeddingsPending ? 'info' : 'neutral'}>
            {q.embeddingsRunning
              ? t('ai.usage.embedding', { count: q.embeddingsPending })
              : t('ai.usage.waiting', { count: q.embeddingsPending })}
          </Badge>
        </li>
      </ul>
      {q.oldestWaitingMin !== null && q.oldestWaitingMin >= 30 && (
        <p className="text-caption text-warning-ink">{t('ai.usage.stuck', { count: q.oldestWaitingMin })}</p>
      )}
    </div>
  );
}

/** How much of each subject is processed and searchable by meaning. */
function Coverage({ v }: { v: AiUsageView }) {
  const { t } = useTranslation();
  if (!v.coverage.length) return null;
  return (
    <Table label={t('ai.usage.coverage')}>
      <THead>
        <tr>
          <Th>{t('ai.usage.subject')}</Th>
          <Th className="text-right">{t('ai.usage.materials')}</Th>
          <Th className="text-right">{t('ai.usage.ready')}</Th>
          <Th className="text-right">{t('ai.usage.inProgress')}</Th>
          <Th className="text-right">{t('ai.usage.failedShort')}</Th>
          <Th className="min-w-40">{t('ai.usage.byMeaning')}</Th>
        </tr>
      </THead>
      <tbody>
        {v.coverage.map((c) => (
          <tr key={c.subjectId}>
            <Td>
              <span className="font-medium">{c.name}</span>{' '}
              <span className="font-mono text-caption text-fg-3">{c.code}</span>
            </Td>
            <TdNum>{formatNumber(c.materials)}</TdNum>
            <TdNum>{formatNumber(c.indexed)}</TdNum>
            <TdNum>{formatNumber(c.processing)}</TdNum>
            <TdNum className={c.failed ? 'text-danger-ink' : ''}>{formatNumber(c.failed)}</TdNum>
            <Td>
              {c.passages ? (
                <ProgressBar
                  value={c.embedded}
                  max={c.passages}
                  size="sm"
                  label={t('ai.usage.byMeaningOf', { name: c.name })}
                  valueText={t('ai.index.counts', { embedded: c.embedded, total: c.passages })}
                />
              ) : (
                <span className="text-caption text-fg-3">{t('ai.usage.noPassages')}</span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
