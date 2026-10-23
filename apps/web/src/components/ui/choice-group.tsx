import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useRovingRadio } from '../../lib/use-roving-radio';

export interface Choice<T extends string> {
  value: T;
  label: ReactNode;
  /** A second line (cards) or trailing text (chips): a duration, a count. */
  detail?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

/**
 * One choice from a few (`role="radiogroup"`), as cards or chips, replacing the hand-built
 * radio-cards (audit DS-3). Arrow keys move and select, like native radios; only the selected
 * option is in the tab order.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  variant = 'card',
  columns = 2,
  scroll = false,
  className,
}: {
  label: string;
  value: T | null;
  options: readonly Choice<T>[];
  onChange: (v: T) => void;
  variant?: 'card' | 'chip';
  /** Card grid columns from the small breakpoint up (one column on phones). */
  columns?: 1 | 2 | 3;
  /** Chips in one row that scrolls sideways (a day strip) instead of wrapping. */
  scroll?: boolean;
  className?: string;
}) {
  const radio = useRovingRadio({
    values: options.map((o) => o.value),
    value,
    onChange,
    isDisabled: (i) => !!options[i]?.disabled,
  });

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        variant === 'chip'
          ? scroll
            ? '-mx-1 flex gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:flex-none'
            : 'flex flex-wrap gap-2'
          : cn('grid gap-2', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3'),
        className,
      )}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          {...radio(i)}
          className={cn(
            'transition-[background-color,border-color,color,scale] duration-[var(--dur-fast)] ease-snappy active:scale-[var(--press-scale)] disabled:cursor-not-allowed disabled:opacity-50',
            'aria-checked:border-brand aria-checked:bg-brand-surface aria-checked:text-fg',
            variant === 'chip'
              ? 'inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong px-4 text-meta font-semibold text-fg-2 hover:border-[color-mix(in_oklch,var(--line-strong),var(--fg)_25%)]'
              : // Wraps: a short detail sits on the right, a long one drops below the label.
                'flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[var(--radius-md)] border border-line-strong bg-surface-1 px-4 py-2.5 text-left hover:bg-surface-2',
          )}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            {o.icon && (
              <span
                className={cn(
                  'flex-none text-brand-ink',
                  variant === 'chip' ? '[&_svg]:size-4' : '[&_svg]:size-5',
                )}
              >
                {o.icon}
              </span>
            )}
            <span className={cn('min-w-0', variant === 'card' && 'font-semibold text-fg')}>{o.label}</span>
          </span>
          {o.detail && (
            <span
              className={cn('text-fg-2', variant === 'card' ? 'min-w-0 text-meta' : 'flex-none text-caption')}
            >
              {o.detail}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
