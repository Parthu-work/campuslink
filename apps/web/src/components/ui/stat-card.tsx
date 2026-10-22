import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** A tiny line for a stat's recent trend; decorative (the value is what is read out). */
function Sparkline({ points }: { points: readonly number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * 100},${28 - ((p - min) / span) * 24}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full text-brand-ink" aria-hidden>
      <polyline
        points={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const tones = {
  default: '',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  brand: 'text-brand-ink',
} as const;

/** A row of figures: a description list, so each label is read with its value. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid grid-cols-2 gap-3 md:grid-cols-4', className)}>{children}</dl>;
}

/**
 * One figure with its label, replacing six hand-built stat tiles (audit DS-3). Lives in a
 * `StatGrid`. Values use tabular numerals; a sparkline is optional and only ever decorative.
 * `size="sm"` is the compact tile for dense panels (imports, the mentor's impact card).
 */
export function StatCard({
  label,
  value,
  icon,
  hint,
  trend,
  tone = 'default',
  size = 'md',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  trend?: readonly number[];
  tone?: keyof typeof tones;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid min-w-0 content-start gap-1',
        size === 'md'
          ? 'rounded-[var(--radius-lg)] border border-line bg-surface-1 p-4 shadow-elev-1'
          : 'rounded-[var(--radius-md)] bg-surface-2 p-3',
        className,
      )}
    >
      <dt className="flex items-center gap-1.5 text-meta font-semibold text-fg-2 [&_svg]:size-4 [&_svg]:flex-none [&_svg]:text-brand-ink">
        {icon}
        {label}
      </dt>
      <dd
        className={cn(
          'font-display leading-tight font-bold tabular-nums',
          size === 'md' ? 'text-headline' : 'text-title',
          tones[tone],
        )}
      >
        {value}
      </dd>
      {hint && <dd className="text-caption text-fg-3">{hint}</dd>}
      {trend && (
        <dd>
          <Sparkline points={trend} />
        </dd>
      )}
    </div>
  );
}
