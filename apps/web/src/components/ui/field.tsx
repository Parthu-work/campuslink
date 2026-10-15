import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn';

const inputClass =
  'min-h-[50px] w-full rounded-[var(--radius-md)] border border-line-strong bg-surface-1 px-4 text-base text-fg placeholder:text-fg-3 transition-shadow focus:border-brand focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--brand)_22%,transparent)] aria-[invalid=true]:border-danger';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Label + control + hint + error, with ids wired for screen readers. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const describedBy =
    [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-fg-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-xs font-medium text-danger">
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
    <textarea ref={ref} className={cn(inputClass, 'min-h-[88px] py-3', className)} {...props} />
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
          className="absolute inset-y-0 right-1 my-auto grid size-11 place-items-center rounded-full text-fg-2 hover:text-fg"
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
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-[13px] leading-snug text-fg-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={describedBy}
        className="mt-0.5 size-5 flex-none accent-[var(--brand)]"
      />
      <span>{children}</span>
    </label>
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputClass, 'pr-8', className)} {...props} />;
}
