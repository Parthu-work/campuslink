import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Check, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn';

/** Text controls: 48px tall, a calm border that turns brand with a soft ring on focus. */
const inputClass =
  'min-h-12 w-full rounded-[var(--radius-md)] border border-line-strong bg-surface-1 px-4 text-body text-fg placeholder:text-fg-3 transition-[border-color,box-shadow] duration-[var(--dur-fast)] hover:border-[color-mix(in_oklch,var(--line-strong),var(--fg)_20%)] focus:border-brand focus:shadow-[0_0_0_4px_color-mix(in_oklch,var(--brand)_22%,transparent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_4px_color-mix(in_oklch,var(--danger)_20%,transparent)]';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  /** Shown after the label, quieter: "Optional", a character count. */
  aside?: ReactNode;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Label + control + hint + error, with ids wired for screen readers. */
export function Field({ label, hint, error, aside, children }: FieldProps) {
  const id = useId();
  const describedBy =
    [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-meta font-semibold text-fg">
          {label}
        </label>
        {aside && <span className="text-caption text-fg-3">{aside}</span>}
      </div>
      {children({ id, describedBy, invalid: !!error })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-caption text-fg-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-caption font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(inputClass, className)} {...props} />,
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(inputClass, 'min-h-[88px] py-3 leading-relaxed', className)}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    const [shown, setShown] = useState(false);
    const { t } = useTranslation();
    return (
      <div className="relative">
        <input
          ref={ref}
          type={shown ? 'text' : 'password'}
          className={cn(inputClass, 'pr-12', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="absolute inset-y-0 right-0.5 my-auto grid size-11 place-items-center rounded-full text-fg-2 hover:bg-hover hover:text-fg"
          aria-label={shown ? t('common.hidePassword') : t('common.showPassword')}
          aria-pressed={shown}
        >
          {shown ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';

/** A real checkbox (keyboard, forms, screen readers) drawn as a rounded box with a check. */
export function Checkbox({
  id,
  checked,
  onChange,
  children,
  describedBy,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  describedBy?: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-meta leading-snug text-fg-2"
    >
      <span className="relative mt-0.5 grid size-5 flex-none place-items-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={describedBy}
          className="peer size-5 cursor-pointer appearance-none rounded-[var(--radius-xs)] border-2 border-line-strong bg-surface-1 transition-colors duration-[var(--dur-fast)] checked:border-brand checked:bg-brand"
        />
        <Check
          className="pointer-events-none absolute size-3.5 scale-50 stroke-[3] text-on-brand opacity-0 transition-[scale,opacity] duration-[var(--dur-fast)] ease-snappy peer-checked:scale-100 peer-checked:opacity-100"
          aria-hidden
        />
      </span>
      <span>{children}</span>
    </label>
  );
}

/** The native select (best on phones), with its own chevron; `className` sizes the wrapper. */
/**
 * A native select (the platform picker on phones) with our chevron. `className` sizes the wrapper;
 * `size="sm"` is the compact 44px version for filter rows.
 */
export function Select({
  className,
  size = 'md',
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: 'md' | 'sm' }) {
  return (
    <span className={cn('relative block', className)}>
      <select
        className={cn(
          inputClass,
          'cursor-pointer appearance-none',
          size === 'sm' ? 'min-h-11 pr-9 pl-3 text-meta' : 'pr-11',
        )}
        {...props}
      />
      <ChevronDown
        className={cn(
          'pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-fg-3',
          size === 'sm' ? 'right-3' : 'right-4',
        )}
        aria-hidden
      />
    </span>
  );
}
