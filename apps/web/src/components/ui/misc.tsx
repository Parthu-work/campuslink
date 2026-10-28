import { useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { accentOf } from '../../lib/accent';
import { initialsOf } from '../../lib/names';
import { cn } from '../../lib/cn';

/** A filter or toggle chip (`aria-pressed`), 44px tall. */
export function Chip({
  pressed,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        'inline-flex min-h-11 flex-none items-center gap-1.5 rounded-full border border-line-strong px-4 text-meta font-semibold text-fg-2 transition-[background-color,color,border-color,scale] duration-[var(--dur-fast)] ease-snappy hover:text-fg active:scale-[var(--press-scale)] [&_svg]:size-4',
        'aria-pressed:border-brand aria-pressed:bg-brand-surface aria-pressed:text-fg',
        className,
      )}
      {...props}
    />
  );
}

type Tone = 'neutral' | 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-2',
  brand: 'bg-brand-surface text-brand-ink',
  accent: 'bg-accent-surface text-accent-ink',
  success: 'bg-success-surface text-success-ink',
  warning: 'bg-warning-surface text-warning-ink',
  danger: 'bg-danger-surface text-danger-ink',
  info: 'bg-info-surface text-info-ink',
};
/** Sans by default; `mono` only for records (batch years, roll numbers, scores) (audit TY-2). */
export function Badge({
  tone = 'neutral',
  mono = false,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; mono?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption leading-relaxed font-semibold tabular-nums [&_svg]:size-3.5',
        mono && 'font-mono font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

type CardVariant = 'flat' | 'raised' | 'interactive' | 'featured';
const cardVariants: Record<CardVariant, string> = {
  flat: '',
  raised: 'shadow-elev-1',
  // A card that is (or holds) a link: lifts on hover.
  interactive:
    'shadow-elev-1 transition-[box-shadow,border-color] duration-[var(--dur-base)] hover:border-line-strong hover:shadow-elev-2',
  // The aurora hairline: for the moments ADR 0008 lists (One Useful Thing, a streak, a celebration).
  featured: 'aurora-border shadow-elev-2',
};
export function Card({
  className,
  variant = 'flat',
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: CardVariant }) {
  return (
    // min-w-0: a card inside a grid or flex row never grows past its track (audit A11Y-4).
    <div
      className={cn(
        'min-w-0 rounded-[var(--radius-lg)] border border-line bg-surface-1',
        cardVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

/** A placeholder in the shape of what is coming; a soft sheen sweeps across it (transform only). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      // Marks loading placeholders for the re-audit's frame probe (e2e/audit/journeys.audit.ts).
      data-skeleton=""
      className={cn(
        'relative overflow-hidden rounded-[var(--radius-sm)] bg-surface-2',
        'after:absolute after:inset-0 after:-translate-x-full after:bg-[linear-gradient(90deg,transparent,color-mix(in_oklch,var(--fg)_6%,transparent),transparent)] after:animate-[sheen_calc(1.4s*var(--motion-scale))_ease-in-out_infinite] motion-reduce:after:hidden',
        className,
      )}
    />
  );
}

export function EmptyState({
  icon,
  art,
  title,
  children,
  action,
}: {
  /** A small icon in a tinted circle; `art` (an Illustration) takes its place when given. */
  icon?: ReactNode;
  art?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-3 px-5 py-10 text-center">
      {art ??
        (icon && (
          <span
            className="grid size-14 place-items-center rounded-full bg-brand-surface text-brand-ink [&_svg]:size-6"
            aria-hidden
          >
            {icon}
          </span>
        ))}
      <h3 className="text-title font-semibold text-balance">{title}</h3>
      {children && <div className="max-w-[46ch] text-fg-2">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Avatar({
  name,
  size = 44,
  verified = false,
}: {
  name: string;
  size?: number;
  verified?: boolean;
}) {
  const n = accentOf(name);
  const initials = initialsOf(name);
  return (
    <span
      aria-hidden
      className="relative grid flex-none place-items-center rounded-full font-display font-bold ring-1 ring-line"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `var(--subject-${n}-surface)`,
        color: `var(--subject-${n}-ink)`,
      }}
    >
      {initials}
      {verified && <VerifiedTick />}
    </span>
  );
}

/** The verified tick on an avatar's corner. */
export function VerifiedTick() {
  return (
    <span className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full border-2 border-surface-1 bg-brand">
      <svg viewBox="0 0 24 24" className="size-2.5 fill-none stroke-on-brand stroke-[3.5]">
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

/**
 * The college's mark: its uploaded logo (contained in a square, transparency kept), or the monogram
 * on a hexagon in the college's colours when there is none or it fails to load.
 */
export function Crest({
  monogram,
  logoUrl,
  size = 40,
  label,
}: {
  monogram: string;
  logoUrl?: string | null;
  size?: number;
  label?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  if (logoUrl && failed !== logoUrl)
    return (
      <img
        src={logoUrl}
        alt={label ?? ''}
        width={size}
        height={size}
        decoding="async"
        className="flex-none object-contain"
        style={{ width: size, height: size }}
        onError={() => setFailed(logoUrl)}
      />
    );
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className="flex-none" {...a11y}>
      <path d="M20 2 36 11v18L20 38 4 29V11z" fill="var(--brand-2)" />
      <path d="M20 8 30 13.5v13L20 32 10 26.5v-13z" fill="var(--brand)" />
      <text
        x="20"
        y="24.5"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontWeight="800"
        fontSize={monogram.length > 2 ? 9 : 12}
        fill="var(--on-brand)"
      >
        {monogram}
      </text>
      <circle cx="30" cy="9" r="3" fill="var(--accent)" />
    </svg>
  );
}
