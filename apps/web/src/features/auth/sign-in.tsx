import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { email as emailSchema, type LoginResult } from '@campuslink/shared';
import { AuthLayout, FormError } from '../../components/layout/auth-layout';
import { Button } from '../../components/ui/button';
import { Field, Input, PasswordInput } from '../../components/ui/field';
import { OtpInput } from '../../components/ui/otp';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useTenant } from '../../lib/tenant-context';
import { applyApiError } from '../../lib/errors';

const schema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password') });
type Form = z.infer<typeof schema>;

export function SignInPage() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setToken = useSession((s) => s.setToken);
  const [ticket, setTicket] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const finish = async (accessToken: string) => {
    setToken(accessToken);
    await qc.invalidateQueries({ queryKey: ['me'] });
    navigate('/home', { replace: true });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setUnverifiedEmail(null);
    try {
      const r = await api.post<LoginResult>('/auth/login', values);
      if (r.mfaRequired && r.ticket) setTicket(r.ticket);
      else if (r.session) await finish(r.session.accessToken);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') setUnverifiedEmail(values.email);
      applyApiError(err, form.setError, t('errors.generic'));
    }
  });

  if (ticket) return <MfaStep ticket={ticket} onDone={finish} onRestart={() => setTicket(null)} />;

  return (
    <AuthLayout
      title={t('auth.signInTitle')}
      subtitle={t('auth.signInSub', { college: tenant.branding.displayName })}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={errors.root?.message} />
        {unverifiedEmail && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {resent ? (
              <span className="text-fg-2" role="status">
                {t('auth.resent')}
              </span>
            ) : (
              <Button
                size="sm"
                onClick={async () => {
                  await api
                    .post('/auth/verify-email/resend', { email: unverifiedEmail })
                    .catch(() => undefined);
                  setResent(true);
                }}
              >
                {t('auth.resend')}
              </Button>
            )}
          </div>
        )}
        <Field label={t('common.email')} error={errors.email?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="email"
              autoComplete="username"
              inputMode="email"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('email')}
            />
          )}
        </Field>
        <Field label={t('common.password')} error={errors.password?.message}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              autoComplete="current-password"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('password')}
            />
          )}
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-semibold text-brand-ink hover:underline">
            {t('auth.forgot')}
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
          {t('auth.signInCta')}
        </Button>
        <p className="text-center text-sm text-fg-2">
          {t('auth.noAccount')}{' '}
          <Link to="/sign-up" className="font-semibold text-brand-ink hover:underline">
            {t('auth.createAccount')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

function MfaStep({
  ticket,
  onDone,
  onRestart,
}: {
  ticket: string;
  onDone: (token: string) => Promise<void>;
  onRestart: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const body =
        recovery !== null ? { ticket, recoveryCode: recovery.trim().toLowerCase() } : { ticket, code };
      const r = await api.post<{ session: { accessToken: string } }>('/auth/login/mfa', body);
      await onDone(r.session.accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.generic'));
      if (err instanceof ApiError && /expired/i.test(err.message)) onRestart();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('auth.mfaTitle')} subtitle={t('auth.mfaSub')}>
      <form onSubmit={submit} className="grid gap-4">
        <FormError message={error} />
        {recovery === null ? (
          <OtpInput value={code} onChange={setCode} label={t('auth.mfaTitle')} autoFocus />
        ) : (
          <Field label={t('auth.recoveryCode')}>
            {({ id }) => (
              <Input
                id={id}
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
                placeholder="abcde-12345"
                autoComplete="one-time-code"
                className="font-mono"
                autoFocus
              />
            )}
          </Field>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={busy}
          disabled={recovery === null ? code.length !== 6 : recovery.length < 11}
        >
          {t('auth.mfaVerify')}
        </Button>
        <Button variant="ghost" onClick={() => setRecovery(recovery === null ? '' : null)}>
          {recovery === null ? t('auth.useRecovery') : t('auth.useTotp')}
        </Button>
      </form>
    </AuthLayout>
  );
}
