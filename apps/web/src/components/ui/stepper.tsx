import { Check } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { cn } from '../../lib/cn';

/**
 * Where a member is in a short flow (verification, booking): numbered steps joined by a line, done
 * steps lit in aurora, the current one in brand. An ordered list with `aria-current="step"`.
 */
export function Stepper({
  steps,
  current,
  label,
  className,
}: {
  steps: readonly string[];
  /** Index of the current step; `steps.length` when everything is done. */
  current: number;
  label: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <ol aria-label={label} className={cn('flex items-center gap-2', className)}>
      {steps.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li
            key={s}
            aria-current={now ? 'step' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 last:flex-none"
          >
            <span
              className={cn(
                'grid size-7 flex-none place-items-center rounded-full text-caption font-bold tabular-nums transition-[background-color,color] duration-[var(--dur-base)]',
                done && 'bg-aurora text-on-aurora',
                now && 'bg-brand text-on-brand shadow-[0_0_0_4px_var(--brand-surface)]',
                !done && !now && 'border border-line-strong text-fg-3',
              )}
            >
              {done ? <Check className="size-4" strokeWidth={3} aria-hidden /> : i + 1}
            </span>
            {/* Phones show only the current step's name (three names did not fit); the others stay
                available to screen readers. */}
            <span
              className={cn(
                'truncate text-meta font-semibold',
                done || now ? 'text-fg' : 'text-fg-3',
                !now && 'max-sm:sr-only',
              )}
            >
              {s}
              {done && <span className="sr-only"> ({t('common.stepDone')})</span>}
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn('h-px min-w-3 flex-1', done ? 'bg-aurora' : 'bg-line-strong')}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
