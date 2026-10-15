import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarX } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatDay, formatTime, localDateKey, viewerTimezone } from '../../lib/format';
import { EmptyState, Skeleton } from './misc';

const chip =
  'min-h-11 rounded-full border px-3.5 text-sm font-semibold transition-[background-color,border-color,transform] duration-[var(--dur-fast)] active:scale-95 aria-checked:border-brand aria-checked:bg-[color-mix(in_srgb,var(--brand)_18%,transparent)] border-line-strong text-fg-2 aria-checked:text-fg';

/** Two-step picker: a day strip, then times on that day. All times are shown in the viewer's timezone. */
export function SlotPicker({
  slots,
  value,
  onChange,
  loading,
  label,
}: {
  slots: string[];
  value: string | null;
  onChange: (iso: string) => void;
  loading?: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  const days = [...new Set(slots.map(localDateKey))];
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked && days.includes(picked) ? picked : value ? localDateKey(value) : (days[0] ?? null);
  if (loading)
    return (
      <div className="grid gap-2" aria-busy>
        <Skeleton className="h-11" />
        <Skeleton className="h-24" />
      </div>
    );
  if (!slots.length)
    return (
      <EmptyState icon={<CalendarX className="size-6" />} title={t('slots.none')}>
        {t('slots.noneBody')}
      </EmptyState>
    );
  const times = slots.filter((s) => localDateKey(s) === day);
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-[13px] font-semibold">{label}</legend>
      <div
        role="radiogroup"
        aria-label={t('slots.day')}
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
      >
        {days.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={d === day}
            onClick={() => setPicked(d)}
            className={cn(chip, 'flex-none')}
          >
            {formatDay(`${d}T12:00:00`)}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label={t('slots.time')} className="flex flex-wrap gap-2">
        {times.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === value}
            onClick={() => onChange(s)}
            className={chip}
          >
            {formatTime(s)}
          </button>
        ))}
      </div>
      <p className="text-xs text-fg-3">{t('slots.inYourTime', { tz: viewerTimezone() })}</p>
    </fieldset>
  );
}
