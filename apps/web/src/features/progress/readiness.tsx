import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import type { ReadinessAction, ReadinessComponentView } from '@campuslink/shared';
import type { TFunction } from '../../i18n/core';
import { useTranslation } from '../../i18n/react';
import { ErrorState } from '../../components/ui/error-state';
import { IntentLink } from '../../components/ui/intent-link';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { Badge, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ProgressBar } from '../../components/ui/progress';
import { ScoreRing } from '../../components/ui/score-ring';
import { readinessActionHref, readinessFactKey } from '../../lib/readiness';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { momentumText } from './momentum';

const keyOf = (a: ReadinessAction) => `${a.component}-${a.id}`;

const actionText = (t: TFunction, a: ReadinessAction) =>
  t(`readiness.action.${a.id}`, {
    count: a.count ?? 1,
    cgpa: a.target ?? '',
    dimension: a.target ? t(`readiness.dimension.${a.target}`) : '',
  });

function GainBadge({ a }: { a: ReadinessAction }) {
  const { t } = useTranslation();
  if (a.gain === null) return null;
  return (
    <Badge tone="success" aria-label={t('readiness.gainLabel', { count: a.gain })}>
      {t('readiness.gain', { n: a.gain })}
    </Badge>
  );
}

/** One part of the score as a row: points, a bar, the fact, and its step when it is not in the top three. */
function PartRow({ c, top }: { c: ReadinessComponentView; top: Set<string> }) {
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
  const next = c.next && !top.has(keyOf(c.next)) ? c.next : null;
  const href = next ? readinessActionHref(next) : null;
  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-semibold">{name}</h3>
        {scored ? (
          <span className="text-callout font-semibold whitespace-nowrap tabular-nums">
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
      <p className="text-callout text-pretty text-fg-2">{fact}</p>
      {next && href && (
        <IntentLink
          to={href}
          className="inline-flex min-h-11 w-fit items-center gap-2 text-callout font-semibold text-brand-ink hover:underline"
        >
          {actionText(t, next)} <GainBadge a={next} />
        </IntentLink>
      )}
    </li>
  );
}

/**
 * The student's readiness (prompt 2, G5; prompt 3, U7): momentum first, the score as a large ring,
 * the top three steps once, then what the score is made of. Only the student (and the placement
 * cell) ever sees it.
 */
export function ReadinessPage() {
  const { t } = useTranslation();
  const r = useQuery({ ...SCREEN, ...q.readiness() });
  const v = r.data;
  const skipped = v?.components.filter((c) => c.status === 'not_available' || c.status === 'not_applicable');
  const top = new Set((v?.next ?? []).map(keyOf));
  const known = (v?.next ?? []).filter((a) => a.gain !== null && a.gain > 0);
  const gain = known.reduce((n, a) => n + (a.gain ?? 0), 0);
  const momentum = momentumText(t, v?.momentum);
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-6">
      <PageHeader title={t('nav.readiness')} about={t('readiness.how')} />
      {r.isLoading && (
        <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
          <Skeleton className="size-[168px] justify-self-center rounded-full" />
          <Skeleton className="h-56 rounded-[var(--radius-md)]" />
        </div>
      )}
      {r.isError && <ErrorState error={r.error} onRetry={() => void r.refetch()} />}
      {v && (
        <>
          <section
            aria-label={t('readiness.scoreLabel')}
            className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-start"
          >
            <div className="justify-self-center md:justify-self-start">
              <ScoreRing score={v.score} label={t('readiness.scoreLabel')} delta={momentum || undefined} />
            </div>
            {v.next.length ? (
              <ListSection
                title={
                  known.length
                    ? t('readiness.stepsAdd', { count: known.length, n: gain })
                    : t('readiness.nextTitle')
                }
              >
                {v.next.map((a) => {
                  const href = readinessActionHref(a);
                  return (
                    <ListRow
                      key={keyOf(a)}
                      title={actionText(t, a)}
                      trailing={<GainBadge a={a} />}
                      chevron={!!href}
                      {...(href ? { to: href } : {})}
                    />
                  );
                })}
              </ListSection>
            ) : (
              <p className="self-center text-fg-2">{t('readiness.allDone')}</p>
            )}
          </section>
          {v.renormalised && skipped && skipped.length > 0 && (
            <p className="text-callout text-fg-2">
              {t('readiness.renormalised', {
                parts: skipped.map((c) => t(`readiness.component.${c.id}`)).join(', '),
              })}
            </p>
          )}
          <ListSection title={t('readiness.parts')}>
            {v.components.map((c) => (
              <PartRow key={c.id} c={c} top={top} />
            ))}
          </ListSection>
          <p className="flex items-start gap-2 text-callout text-fg-2">
            <Lock className="mt-0.5 size-4 flex-none" aria-hidden />
            {t('readiness.private')}
          </p>
        </>
      )}
    </div>
  );
}
