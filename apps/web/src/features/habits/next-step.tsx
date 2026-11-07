import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Briefcase, Compass, Gauge, Map, Sparkles } from 'lucide-react';
import type { NextStepView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { ErrorState } from '../../components/ui/error-state';
import { Card, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { api } from '../../lib/api';
import { formatDay } from '../../lib/format';
import * as q from '../../lib/queries';

type Item = 'roadmap' | 'opportunity' | 'alumnus' | 'readiness';

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
          to={`/roadmaps/${step.roadmapStep.slug}`}
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

/** Home: this week's Next Step (students only; nothing when there is nothing to suggest). */
export function NextStepCard() {
  const { t } = useTranslation();
  const s = useQuery(q.nextStep());
  if (!s.data) return null;
  return (
    <Card variant="raised" className="grid gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-headline font-semibold">
          <Sparkles className="size-5 text-brand-ink" aria-hidden /> {t('habits.next.title')}
        </h2>
        <Link
          to="/next-step"
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-callout font-semibold text-brand-ink underline"
        >
          {t('habits.next.all')}
        </Link>
      </div>
      <NextStepItems step={s.data} />
    </Card>
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
