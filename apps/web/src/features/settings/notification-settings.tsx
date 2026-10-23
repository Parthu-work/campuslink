import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { BellRing } from 'lucide-react';
import { CHANNELS, NOTIFICATION_CATEGORIES, type NotificationPrefs } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Checkbox, Field, Input, Select } from '../../components/ui/field';
import { Card, Skeleton } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../../lib/push';

function PushCard() {
  const { t } = useTranslation();
  const cfg = useQuery({
    queryKey: ['push-config'],
    queryFn: () => api.get<{ enabled: boolean; publicKey: string | null }>('/notifications/push/config'),
  });
  const sub = useQuery({
    queryKey: ['push-sub'],
    queryFn: async () => !!(await currentSubscription()),
    enabled: pushSupported(),
  });
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: async () => {
      if (sub.data) return disablePush().then(() => 'disabled' as const);
      return enablePush(cfg.data?.publicKey ?? '');
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['push-sub'] });
      if (r === 'denied') toast.error(t('notifications.pushDenied'));
      if (r === 'unavailable') toast.error(t('notifications.pushUnavailable'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const available = pushSupported() && !!cfg.data?.enabled && !!cfg.data.publicKey;
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <BellRing className="size-6 flex-none text-accent-ink" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">{t('notifications.push')}</h2>
        <p className="text-meta text-fg-2">
          {!available
            ? t('notifications.pushOff')
            : sub.data
              ? t('notifications.pushOn')
              : t('notifications.pushBody')}
        </p>
      </div>
      {available && (
        <Button loading={toggle.isPending} onClick={() => toggle.mutate()}>
          {sub.data ? t('notifications.pushDisable') : t('notifications.pushEnable')}
        </Button>
      )}
    </Card>
  );
}

function PrefsForm({ initial }: { initial: NotificationPrefs }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [p, setP] = useState(initial);
  const save = useMutation({
    mutationFn: () => api.put('/me/notification-preferences', p),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notification-prefs'] });
      toast.success(t('common.saved'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Card className="grid gap-5 p-5">
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t('notifications.channels')}>
        <table className="w-full min-w-[420px] text-meta">
          <caption className="mb-2 text-left font-semibold">{t('notifications.channels')}</caption>
          <thead>
            <tr className="text-left text-fg-3">
              <th scope="col" className="py-2 font-medium">
                {t('notifications.category')}
              </th>
              {CHANNELS.map((c) => (
                <th key={c} scope="col" className="py-2 text-center font-medium">
                  {t(`notifications.channel.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.map((cat) => (
              <tr key={cat} className="border-t border-line">
                <th scope="row" className="py-3 pr-3 text-left font-semibold">
                  {t(`notifications.cat.${cat}`)}
                  <span className="block text-caption font-normal text-fg-3">
                    {t(`notifications.catHint.${cat}`)}
                  </span>
                </th>
                {CHANNELS.map((c) => (
                  <td key={c} className="text-center">
                    <input
                      type="checkbox"
                      aria-label={t('notifications.toggle', {
                        channel: t(`notifications.channel.${c}`),
                        category: t(`notifications.cat.${cat}`),
                      })}
                      checked={p.channels[cat][c]}
                      onChange={(e) =>
                        setP({
                          ...p,
                          channels: { ...p.channels, [cat]: { ...p.channels[cat], [c]: e.target.checked } },
                        })
                      }
                      className="size-5 accent-[var(--brand)]"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <fieldset className="grid gap-3">
        <legend className="mb-2 font-semibold">{t('notifications.quiet')}</legend>
        <Checkbox
          id="quiet"
          checked={p.quietHours.enabled}
          onChange={(v) => setP({ ...p, quietHours: { ...p.quietHours, enabled: v } })}
        >
          {t('notifications.quietBody')}
        </Checkbox>
        {p.quietHours.enabled && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('notifications.quietFrom')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="time"
                  value={p.quietHours.start}
                  onChange={(e) => setP({ ...p, quietHours: { ...p.quietHours, start: e.target.value } })}
                />
              )}
            </Field>
            <Field label={t('notifications.quietTo')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="time"
                  value={p.quietHours.end}
                  onChange={(e) => setP({ ...p, quietHours: { ...p.quietHours, end: e.target.value } })}
                />
              )}
            </Field>
            <Field label={t('mentor.timezone')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={p.quietHours.timezone}
                  onChange={(e) => setP({ ...p, quietHours: { ...p.quietHours, timezone: e.target.value } })}
                >
                  {Intl.supportedValuesOf('timeZone').map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
        <p className="text-caption text-fg-3">{t('notifications.quietNote')}</p>
      </fieldset>
      <Button
        variant="primary"
        className="justify-self-start"
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        {t('common.save')}
      </Button>
    </Card>
  );
}

export function NotificationSettings() {
  const q = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: () => api.get<NotificationPrefs>('/me/notification-preferences'),
  });
  return (
    <>
      <PushCard />
      {q.data ? <PrefsForm initial={q.data} /> : <Skeleton className="h-72" />}
    </>
  );
}
