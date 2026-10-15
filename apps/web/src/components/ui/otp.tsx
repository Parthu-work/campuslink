import { useRef } from 'react';

/** Six single-digit inputs with auto-advance, backspace and paste support. */
export function OtpInput({
  value,
  onChange,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  const set = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    onChange(next.join('').slice(0, 6));
  };
  return (
    <div role="group" aria-label={label} className="flex gap-2">
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
          className="aspect-[1/1.15] w-full max-w-[52px] rounded-[var(--radius-sm)] border border-line-strong bg-surface-1 text-center font-mono text-[22px] font-semibold focus:border-brand focus:ring-4 focus:ring-[color-mix(in_srgb,var(--brand)_22%,transparent)] focus:outline-none"
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
              onChange(p);
              refs.current[Math.min(p.length, 5)]?.focus();
            }
          }}
        />
      ))}
    </div>
  );
}
