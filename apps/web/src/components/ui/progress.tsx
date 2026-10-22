import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'brand' | 'aurora' | 'success' | 'warning' | 'danger' | 'neutral';
const fills: Record<Tone, string> = {
  brand: 'bg-brand',
  aurora: 'bg-aurora',
  success: 'bg-success-fg',
  warning: 'bg-warning-fg',
  danger: 'bg-danger-fg',
  neutral: 'bg-fg-3',
};
const strokes: Record<Exclude<Tone, 'aurora'>, string> = {
  brand: 'var(--brand)',
  success: 'var(--success-fg)',
  warning: 'var(--warning-fg)',
  danger: 'var(--danger-fg)',
  neutral: 'var(--fg-3)',
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * A progress bar that fills from empty on first paint and glides to new values (scaleX, transform
 * only), replacing six hand-built bars (audit DS-3). With a `label` it is a progressbar for screen
 * readers (`valueText` reads the value); without one it is a decorative magnitude next to text that
 * already says the number (poll results, chart rows).
 */
export function ProgressBar({
  value,
  max = 1,
  label,
  valueText,
  tone = 'brand',
  size = 'md',
  className,
}: {
  value: number;
  max?: number;
  label?: string;
  valueText?: string;
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const ratio = max > 0 ? clamp01(value / max) : 0;
  const a11y = label
    ? {
        role: 'progressbar',
        'aria-label': label,
        'aria-valuemin': 0,
        'aria-valuemax': max,
        'aria-valuenow': Math.min(max, Math.max(0, value)),
        'aria-valuetext': valueText,
      }
    : { 'aria-hidden': true };
  return (
    <div
      {...a11y}
      className={cn(
        'overflow-hidden rounded-full bg-surface-3',
        size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2',
        className,
      )}
    >
      <div
        className={cn(
          'fill-in h-full rounded-full transition-transform duration-[var(--dur-smooth)] ease-smooth',
          fills[tone],
        )}
        style={{ transform: `scaleX(${ratio})` }}
      />
    </div>
  );
}

/**
 * A ring for a single figure (syllabus coverage, XP to the next level). Drawn once at its value; it
 * enters with a scale and fade (transform and opacity only). `children` sit in the middle.
 */
export function ProgressRing({
  value,
  max = 1,
  label,
  valueText,
  size = 64,
  stroke = 6,
  tone = 'brand',
  children,
  className,
}: {
  value: number;
  max?: number;
  label: string;
  valueText?: string;
  size?: number;
  stroke?: number;
  tone?: Tone;
  children?: ReactNode;
  className?: string;
}) {
  const ratio = max > 0 ? clamp01(value / max) : 0;
  const r = (size - stroke) / 2;
  // Each ring's gradient needs its own id (several rings can share a screen).
  const gradient = `ring${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(max, Math.max(0, value))}
      aria-valuetext={valueText}
      className={cn('ring-in relative inline-grid flex-none place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        {tone === 'aurora' && (
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--aurora-1)" />
              <stop offset="0.5" stopColor="var(--aurora-2)" />
              <stop offset="1" stopColor="var(--aurora-3)" />
            </linearGradient>
          </defs>
        )}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={stroke}
        />
        {ratio > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={tone === 'aurora' ? `url(#${gradient})` : strokes[tone]}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${ratio * 100} 100`}
          />
        )}
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center">{children}</div>}
    </div>
  );
}
