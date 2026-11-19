import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { RowsSkeleton } from '../../components/ui/skeleton-shapes';
import { ArrowRight, Briefcase, Compass, Gauge, Map, Sparkles } from 'lucide-react';
import type { NextStepView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { ErrorState } from '../../components/ui/error-state';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { Card, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { api } from '../../lib/api';
import { formatDay } from '../../lib/format';
import * as q from '../../lib/queries';

export type NextStepItem = 'roadmap' | 'opportunity' | 'alumnus' | 'readiness';
type Item = NextStepItem;

function Row({
  icon,
  label,
  text,
  to,
  onOpen,
}: {
  icon: React.ReactNode;
  label: string;
  text: string;
  to: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <Link
        to={to}
        onClick={onOpen}
        className="flex min-h-14 items-center gap-3 rounded-[var(--radius-md)] border border-line p-3 hover:bg-hover"
      >
        <span
          className="flex size-9 flex-none items-center justify-center rounded-full bg-brand-surface text-brand-ink"
          aria-hidden
        >
          {icon}
        </span>
        <span className="grid min-w-0 flex-1">
          <span className="text-caption text-fg-3">{label}</span>
          <span className="truncate font-semibold">{text}</span>
        </span>
        <ArrowRight className="size-4 flex-none text-fg-3" aria-hidden />
      </Link>
    </li>
  );
}

/** The four items of the week's Next Step, each one tap from what it points to (prompt 2, G7). */
export function NextStepItems({ step }: { step: NextStepView }) {
  const { t } = useTranslation();
  const open = useMutation({ mutationFn: (item: Item) => api.post('/me/next-step/open', { item }) });
  const mark = (item: Item) => () => open.mutate(item);
  const delta = step.readiness?.delta;
  return (
    <ul className="grid gap-2">
      {step.roadmapStep && (
        <Row
          icon={<Map className="size-4" />}
          label={t('habits.next.roadmap', { roadmap: step.roadmapStep.roadmap })}
          text={step.roadmapStep.title}
          // Straight to the step (prompt 3, U3): Mark done is the next tap.
          to={`/roadmaps/${step.roadmapStep.slug}?step=${encodeURIComponent(step.roadmapStep.nodeId)}`}
          onOpen={mark('roadmap')}
        />
      )}
      {step.opportunity && (
        <Row
          icon={<Briefcase className="size-4" />}
          label={
            step.opportunity.kind === 'drive'
              ? t('habits.next.drive', { date: formatDay(step.opportunity.closesAt) })
              : t('habits.next.job')
          }
          text={`${step.opportunity.company}: ${step.opportunity.title}`}
          to={
            step.opportunity.kind === 'drive'
              ? `/placements/${step.opportunity.id}`
              : `/jobs/${step.opportunity.id}`
          }
          onOpen={mark('opportunity')}
        />
      )}
      {step.alumnus && (
        <Row
          icon={<Compass className="size-4" />}
          label={t('habits.next.alumnus')}
          text={[step.alumnus.name, step.alumnus.jobTitle, step.alumnus.company].filter(Boolean).join(' · ')}
          to={`/mentors/${step.alumnus.userId}`}
          onOpen={mark('alumnus')}
        />
      )}
      {step.readiness && (
        <Row
          icon={<Gauge className="size-4" />}
          label={t('habits.next.readiness')}
          text={
            delta === null || delta === undefined
              ? t('habits.next.score', { n: step.readiness.score })
              : t('habits.next.scoreDelta', {
                  n: step.readiness.score,
                  delta: delta > 0 ? `+${delta}` : String(delta),
                })
          }
          to="/readiness"
          onOpen={mark('readiness')}
        />
      )}
    </ul>
  );
}

/**
 * Home's "Your next steps" (prompt 3, U5): this week's Next Step as list rows, at most three, titles
 * wrapping, without the item the Today card already shows. Each row records its open (G7).
 */
export function NextStepsList({ skip }: { skip?: Item | null }) {
  const { t } = useTranslation();
  const s = useQuery(q.nextStep());
  const open = useMutation({ mutationFn: (item: Item) => api.post('/me/next-step/open', { item }) });
  const step = s.data;
  if (!step) return s.isLoading ? <RowsSkeleton title rows={2} leading="icon" /> : null;
  const delta = step.readiness?.delta;
  const rows: { item: Item; icon: React.ReactNode; label: string; text: string; to: string }[] = [];
  if (step.roadmapStep)
    rows.push({
      item: 'roadmap',
      icon: <Map className="size-4" />,
      label: t('habits.next.roadmap', { roadmap: step.roadmapStep.roadmap }),
      text: step.roadmapStep.title,
      to: `/roadmaps/${step.roadmapStep.slug}?step=${encodeURIComponent(step.roadmapStep.nodeId)}`,
    });
  if (step.opportunity)
    rows.push({
      item: 'opportunity',
      icon: <Briefcase className="size-4" />,
      label:
        step.opportunity.kind === 'drive'
          ? t('habits.next.drive', { date: formatDay(step.opportunity.closesAt) })
          : t('habits.next.job'),
      text: `${step.opportunity.company}: ${step.opportunity.title}`,
      to:
        step.opportunity.kind === 'drive'
          ? `/placements/${step.opportunity.id}`
          : `/jobs/${step.opportunity.id}`,
    });
  if (step.alumnus)
    rows.push({
      item: 'alumnus',
      icon: <Compass className="size-4" />,
      label: t('habits.next.alumnus'),
      text: [step.alumnus.name, step.alumnus.jobTitle, step.alumnus.company].filter(Boolean).join(' · '),
      to: `/mentors/${step.alumnus.userId}`,
    });
  if (step.readiness)
    rows.push({
      item: 'readiness',
      icon: <Gauge className="size-4" />,
      label: t('habits.next.readiness'),
      text:
        delta === null || delta === undefined
          ? t('habits.next.score', { n: step.readiness.score })
          : t('habits.next.scoreDelta', {
              n: step.readiness.score,
              delta: delta > 0 ? `+${delta}` : String(delta),
            }),
      to: '/readiness',
    });
  const shown = rows.filter((r) => r.item !== skip).slice(0, 3);
  if (!shown.length) return null;
  return (
    <ListSection
      title={t('habits.next.list')}
      action={
        <Link to="/next-step" className="text-callout font-semibold text-brand-ink hover:underline">
          {t('ui.seeAll')}
        </Link>
      }
    >
      {shown.map((r) => (
        <ListRow
          key={r.item}
          to={r.to}
          itemProps={{ onClick: () => open.mutate(r.item) }}
          leading={
            <span
              className="flex size-9 flex-none items-center justify-center rounded-full bg-brand-surface text-brand-ink"
              aria-hidden
            >
              {r.icon}
            </span>
          }
          title={r.text}
          meta={r.label}
          chevron
        />
      ))}
    </ListSection>
  );
}

/** /next-step: where the weekly message links (prompt 2, G7). */
export function NextStepPage() {
  const { t } = useTranslation();
  const s = useQuery(q.nextStep());
  // Opening the page counts once (the API records it once a week anyway).
  const recorded = useRef(false);
  useEffect(() => {
    if (!s.data || recorded.current) return;
    recorded.current = true;
    void api.post('/me/next-step/open', { item: 'page' }).catch(() => undefined);
  }, [s.data]);
  return (
    <div className="mx-auto grid w-full max-w-[720px] gap-5">
      <PageHeader icon={<Sparkles />} title={t('habits.next.title')} intro={t('habits.next.intro')} />
      {s.isLoading && <Skeleton className="h-64" />}
      {s.isError && <ErrorState error={s.error} onRetry={() => void s.refetch()} />}
      {s.isSuccess &&
        (s.data ? (
          <Card variant="raised" className="grid gap-3 p-4 sm:p-6">
            <NextStepItems step={s.data} />
            <p className="text-caption text-fg-3">{t('habits.next.why')}</p>
          </Card>
        ) : (
          <Card className="p-4 text-callout text-fg-2">{t('habits.next.none')}</Card>
        ))}
    </div>
  );
}
