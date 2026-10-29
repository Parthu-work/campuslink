import { useId } from 'react';
import { AUDIENCE_ROLES, BRANCHES, MAX_PIN_DAYS, URGENT_ANNOUNCEMENTS_PER_MONTH } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Field, Input, Select } from '../../components/ui/field';
import { Chip } from '../../components/ui/misc';
import { Switch } from '../../components/ui/switch';
import { useFeature } from '../../lib/tenant-context';
import type { AnnouncementOptionsValue } from '../../lib/announcements';

const PIN_CHOICES = [0, 1, 3, 7, 14, MAX_PIN_DAYS];

/**
 * B6: who an official announcement is for (nothing picked = everyone), how long it stays pinned
 * at the top of For you, and whether it also goes out on WhatsApp (urgent ones skip members'
 * weekly caps, a few a month).
 */
export function AnnouncementOptions({
  value,
  onChange,
}: {
  value: AnnouncementOptionsValue;
  onChange: (v: AnnouncementOptionsValue) => void;
}) {
  const { t } = useTranslation();
  const whatsapp = useFeature('whatsapp');
  const yearsId = useId();
  const set = (patch: Partial<AnnouncementOptionsValue>) => onChange({ ...value, ...patch });
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  return (
    <fieldset className="grid gap-4 rounded-[var(--radius-md)] border border-line p-4">
      <legend className="px-1 text-meta font-semibold">{t('announce.title')}</legend>
      <div className="grid gap-2">
        <p className="text-meta font-semibold" id={`${yearsId}-branches`}>
          {t('announce.branches')}
        </p>
        <div role="group" aria-labelledby={`${yearsId}-branches`} className="flex flex-wrap gap-2">
          {BRANCHES.map((b) => (
            <Chip
              key={b}
              pressed={value.branches.includes(b)}
              onClick={() => set({ branches: toggle(value.branches, b) })}
            >
              {b}
            </Chip>
          ))}
        </div>
      </div>
      <Field label={t('announce.years')} hint={t('announce.yearsHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            inputMode="numeric"
            aria-describedby={describedBy}
            value={value.years}
            onChange={(e) => set({ years: e.target.value.replace(/[^\d,\s]/g, '') })}
          />
        )}
      </Field>
      <div className="grid gap-2">
        <p className="text-meta font-semibold" id={`${yearsId}-roles`}>
          {t('announce.roles')}
        </p>
        <div role="group" aria-labelledby={`${yearsId}-roles`} className="flex flex-wrap gap-2">
          {AUDIENCE_ROLES.map((r) => (
            <Chip
              key={r}
              pressed={value.roles.includes(r)}
              onClick={() => set({ roles: toggle(value.roles, r) })}
            >
              {t(`role.${r}`)}
            </Chip>
          ))}
        </div>
      </div>
      <p className="text-caption text-fg-3">{t('announce.everyoneHint')}</p>
      <Field label={t('announce.pin')}>
        {({ id }) => (
          <Select
            id={id}
            value={String(value.pinDays)}
            onChange={(e) => set({ pinDays: Number(e.target.value) })}
          >
            {PIN_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d ? t('announce.pinDays', { count: d }) : t('announce.noPin')}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {whatsapp && (
        <>
          <Switch
            checked={value.sendWhatsApp}
            onChange={(on) => set({ sendWhatsApp: on, urgent: on && value.urgent })}
            label={t('announce.whatsapp')}
            description={t('announce.whatsappHint')}
          />
          <Switch
            checked={value.urgent}
            disabled={!value.sendWhatsApp}
            onChange={(on) => set({ urgent: on })}
            label={t('announce.urgent')}
            description={t('announce.urgentHint', { count: URGENT_ANNOUNCEMENTS_PER_MONTH })}
          />
        </>
      )}
    </fieldset>
  );
}
