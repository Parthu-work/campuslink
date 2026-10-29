import { useState } from 'react';
import { Outlet } from 'react-router';
import { TabNav } from '../../components/ui/tab-nav';
import { useTranslation } from '../../i18n/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { Laptop, Smartphone } from 'lucide-react';
import { password as passwordSchema, SUPPORTED_LOCALES } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Field, PasswordInput } from '../../components/ui/field';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Switch } from '../../components/ui/switch';
import { Dialog } from '../../components/ui/dialog';
import { FormError } from '../../components/layout/auth-layout';
import { MfaSetup } from '../auth/mfa-setup';
import { api } from '../../lib/api';
import { useMe } from '../../lib/me';
import { useNav } from '../../lib/nav';
import { useSession } from '../../lib/session';
import { usePreferences, type MotionPref, type ThemePref } from '../../lib/preferences';
import { applyApiError } from '../../lib/errors';
import { lazyPart } from '../../lib/lazy-part';
import { useTenant } from '../../lib/tenant-context';
// Its code (the phone and code fields) loads only on the Security tab, after it renders.
const PhoneSettings = lazyPart(() => import('./phone-settings').then((m) => m.PhoneSettings));

export function SettingsLayout() {
  const { t } = useTranslation();
  const { settings } = useNav();
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <TabNav label={t('settings.title')} tabs={settings} />
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
  const tenant = useTenant();
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
          <h2 className="text-title font-semibold">{t('settings.twoFactor')}</h2>
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

      {tenant.phoneSignIn && tenant.kind === 'college' && <PhoneSettings fallback={null} />}

      <Card className="grid gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-title font-semibold">{t('settings.sessions')}</h2>
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
                <b className="block text-meta">{s.device}</b>
                <span className="text-caption text-fg-2">
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
    mode: 'onTouched',
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
        <h2 className="text-title font-semibold">{t('settings.changePassword')}</h2>
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
        <h2 className="text-title font-semibold">{t('settings.consentsTitle')}</h2>
        <p className="text-meta text-fg-2">{t('settings.consentsBody')}</p>
      </div>
      {consents.isLoading && <Skeleton className="h-40" />}
      <ul className="grid gap-2">
        {consents.data?.map((c) => (
          <li key={c.purpose} className="rounded-[var(--radius-md)] bg-surface-2 px-3 py-2">
            {c.required ? (
              <div className="flex items-start gap-3 py-1">
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium">{t(`auth.consent.${c.purpose}`)}</p>
                  {c.updatedAt && (
                    <p className="mt-1 font-mono text-caption text-fg-3">
                      {new Date(c.updatedAt).toLocaleDateString(i18n.language)}
                    </p>
                  )}
                </div>
                <Badge>{t('settings.required')}</Badge>
              </div>
            ) : (
              <Switch
                label={t(`auth.consent.${c.purpose}`)}
                description={
                  c.updatedAt && (
                    <span className="font-mono text-caption text-fg-3">
                      {new Date(c.updatedAt).toLocaleDateString(i18n.language)}
                    </span>
                  )
                }
                checked={c.granted}
                onChange={(on) => set.mutate({ purpose: c.purpose, granted: on })}
              />
            )}
          </li>
        ))}
      </ul>
      <p className="text-caption text-fg-3">{t('settings.rights')}</p>
    </Card>
  );
}

export function PreferenceSettings() {
  const { t, i18n } = useTranslation();
  const { theme, motion, haptics, setTheme, setMotion, setHaptics, setLanguage } = usePreferences();
  return (
    <Card className="grid gap-6 p-5">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-meta font-semibold">{t('settings.theme')}</legend>
        <ChoiceGroup<ThemePref>
          variant="chip"
          label={t('settings.theme')}
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: t('settings.themeSystem') },
            { value: 'dark', label: t('settings.themeDark') },
            { value: 'light', label: t('settings.themeLight') },
          ]}
        />
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-meta font-semibold">{t('settings.language')}</legend>
        <ChoiceGroup<'en' | 'te'>
          variant="chip"
          label={t('settings.language')}
          value={i18n.language as 'en' | 'te'}
          onChange={(l) => {
            setLanguage(l);
            void api.patch('/me', { locale: l }).catch(() => undefined);
          }}
          options={SUPPORTED_LOCALES.map((l) => ({ value: l, label: l === 'en' ? 'English' : 'తెలుగు' }))}
        />
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-meta font-semibold">{t('settings.motion')}</legend>
        <ChoiceGroup<MotionPref>
          variant="chip"
          label={t('settings.motion')}
          value={motion}
          onChange={setMotion}
          options={[
            { value: 'system', label: t('settings.motionSystem') },
            { value: 'full', label: t('settings.motionFull') },
            { value: 'reduce', label: t('settings.motionReduce') },
          ]}
        />
      </fieldset>
      <Switch
        label={t('settings.haptics')}
        description={t('settings.hapticsHint')}
        checked={haptics}
        onChange={setHaptics}
      />
    </Card>
  );
}
