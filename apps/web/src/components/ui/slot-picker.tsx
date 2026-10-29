import { useState } from 'react';
import { useTranslation } from '../../i18n/react';
import { CalendarX } from 'lucide-react';
import { formatDay, formatTime, localDateKey, viewerTimezone } from '../../lib/format';
import { ChoiceGroup } from './choice-group';
import { EmptyState, Skeleton } from './misc';

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
      <legend className="mb-2 text-meta font-semibold">{label}</legend>
      <ChoiceGroup
        label={t('slots.day')}
        variant="chip"
        scroll
        value={day}
        options={days.map((d) => ({ value: d, label: formatDay(`${d}T12:00:00`) }))}
        onChange={setPicked}
      />
      <ChoiceGroup
        label={t('slots.time')}
        variant="chip"
        value={value}
        options={times.map((s) => ({ value: s, label: formatTime(s) }))}
        onChange={onChange}
      />
      <p className="text-caption text-fg-3">{t('slots.inYourTime', { tz: viewerTimezone() })}</p>
    </fieldset>
  );
}
