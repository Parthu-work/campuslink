import { cva } from 'class-variance-authority';

/**
 * Buttons (ADR 0008). Every size keeps a 44px touch target; smaller sizes are smaller type and
 * padding, not a smaller target. Hovered fills are generated tokens that move away from their label
 * colour (contrast only grows); a press scales to 0.97 on the snappy spring.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-full border font-semibold whitespace-nowrap transition-[scale,background-color,border-color,color,filter] duration-[var(--dur-fast)] ease-snappy active:scale-[var(--press-scale)] disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-70 [&_svg]:flex-none',
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-brand text-on-brand shadow-elev-1 hover:bg-brand-hover',
        accent: 'border-transparent bg-accent text-on-accent shadow-elev-1 hover:bg-accent-hover',
        secondary: 'border-line-strong bg-surface-2 text-fg hover:bg-surface-3',
        outline: 'border-line-strong bg-transparent text-fg hover:bg-hover',
        ghost: 'border-transparent bg-transparent text-fg hover:bg-hover',
        danger: 'border-transparent bg-danger-fill text-on-danger hover:brightness-90',
        /** The signature moments only (Create, Ask): never for ordinary actions. */
        aurora: 'border-transparent bg-aurora text-on-aurora shadow-elev-2 hover:brightness-105',
      },
      size: {
        sm: 'min-h-11 px-4 text-meta',
        md: 'min-h-12 px-5 text-body',
        lg: 'min-h-14 px-7 text-lead',
        icon: 'size-11 p-0',
        'icon-lg': 'size-14 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);
