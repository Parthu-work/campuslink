import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { cn } from '../../lib/cn';

export interface TrackStep {
  id: string;
  title: string;
  /** Done, the next one to do, or still to come (upcoming steps can still be opened). */
  state: 'done' | 'next' | 'upcoming';
  /** "About 1–2 weeks". */
  meta?: ReactNode;
  /** A small badge (a project's "Proof"). */
  badge?: ReactNode;
  /** The step's kind, as a 20 px icon. */
  icon?: ReactNode;
}
export interface TrackPhase {
  name: string;
  steps: TrackStep[];
}

/**
 * A journey as phases of steps (ADR 0015, the roadmap's main view, U3): a vertical line with a
 * marker per step (filled when done, a ring for the next one, hollow for the rest), titles that
 * wrap, and the whole row as the target. For screen readers it is an ordered list per phase,
 * numbered across phases, and every step says its state.
 */
export function StepTrack({
  phases,
  onOpen,
  label,
}: {
  phases: TrackPhase[];
  onOpen: (id: string) => void;
  /** The track's accessible name ("Your path"). */
  label: string;
}) {
  const { t } = useTranslation();
  const states = { done: t('ui.stepDone'), next: t('ui.stepNext'), upcoming: t('ui.stepUpcoming') };
  // Each phase's list continues the numbering of the one before.
  const starts = phases.map((_, i) => 1 + phases.slice(0, i).reduce((sum, p) => sum + p.steps.length, 0));
  return (
    <nav aria-label={label} className="grid gap-6">
      {phases.map((phase, p) => {
        const start = starts[p];
        return (
          <section key={phase.name} className="grid gap-2">
            <h3 className="flex items-baseline justify-between gap-3 px-1">
              <span className="text-headline font-semibold">{phase.name}</span>
              <span className="text-caption text-fg-3">{t('ui.steps', { count: phase.steps.length })}</span>
            </h3>
            <ol start={start} className="grid">
              {phase.steps.map((step, i) => {
                const last = i === phase.steps.length - 1;
                return (
                  <li key={step.id} className="relative">
                    {!last && (
                      <span
                        aria-hidden
                        className={cn(
                          'absolute top-9 bottom-0 left-[1.6875rem] w-0.5 -translate-x-1/2',
                          step.state === 'done' ? 'bg-brand' : 'bg-line-strong',
                        )}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => onOpen(step.id)}
                      aria-current={step.state === 'next' ? 'step' : undefined}
                      className={cn(
                        'relative flex min-h-14 w-full items-start gap-3 rounded-[var(--radius-md)] px-4 py-3 text-left transition-colors duration-[var(--dur-press)] hover:bg-hover',
                        step.state === 'next' && 'bg-brand-surface hover:bg-brand-surface',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 grid size-6 flex-none place-items-center rounded-full border-2',
                          step.state === 'done' && 'border-brand bg-brand text-on-brand',
                          step.state === 'next' && 'border-brand bg-surface-1',
                          step.state === 'upcoming' && 'border-line-strong bg-surface-1',
                        )}
                      >
                        {step.state === 'done' && <Check className="size-3.5" strokeWidth={3} />}
                        {step.state === 'next' && <span className="size-2.5 rounded-full bg-brand" />}
                      </span>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span
                          className={cn(
                            'text-body font-medium text-pretty break-words',
                            step.state === 'done' ? 'text-fg-2' : 'text-fg',
                          )}
                        >
                          {step.title}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-callout text-fg-2">
                          <span className="sr-only">{states[step.state]}.</span>
                          {step.state === 'next' && (
                            <span aria-hidden className="font-semibold text-brand-ink">
                              {states.next}
                            </span>
                          )}
                          {step.meta}
                          {step.badge}
                        </span>
                      </span>
                      {step.icon && (
                        <span className="mt-0.5 flex-none text-fg-3 [&>svg]:size-5">{step.icon}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </nav>
  );
}
