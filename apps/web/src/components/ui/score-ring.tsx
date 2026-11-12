import type { ReactNode } from 'react';
import { useTranslation } from '../../i18n/react';
import { ProgressRing } from './progress';

/**
 * One big figure as a ring (ADR 0015, readiness v2): the score in the display face, what it
 * measures, and the momentum beside it ("+6 this week") rather than the deficit. The ring is
 * a progressbar with the score as its text, so screen readers hear "48 out of 100".
 */
export function ScoreRing({
  score,
  max = 100,
  label,
  caption,
  delta,
  size = 168,
}: {
  score: number;
  max?: number;
  /** What the score measures ("Placement readiness"). */
  label: string;
  /** Under the number, short ("of 100"). */
  caption?: ReactNode;
  /** Momentum, positive framing ("+6 this week"); shown in success colours. */
  delta?: ReactNode;
  size?: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <ProgressRing
        value={score}
        max={max}
        size={size}
        stroke={Math.round(size / 14)}
        label={label}
        valueText={t('ui.scoreOutOf', { score, max })}
      >
        <span className="grid justify-items-center leading-none">
          <span className="font-display text-display font-bold tabular-nums">{score}</span>
          {caption && <span className="mt-1 text-caption text-fg-3">{caption}</span>}
        </span>
      </ProgressRing>
      {delta && (
        <span className="inline-flex min-h-8 items-center rounded-[var(--radius-sm)] bg-success-surface px-2.5 text-callout font-semibold text-success-ink">
          {delta}
        </span>
      )}
    </div>
  );
}
