import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Laptop, Smartphone } from 'lucide-react';
import { password as passwordSchema, SUPPORTED_LOCALES } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Field, PasswordInput } from '../../components/ui/field';
import { Badge, Card, Chip, Skeleton } from '../../components/ui/misc';
import { Dialog } from '../../components/ui/dialog';
import { FormError } from '../../components/layout/auth-layout';
import { MfaSetup } from '../auth/mfa-setup';
import { api } from '../../lib/api';
import { useMe } from '../../lib/me';
import { useSession } from '../../lib/session';
import { usePreferences, type MotionPref, type ThemePref } from '../../lib/preferences';
import { applyApiError } from '../../lib/errors';
import { cn } from '../../lib/cn';

export function SettingsLayout() {
  const { t } = useTranslation();
  const tabs = [
    ['/settings', t('settings.security')],
    ['/settings/privacy', t('settings.privacy')],
    ['/settings/preferences', t('settings.preferences')],
  ] as const;
  return (
    <>
      <h1 className="text-[clamp(26px,4vw,34px)] font-bold">{t('settings.title')}</h1>
      <nav
        aria-label={t('settings.title')}
        className="flex gap-1 overflow-x-auto rounded-full border border-line bg-surface-1 p-1"
      >
        {tabs.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              cn(
                'min-h-10 flex-none rounded-full px-4 py-2 text-sm font-semibold text-fg-2',
                isActive && 'bg-brand text-on-brand',
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}

const relative = (d: string, lng: string) => {
  const diff = (new Date(d).getTime() - Date.now()) / 60000;
  const rtf = new Intl.RelativeTimeFormat(lng, { numeric: 'auto' });
  if (Math.abs(diff) < 60) return rtf.format(Math.round(diff), 'minute');
  if (Math.abs(diff) < 1440) return rtf.format(Math.round(diff / 60), 'hour');
  return rtf.format(Math.round(diff / 1440), 'day');
};

export function SecuritySettings() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [mfaOpen, setMfaOpen] = useState(false);
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () =>
      api.get<{ id: string; device: string; lastUsedAt: string; current: boolean }[]>('/auth/sessions'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
  const revokeOthers = useMutation({
    mutationFn: () => api.post<{ revoked: number }>('/auth/sessions/revoke-others'),
    onSuccess: (r) => {
      toast.success(t('settings.signedOutOthers', { count: r.revoked }));
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  return (
    <div className="grid gap-5">
      <Card className="grid gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{t('settings.twoFactor')}</h2>
          <Badge tone={me?.mfaEnabled ? 'success' : 'neutral'}>
            {me?.mfaEnabled ? t('mfa.on') : t('mfa.off')}
          </Badge>
          {me?.mfaRequired && <Badge tone="accent">{t('mfa.requiredBadge')}</Badge>}
        </div>
        {!me?.mfaEnabled && (
          <Button variant="primary" className="justify-self-start" onClick={() => setMfaOpen(true)}>
            {t('mfa.enable')}
          </Button>
        )}
        <Dialog open={mfaOpen} onOpenChange={setMfaOpen} title={t('mfa.setupTitle')}>
          {mfaOpen && <MfaSetup onDone={() => setMfaOpen(false)} />}
        </Dialog>
      </Card>

      <Card className="grid gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('settings.sessions')}</h2>
          <Button
            size="sm"
            onClick={() => revokeOthers.mutate()}
            loading={revokeOthers.isPending}
            disabled={(sessions.data?.length ?? 0) < 2}
          >
            {t('settings.signOutOthers')}
          </Button>
        </div>
        {sessions.isLoading && <Skeleton className="h-16" />}
        <ul className="grid gap-2">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-[var(--radius-md)] bg-surface-2 p-3">
              {/Android|iOS/.test(s.device) ? (
                <Smartphone className="size-5 text-fg-2" aria-hidden />
              ) : (
                <Laptop className="size-5 text-fg-2" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <b className="block text-sm">{s.device}</b>
                <span className="text-xs text-fg-2">
                  {s.current
                    ? t('settings.thisDevice')
                    : t('settings.lastActive', { when: relative(s.lastUsedAt, i18n.language) })}
                </span>
              </div>
              {!s.current && (
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                  {t('settings.signOutDevice')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <ChangePassword />
    </div>
  );
}

const pwSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });
function ChangePassword() {
  const { t } = useTranslation();
  const setToken = useSession((s) => s.setToken);
  const form = useForm<z.infer<typeof pwSchema>>({
    resolver: zodResolver(pwSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const r = await api.post<{ accessToken: string }>('/auth/password/change', v);
      setToken(r.accessToken);
      form.reset();
      toast.success(t('settings.passwordChanged'));
    } catch (err) {
      applyApiError(err, form.setError, t('errors.generic'), 'newPassword');
    }
  });
  return (
    <Card className="p-5">
      <form onSubmit={onSubmit} noValidate className="grid max-w-md gap-4">
        <h2 className="text-lg font-semibold">{t('settings.changePassword')}</h2>
        <FormError message={form.formState.errors.root?.message} />
        <Field label={t('settings.currentPassword')} error={form.formState.errors.currentPassword?.message}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              autoComplete="current-password"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('currentPassword')}
            />
          )}
        </Field>
        <Field
          label={t('auth.newPassword')}
          hint={t('auth.passwordHint')}
          error={form.formState.errors.newPassword?.message}
        >
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              autoComplete="new-password"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('newPassword')}
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="primary"
          className="justify-self-start"
          loading={form.formState.isSubmitting}
        >
          {t('settings.changePassword')}
        </Button>
      </form>
    </Card>
  );
}

interface ConsentRow {
  purpose: 'account' | 'mentorship_matching' | 'email_digests' | 'analytics_aggregate';
  granted: boolean;
  required: boolean;
  updatedAt: string | null;
}
export function PrivacySettings() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const consents = useQuery({ queryKey: ['consents'], queryFn: () => api.get<ConsentRow[]>('/me/consents') });
  const set = useMutation({
    mutationFn: (v: { purpose: string; granted: boolean }) => api.post<ConsentRow[]>('/me/consents', v),
    onSuccess: (rows) => {
      qc.setQueryData(['consents'], rows);
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card className="grid gap-4 p-5">
      <div>
        <h2 className="text-lg font-semibold">{t('settings.consentsTitle')}</h2>
        <p className="text-sm text-fg-2">{t('settings.consentsBody')}</p>
      </div>
      {consents.isLoading && <Skeleton className="h-40" />}
      <ul className="grid gap-2">
        {consents.data?.map((c) => (
          <li key={c.purpose} className="flex items-start gap-3 rounded-[var(--radius-md)] bg-surface-2 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm">{t(`auth.consent.${c.purpose}`)}</p>
              {c.updatedAt && (
                <p className="mt-1 font-mono text-[11px] text-fg-3">
                  {new Date(c.updatedAt).toLocaleDateString(i18n.language)}
                </p>
              )}
            </div>
            {c.required ? (
              <Badge>{t('settings.required')}</Badge>
            ) : (
              <label className="relative inline-flex min-h-11 cursor-pointer items-center">
                <span className="sr-only">{t(`auth.consent.${c.purpose}`)}</span>
                <input
                  type="checkbox"
                  role="switch"
                  className="peer sr-only"
                  checked={c.granted}
                  onChange={(e) => set.mutate({ purpose: c.purpose, granted: e.target.checked })}
                />
                <span className="h-7 w-12 rounded-full bg-surface-3 transition-colors peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:top-1/2 after:left-1 after:size-5 after:-translate-y-1/2 after:rounded-full after:bg-white after:transition-transform after:duration-[var(--dur-base)] peer-checked:after:translate-x-5" />
              </label>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-3">{t('settings.rights')}</p>
    </Card>
  );
}

export function PreferenceSettings() {
  const { t, i18n } = useTranslation();
  const { theme, motion, setTheme, setMotion, setLanguage } = usePreferences();
  const group = <T extends string>(
    label: string,
    value: T,
    options: [T, string][],
    onChange: (v: T) => void,
  ) => (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-[13px] font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <Chip key={v} pressed={value === v} onClick={() => onChange(v)}>
            {l}
          </Chip>
        ))}
      </div>
    </fieldset>
  );
  return (
    <Card className="grid gap-6 p-5">
      {group<ThemePref>(
        t('settings.theme'),
        theme,
        [
          ['system', t('settings.themeSystem')],
          ['dark', t('settings.themeDark')],
          ['light', t('settings.themeLight')],
        ],
        setTheme,
      )}
      {group(
        t('settings.language'),
        i18n.language as 'en' | 'te',
        SUPPORTED_LOCALES.map((l) => [l, l === 'en' ? 'English' : 'తెలుగు'] as ['en' | 'te', string]),
        (l) => {
          setLanguage(l);
          void api.patch('/me', { locale: l }).catch(() => undefined);
        },
      )}
      {group<MotionPref>(
        t('settings.motion'),
        motion,
        [
          ['system', t('settings.motionSystem')],
          ['full', t('settings.motionFull')],
          ['reduce', t('settings.motionReduce')],
        ],
        setMotion,
      )}
    </Card>
  );
}
