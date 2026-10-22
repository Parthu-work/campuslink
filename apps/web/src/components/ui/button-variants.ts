import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border font-semibold transition-[transform,background-color,border-color] duration-[var(--dur-fast)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'border-transparent bg-brand text-on-brand hover:bg-[color-mix(in_srgb,var(--brand)_88%,white)]',
        accent:
          'border-transparent bg-accent text-on-accent hover:bg-[color-mix(in_srgb,var(--accent)_88%,white)]',
        secondary: 'border-line-strong bg-surface-2 text-fg hover:bg-surface-3',
        ghost: 'border-transparent bg-transparent text-fg hover:bg-surface-2',
        danger: 'border-transparent bg-danger-fill text-on-danger hover:opacity-90',
      },
      size: {
        sm: 'min-h-9 px-3.5 text-[13px]',
        md: 'min-h-11 px-[18px] text-sm',
        lg: 'min-h-[54px] px-[26px] text-base',
        icon: 'size-11 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);
