import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Gauge, Lock } from 'lucide-react';
import type { ReadinessAction, ReadinessComponentView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { ErrorState } from '../../components/ui/error-state';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ProgressBar, ProgressRing } from '../../components/ui/progress';
import { readinessActionHref, readinessFactKey } from '../../lib/readiness';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';

function ActionLink({ a }: { a: ReadinessAction }) {
  const { t } = useTranslation();
  const href = readinessActionHref(a);
  const text = t(`readiness.action.${a.id}`, {
    count: a.count ?? 1,
    cgpa: a.target ?? '',
    dimension: a.target ? t(`readiness.dimension.${a.target}`) : '',
  });
  const body = (
    <>
      <span className="min-w-0 flex-1 font-semibold">{text}</span>
      {a.gain !== null && (
        <Badge tone="success" aria-label={t('readiness.gainLabel', { count: a.gain })}>
          {t('readiness.gain', { n: a.gain })}
        </Badge>
      )}
      {href && <ArrowRight className="size-4 flex-none text-fg-3" aria-hidden />}
    </>
  );
  return href ? (
    <IntentLink
      to={href}
      className="flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] bg-surface-2 px-4 py-3 hover:bg-surface-3"
    >
      {body}
    </IntentLink>
  ) : (
    <div className="flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] bg-surface-2 px-4 py-3">
      {body}
    </div>
  );
}

function ComponentCard({ c }: { c: ReadinessComponentView }) {
  const { t } = useTranslation();
  const scored = c.status === 'scored';
  const f = c.facts;
  const fact = t(`readiness.facts.${readinessFactKey(c)}`, {
    count: Number(f.sessions ?? f.mocks ?? f.resumes ?? f.sets ?? 0),
    accuracy: f.accuracy ?? 0,
    ats: f.ats ?? '',
    mocks: f.mocks ?? 0,
    average: f.average ?? '',
    done: f.done ?? 0,
    total: f.total ?? 0,
    roadmap: f.roadmap ?? '',
    cgpa: f.cgpa ?? '',
    meets: f.meets ?? 0,
    drives: f.drives ?? 0,
  });
  const name = t(`readiness.component.${c.id}`);
  return (
    <li>
      <Card className="grid gap-3 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-lead font-semibold">{name}</h3>
          {scored ? (
            <span className="text-meta font-semibold tabular-nums">
              {t('readiness.points', { points: c.points, max: c.max })}
            </span>
          ) : (
            <Badge>{t(`readiness.status.${c.status}`)}</Badge>
          )}
        </div>
        {scored && (
          <ProgressBar
            value={c.points}
            max={c.max || 1}
            label={name}
            valueText={t('readiness.points', { points: c.points, max: c.max })}
          />
        )}
        <p className="text-meta text-fg-2">{fact}</p>
        {c.next && <ActionLink a={c.next} />}
      </Card>
    </li>
  );
}

/**
 * The student's readiness (prompt 2, G5): one number, the points behind it and what to do next.
 * Only the student (and the placement cell) ever sees it.
 */
export function ReadinessPage() {
  const { t } = useTranslation();
  const r = useQuery({ ...SCREEN, ...q.readiness() });
  const v = r.data;
  const skipped = v?.components.filter((c) => c.status === 'not_available' || c.status === 'not_applicable');
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-6">
      <PageHeader icon={<Gauge />} title={t('nav.readiness')} intro={t('readiness.intro')} />
      {r.isLoading && <Skeleton className="h-80 rounded-[var(--radius-lg)]" />}
      {r.isError && <ErrorState error={r.error} onRetry={() => void r.refetch()} />}
      {v && (
        <>
          <Card className="grid gap-5 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
            <ProgressRing
              value={v.score}
              max={100}
              size={112}
              stroke={10}
              label={t('readiness.scoreLabel')}
              valueText={t('readiness.outOf', { score: v.score })}
              className="justify-self-center"
            >
              <span className="text-headline font-bold tabular-nums">{v.score}</span>
            </ProgressRing>
            <div className="grid gap-3">
              <h2 className="text-title font-semibold">{t('readiness.headline', { score: v.score })}</h2>
              {v.next.length ? (
                <>
                  <p className="text-meta text-fg-2">{t('readiness.nextIntro')}</p>
                  <ol className="grid gap-2">
                    {v.next.map((a) => (
                      <li key={`${a.component}-${a.id}`}>
                        <ActionLink a={a} />
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="text-fg-2">{t('readiness.allDone')}</p>
              )}
            </div>
          </Card>
          {v.renormalised && skipped && skipped.length > 0 && (
            <p className="rounded-[var(--radius-md)] bg-surface-2 px-4 py-3 text-meta text-fg-2">
              {t('readiness.renormalised', {
                parts: skipped.map((c) => t(`readiness.component.${c.id}`)).join(', '),
              })}
            </p>
          )}
          <section aria-labelledby="readiness-parts" className="grid gap-3">
            <h2 id="readiness-parts" className="text-title font-semibold">
              {t('readiness.parts')}
            </h2>
            <p className="text-meta text-fg-2">{t('readiness.how')}</p>
            <ul className="grid gap-3 md:grid-cols-2">
              {v.components.map((c) => (
                <ComponentCard key={c.id} c={c} />
              ))}
            </ul>
          </section>
          <p className="flex items-start gap-2 text-meta text-fg-2">
            <Lock className="mt-0.5 size-4 flex-none" aria-hidden />
            {t('readiness.private')}
          </p>
        </>
      )}
    </div>
  );
}
