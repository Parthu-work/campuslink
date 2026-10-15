import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

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
        'inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[13px] font-medium text-fg-2 transition-[background-color,color,border-color,transform] duration-[var(--dur-fast)] active:scale-95',
        'aria-pressed:border-brand aria-pressed:bg-[color-mix(in_srgb,var(--brand)_18%,transparent)] aria-pressed:text-fg',
        className,
      )}
      {...props}
    />
  );
}

type Tone = 'neutral' | 'brand' | 'accent' | 'success' | 'warning' | 'danger';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-2',
  brand: 'bg-[color-mix(in_srgb,var(--brand)_16%,transparent)] text-brand-ink',
  accent: 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-accent-ink',
  success: 'bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-success',
  warning: 'bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] text-warning',
  danger: 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-danger',
};
export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] leading-relaxed font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-[var(--radius-md)] border border-line bg-surface-1', className)} {...props} />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-[var(--radius-sm)] bg-surface-2 motion-reduce:animate-none',
        className,
      )}
    />
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-2.5 px-5 py-8 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-surface-2 text-brand-ink" aria-hidden>
        {icon}
      </span>
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <div className="max-w-[46ch] text-fg-2">{children}</div>}
      {action}
    </div>
  );
}

function hue(s: string) {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
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
  const h = hue(name);
  const initials = name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      aria-hidden
      className="relative grid flex-none place-items-center rounded-full font-display font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background: `linear-gradient(135deg, hsl(${h} 70% 50%), hsl(${h + 60} 65% 38%))`,
      }}
    >
      {initials}
      {verified && (
        <span className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full border-2 border-surface-1 bg-brand">
          <svg viewBox="0 0 24 24" className="size-2.5 fill-none stroke-on-brand stroke-[3.5]">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </span>
      )}
    </span>
  );
}

/** College crest: monogram on a hexagon in tenant colours (logo uploads arrive in Phase 2). */
export function Crest({ monogram, size = 40, label }: { monogram: string; size?: number; label?: string }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
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
