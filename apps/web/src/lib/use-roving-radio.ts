import { useRef, type KeyboardEvent } from 'react';

/**
 * Keyboard and focus for a custom radio group (`role="radiogroup"` of buttons): arrow keys move and
 * select like native radios, Home and End jump, and only the selected option (or the first enabled
 * one) is in the tab order. Spread `radio(i)` on each option.
 */
export function useRovingRadio<T>({
  values,
  value,
  onChange,
  isDisabled = () => false,
}: {
  values: readonly T[];
  value: T | null;
  onChange: (v: T) => void;
  isDisabled?: (i: number) => boolean;
}) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const enabled = values.map((_, i) => i).filter((i) => !isDisabled(i));
  const current = values.findIndex((v) => v === value);
  const focusable = current >= 0 && !isDisabled(current) ? current : (enabled[0] ?? 0);

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const edge = e.key === 'Home' ? enabled[0] : e.key === 'End' ? enabled.at(-1) : undefined;
    if (step === undefined && edge === undefined) return;
    e.preventDefault();
    const at = enabled.indexOf(i);
    const next = edge ?? enabled[(at + (step ?? 0) + enabled.length) % enabled.length] ?? 0;
    const v = values[next];
    if (v === undefined) return;
    onChange(v);
    refs.current[next]?.focus();
  };

  return (i: number) => ({
    ref: (el: HTMLElement | null) => {
      refs.current[i] = el;
    },
    type: 'button' as const,
    role: 'radio' as const,
    'aria-checked': values[i] === value,
    disabled: isDisabled(i),
    tabIndex: i === focusable ? 0 : -1,
    onKeyDown: (e: KeyboardEvent) => onKeyDown(e, i),
    onClick: () => {
      const v = values[i];
      if (v !== undefined) onChange(v);
    },
  });
}
