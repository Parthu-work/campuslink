import { cva } from 'class-variance-authority';

/**
 * Buttons (ADR 0015). Three sizes, one height each: S 36 (its hit area reaches 44 px through a
 * pseudo-element), M 44, L 52. Corners follow the height (8 for S, 12 for M and L); pills are for
 * small chips only. Variants: primary (the one main action of a screen), secondary (neutral),
 * tertiary (text only, for quiet actions in rows and toolbars) and danger. Hovered fills move away
 * from their label colour (contrast only grows); a press scales to 0.97 in 120 ms.
 *
 * `accent`, `outline`, `ghost` and `aurora` stay for existing screens: accent and aurora are the
 * signature moments only (Create, Ask); outline reads as secondary and ghost as tertiary.
 */
export const buttonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 border font-semibold whitespace-nowrap transition-[scale,background-color,border-color,color,filter] duration-[var(--dur-press)] ease-[var(--ease-standard)] active:scale-[var(--press-scale)] disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-70 [&_svg]:size-5 [&_svg]:flex-none',
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-brand text-on-brand hover:bg-brand-hover',
        secondary: 'border-line-strong bg-surface-1 text-fg hover:bg-surface-2',
        tertiary: 'border-transparent bg-transparent text-brand-ink hover:bg-hover',
        danger: 'border-transparent bg-danger-fill text-on-danger hover:brightness-90',
        accent: 'border-transparent bg-accent text-on-accent hover:bg-accent-hover',
        outline: 'border-line-strong bg-transparent text-fg hover:bg-hover',
        ghost: 'border-transparent bg-transparent text-fg hover:bg-hover',
        /** The signature moments only (Create, Ask): never for ordinary actions. */
        aurora: 'border-transparent bg-aurora text-on-aurora shadow-elev-2 hover:brightness-105',
      },
      size: {
        sm: 'min-h-9 rounded-[var(--radius-sm)] px-3.5 text-callout before:absolute before:inset-x-0 before:-inset-y-1 before:content-[""] [&_svg]:size-4',
        md: 'min-h-11 rounded-[var(--radius-md)] px-4 text-body',
        lg: 'min-h-13 rounded-[var(--radius-md)] px-6 text-body',
        icon: 'size-11 rounded-[var(--radius-md)] p-0',
        'icon-lg': 'size-13 rounded-[var(--radius-md)] p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);
