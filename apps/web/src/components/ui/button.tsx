import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { buttonVariants } from './button-variants';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

/**
 * A button (ADR 0015). While `loading`, the label stays in place but invisible and a spinner sits
 * over it, so the button keeps its width; it stays focusable (focus never drops to the page,
 * A11Y-6) but ignores clicks and implicit form submission.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, type, onClick, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size }), 'aria-busy:cursor-progress', className)}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...props}
    >
      {loading ? (
        <>
          <span className="invisible inline-flex items-center gap-2">{children}</span>
          <span className="absolute inset-0 grid place-items-center" aria-hidden>
            <Loader2 className="animate-spin motion-reduce:animate-none" />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  ),
);
Button.displayName = 'Button';
