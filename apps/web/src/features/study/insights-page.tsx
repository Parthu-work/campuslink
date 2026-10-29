import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, FileText, Lightbulb, Map as MapIcon, Upload } from 'lucide-react';
import { STUDY_PERIODS, type Count, type StudyInsightsView, type StudyPeriod } from '@campuslink/shared';
import { BackLink } from '../../components/ui/back-link';
import { buttonVariants } from '../../components/ui/button-variants';
import { IntentLink } from '../../components/ui/intent-link';
import { Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Illustration } from '../../components/ui/illustration';
import { PageHeader } from '../../components/ui/page-header';
import { ProgressBar } from '../../components/ui/progress';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Segmented } from '../../components/ui/tab-nav';
import { Table, THead, Td, TdNum, Th } from '../../components/ui/table';
import { studyInsights, subject as subjectQuery } from '../../lib/queries';
import { formatNumber } from '../../lib/numbers';
import { cn } from '../../lib/cn';

const shown = (c: Count) => (c === '<5' ? '<5' : formatNumber(c));
/** Bars never hint at a suppressed count: "<5" draws as empty. */
const len = (c: Count) => (c === '<5' ? 0 : c);

function Panel({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card variant="raised" className="grid gap-4 p-5" aria-labelledby={id}>
      <h2 id={id} className="flex items-center gap-2 text-title font-semibold">
        <span className="text-brand-ink [&_svg]:size-5" aria-hidden>
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

/** A ranked list: the label, a bar in one hue, and the count in text (so no value is colour-only). */
function Ranked({ rows }: { rows: { key: string; label: ReactNode; sub?: ReactNode; value: Count }[] }) {
  const max = Math.max(1, ...rows.map((r) => len(r.value)));
  return (
    <ol className="grid gap-3">
      {rows.map((r) => (
        <li key={r.key} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3 text-meta">
            <span className="min-w-0">
              <span className="font-medium">{r.label}</span>
              {r.sub && <span className="block text-caption text-fg-3">{r.sub}</span>}
            </span>
            <span className="font-semibold tabular-nums">{shown(r.value)}</span>
          </div>
          <ProgressBar value={len(r.value)} max={max} size="sm" />
        </li>
      ))}
    </ol>
  );
}

/**
 * A subject's insights for its faculty and the college's admins (spec §10): what students ask,
 * what the material does not cover yet (with a way to add it), which material helps and how each
 * unit is used. Aggregates only: counts under 5 show as "<5", and no question or student appears.
 */
export function InsightsPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const [days, setDays] = useState<StudyPeriod>(30);
  const s = useQuery(subjectQuery(id));
  const q = useQuery(studyInsights(id, days));
  const back = <BackLink to={`/study/${id}`}>{s.data?.name ?? t('study.back')}</BackLink>;
  if (q.isError)
    return (
      <div className="grid gap-4">
        {back}
        <EmptyState art={<Illustration kind="study" />} title={t('study.insights.unavailable')}>
          {t('study.insights.unavailableBody')}
        </EmptyState>
      </div>
    );
  const v = q.data;
  return (
    <div className="grid gap-5">
      {back}
      <PageHeader
        icon={<BarChart3 />}
        eyebrow={s.data?.code}
        title={t('study.insights.title')}
        intro={t('study.insights.intro')}
      />
      <Segmented<`${StudyPeriod}`>
        label={t('ai.usage.period')}
        value={`${days}`}
        options={STUDY_PERIODS.map((d) => [`${d}`, t('ai.usage.lastDays', { count: d })] as const)}
        onChange={(d) => setDays(Number(d) as StudyPeriod)}
        className="w-fit"
      />
      {!v ? (
        <Skeleton className="h-96 rounded-[var(--radius-lg)]" />
      ) : (
        <div className={cn('grid gap-5', q.isFetching && 'opacity-70 transition-opacity')}>
          <StatGrid>
            <StatCard label={t('study.insights.questions')} value={shown(v.questions)} />
            <StatCard label={t('study.insights.students')} value={shown(v.students)} />
            <StatCard
              label={t('study.insights.notCovered')}
              value={shown(v.notCovered)}
              tone={len(v.notCovered) ? 'warning' : 'default'}
            />
            <StatCard
              label={t('study.insights.helpful')}
              value={v.feedback.helpfulRate === null ? '—' : `${Math.round(v.feedback.helpfulRate * 100)}%`}
              hint={
                v.feedback.helpfulRate === null
                  ? t('study.insights.fewRatings')
                  : t('study.insights.ratings', { up: shown(v.feedback.up), down: shown(v.feedback.down) })
              }
            />
          </StatGrid>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel id="ins-topics" icon={<Lightbulb />} title={t('study.insights.topics')}>
              {v.topics.length ? (
                <Ranked
                  rows={v.topics.map((x) => ({
                    key: x.topicId,
                    label: x.title,
                    sub: x.unitTitle,
                    value: x.questions,
                  }))}
                />
              ) : (
                <p className="text-meta text-fg-2">{t('study.insights.noQuestions')}</p>
              )}
            </Panel>
            <Gaps v={v} subjectId={id} canUpload={!!s.data?.can.upload} />
          </div>
          <Panel id="ins-material" icon={<FileText />} title={t('study.insights.material')}>
            {v.materials.length ? (
              <Table label={t('study.insights.material')}>
                <THead>
                  <tr>
                    <Th>{t('study.insights.materialName')}</Th>
                    <Th className="text-right">{t('study.insights.cited')}</Th>
                    <Th className="text-right">{t('study.insights.opened')}</Th>
                  </tr>
                </THead>
                <tbody>
                  {v.materials.map((m) => (
                    <tr key={m.id}>
                      <Td>
                        <IntentLink
                          to={`/study/${id}/m/${m.id}`}
                          className="font-medium text-brand-ink hover:underline"
                        >
                          {m.title}
                        </IntentLink>{' '}
                        <span className="text-caption text-fg-3">{t(`study.type.${m.type}`)}</span>
                      </Td>
                      <TdNum>{shown(m.cited)}</TdNum>
                      <TdNum>{shown(m.views)}</TdNum>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-meta text-fg-2">{t('study.insights.noMaterialUse')}</p>
            )}
          </Panel>
          <Panel id="ins-units" icon={<MapIcon />} title={t('study.insights.units')}>
            {v.units.length ? (
              <Table label={t('study.insights.units')}>
                <THead>
                  <tr>
                    <Th>{t('study.insights.unit')}</Th>
                    <Th className="text-right">{t('study.insights.questions')}</Th>
                    <Th className="text-right">{t('study.insights.students')}</Th>
                    <Th className="text-right">{t('study.insights.opened')}</Th>
                  </tr>
                </THead>
                <tbody>
                  {v.units.map((u, i) => (
                    <tr key={u.unitId}>
                      <Td>
                        <span className="text-fg-3">{t('study.unit', { n: i + 1 })}</span> {u.title}
                      </Td>
                      <TdNum>{shown(u.questions)}</TdNum>
                      <TdNum>{shown(u.students)}</TdNum>
                      <TdNum>{shown(u.views)}</TdNum>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-meta text-fg-2">{t('study.insights.noUnits')}</p>
            )}
          </Panel>
          <p className="text-caption text-fg-3">{t('study.insights.privacy')}</p>
        </div>
      )}
    </div>
  );
}

/** Content gaps: what students asked that the material does not cover, with "Upload material for this". */
function Gaps({ v, subjectId, canUpload }: { v: StudyInsightsView; subjectId: string; canUpload: boolean }) {
  const { t } = useTranslation();
  return (
    <Panel id="ins-gaps" icon={<Upload />} title={t('study.insights.gaps')}>
      {v.gaps.length ? (
        <ul className="grid gap-3">
          {v.gaps.map((g) => (
            <li
              key={g.topicId ?? `w-${g.title}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-line p-3"
            >
              <span className="min-w-0 text-meta">
                <span className="font-medium">{g.topicId ? g.title : `“${g.title}”`}</span>
                <span className="block text-caption text-fg-3">
                  {g.topicId
                    ? t('study.insights.gapTopic', {
                        questions: shown(g.questions),
                        students: shown(g.students),
                      })
                    : t('study.insights.gapWord', {
                        questions: shown(g.questions),
                        students: shown(g.students),
                      })}
                </span>
              </span>
              {canUpload && (
                <IntentLink
                  to={`/study/${subjectId}?add=${g.topicId ? `files:${g.topicId}` : 'files'}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  aria-label={t('study.insights.uploadFor', { title: g.title })}
                >
                  <Upload className="size-4" aria-hidden /> {t('study.insights.upload')}
                </IntentLink>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-fg-2">{t('study.insights.noGaps')}</p>
      )}
    </Panel>
  );
}
