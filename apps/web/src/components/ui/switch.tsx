import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * An on/off setting (`role="switch"`), replacing the hand-built toggles (audit DS-3). The label and
 * optional description sit beside it and are part of the 44px tap target.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      // Named by the label alone; the description is read after it.
      aria-labelledby={`${id}-label`}
      aria-describedby={description ? `${id}-description` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'group flex min-h-11 w-full items-center justify-between gap-4 rounded-[var(--radius-sm)] py-1 text-left disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    >
      <span className="grid min-w-0 gap-0.5">
        <span id={`${id}-label`} className="text-body font-medium text-fg">
          {label}
        </span>
        {description && (
          <span id={`${id}-description`} className="text-meta text-fg-2">
            {description}
          </span>
        )}
      </span>
      <span
        aria-hidden
        className="relative h-7 w-12 flex-none rounded-full border border-line-strong bg-surface-3 transition-colors duration-[var(--dur-fast)] group-aria-checked:border-transparent group-aria-checked:bg-brand"
      >
        <span className="absolute top-0.5 left-0.5 size-[22px] rounded-full bg-fg-2 shadow-elev-1 transition-[translate,background-color] duration-[var(--dur-snappy)] ease-snappy group-aria-checked:translate-x-5 group-aria-checked:bg-on-brand" />
      </span>
    </button>
  );
}
