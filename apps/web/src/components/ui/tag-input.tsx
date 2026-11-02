import { useId, useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { X } from 'lucide-react';

/** Chips editor: Enter or comma adds, Backspace on empty removes the last, each chip has a remove button. */
export function TagInput({
  label,
  hint,
  value,
  onChange,
  max = 20,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (v: string[]) => void;
  max?: number;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft
      .trim()
      .replace(/[<>{}$]/g, '')
      .slice(0, 40);
    if (v && !value.includes(v) && value.length < max) onChange([...value, v]);
    setDraft('');
  };
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-meta font-semibold">
        {label}
      </label>
      <div className="flex min-h-[50px] flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] border border-line-strong bg-surface-1 px-2 py-1.5 focus-within:border-brand focus-within:ring-4 focus-within:ring-[color-mix(in_srgb,var(--brand)_22%,transparent)]">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-3 text-meta"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== tag))}
              className="-my-1 grid size-8 place-items-center rounded-full hover:bg-surface-3"
              aria-label={t('common.removeTag', { tag })}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={add}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="min-w-[8ch] flex-1 bg-transparent px-2 py-1.5 text-body outline-none"
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-caption text-fg-3">
          {hint}
        </p>
      )}
    </div>
  );
}
