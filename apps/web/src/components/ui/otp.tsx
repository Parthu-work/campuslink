import { useRef } from 'react';

/**
 * Six single-digit boxes with auto-advance, backspace, paste and the platform's one-time-code
 * autofill; the focused box gets the same soft ring as text inputs.
 */
export function OtpInput({
  value,
  onChange,
  label,
  autoFocus,
  onComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoFocus?: boolean;
  /** Called once all six digits are in (typed or pasted), so the form can submit itself (FO-6). */
  onComplete?: (code: string) => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  const update = (code: string) => {
    onChange(code);
    if (/^\d{6}$/.test(code)) onComplete?.(code);
  };
  const set = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    update(next.join('').slice(0, 6));
  };
  return (
    <div role="group" aria-label={label} className="flex justify-center gap-2 sm:gap-2.5">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={`${label} ${i + 1}`}
          autoFocus={autoFocus && i === 0}
          className="aspect-[1/1.2] w-full max-w-14 min-w-0 rounded-[var(--radius-md)] border border-line-strong bg-surface-1 text-center font-mono text-headline font-semibold caret-brand transition-[border-color,box-shadow] duration-[var(--dur-fast)] focus:border-brand focus:shadow-[0_0_0_4px_color-mix(in_oklch,var(--brand)_22%,transparent)] focus:outline-none"
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(-1);
            set(i, v);
            if (v) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            const p = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
            if (p.length > 1) {
              e.preventDefault();
              update(p);
              refs.current[Math.min(p.length, 5)]?.focus();
            }
          }}
        />
      ))}
    </div>
  );
}
