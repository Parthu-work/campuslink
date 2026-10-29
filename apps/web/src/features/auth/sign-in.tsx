import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from '../../i18n/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  email as emailSchema,
  phone as phoneSchema,
  safeReturnPath,
  type CodeSent,
  type LoginResult,
  type OtpChannel,
} from '@campuslink/shared';
import { AuthLayout, FormError } from '../../components/layout/auth-layout';
import { Button } from '../../components/ui/button';
import { Field, Input, PasswordInput } from '../../components/ui/field';
import { OtpInput } from '../../components/ui/otp';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useTenant } from '../../lib/tenant-context';
import { applyApiError } from '../../lib/errors';
import { Segmented } from '../../components/ui/tab-nav';
import { toE164 } from '../../lib/phone';
import { PhoneCodeStep, PhoneField } from './phone-parts';

const schema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password') });
type Form = z.infer<typeof schema>;

export function SignInPage() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const setToken = useSession((s) => s.setToken);
  const [ticket, setTicket] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  // Phone first when the college can send codes (B2); administrators always use email.
  const [method, setMethod] = useState<'phone' | 'email'>(
    tenant.phoneSignIn && tenant.kind === 'college' ? 'phone' : 'email',
  );
  const [adminNote, setAdminNote] = useState<string | null>(null);
  const form = useForm<Form>({
    mode: 'onTouched',
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const finish = async (accessToken: string) => {
    setToken(accessToken);
    await qc.invalidateQueries({ queryKey: ['me'] });
    // PublicOnly usually redirects as soon as the token lands; only navigate if we are still here,
    // so a late redirect can never undo the member's next tap.
    if (window.location.pathname !== '/sign-in') return;
    // Back to the page that asked for sign-in (a shared post, a push link), else the console or Home.
    const from = safeReturnPath((location.state as { from?: unknown } | null)?.from);
    navigate(from ?? (tenant.kind === 'platform' ? '/platform' : '/home'), { replace: true });
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

  const switcher = tenant.phoneSignIn && tenant.kind === 'college' && (
    <Segmented
      label={t('phone.method')}
      value={method}
      options={[
        ['phone', t('phone.withPhone')],
        ['email', t('phone.withEmail')],
      ]}
      onChange={setMethod}
    />
  );

  if (method === 'phone')
    return (
      <PhoneSignIn
        switcher={switcher}
        onSession={finish}
        onTicket={setTicket}
        onAdmin={(message) => {
          setAdminNote(message);
          setMethod('email');
        }}
      />
    );

  return (
    <AuthLayout
      title={t('auth.signInTitle')}
      subtitle={t('auth.signInSub', { college: tenant.branding.displayName })}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {switcher}
        <FormError message={adminNote ?? errors.root?.message} />
        {unverifiedEmail && (
          <div className="flex flex-wrap items-center gap-3 text-meta">
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
          <Link
            to="/forgot-password"
            className="inline-flex min-h-11 items-center text-meta font-semibold text-brand-ink hover:underline"
          >
            {t('auth.forgot')}
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
          {t('auth.signInCta')}
        </Button>
        <p className="text-center text-meta text-fg-2">
          {t('auth.noAccount')}{' '}
          <Link
            to="/sign-up"
            className="inline-flex min-h-11 items-center font-semibold text-brand-ink hover:underline"
          >
            {t('auth.createAccount')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

function PhoneSignIn({
  switcher,
  onSession,
  onTicket,
  onAdmin,
}: {
  switcher: ReactNode;
  onSession: (token: string) => Promise<void>;
  onTicket: (ticket: string) => void;
  onAdmin: (message: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const tenant = useTenant();
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<{ phone: string; sent: CodeSent } | null>(null);
  const send = (phone: string, channel?: OtpChannel) =>
    api.post<CodeSent>('/auth/phone/start', {
      phone,
      purpose: 'login',
      locale: i18n.language === 'te' ? 'te' : 'en',
      ...(channel ? { channel } : {}),
    });

  if (code)
    return (
      <AuthLayout title={t('phone.codeTitle')} subtitle={t('phone.signInCodeSub')}>
        <PhoneCodeStep
          phone={code.phone}
          sent={code.sent}
          onResend={(channel) => send(code.phone, channel)}
          onBack={() => setCode(null)}
          onCode={async (otp, challengeId) => {
            try {
              const r = await api.post<
                | { mfaRequired: true; ticket: string }
                | { mfaRequired: false; session: { accessToken: string } }
              >('/auth/phone/verify', { challengeId, code: otp });
              if (r.mfaRequired) onTicket(r.ticket);
              else await onSession(r.session.accessToken);
            } catch (err) {
              if (err instanceof ApiError && err.code === 'USE_PASSWORD_AND_2FA') return onAdmin(err.message);
              throw err;
            }
          }}
        />
        <p className="text-center text-meta text-fg-2">
          {t('phone.noAccountYet')}{' '}
          <Link
            to="/sign-up"
            className="inline-flex min-h-11 items-center font-semibold text-brand-ink hover:underline"
          >
            {t('auth.createAccount')}
          </Link>
        </p>
      </AuthLayout>
    );

  return (
    <AuthLayout
      title={t('auth.signInTitle')}
      subtitle={t('auth.signInSub', { college: tenant.branding.displayName })}
    >
      <form
        noValidate
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const phone = toE164(number);
          if (!phoneSchema.safeParse(phone).success) return setError(t('phone.invalid'));
          setBusy(true);
          setError(undefined);
          try {
            setCode({ phone, sent: await send(phone) });
          } catch (err) {
            setError(err instanceof ApiError ? err.message : t('errors.generic'));
          } finally {
            setBusy(false);
          }
        }}
      >
        {switcher}
        <PhoneField label={t('phone.number')} value={number} onChange={setNumber} error={error} />
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          {t('phone.sendCode')}
        </Button>
        <p className="text-center text-meta text-fg-2">
          {t('auth.noAccount')}{' '}
          <Link
            to="/sign-up"
            className="inline-flex min-h-11 items-center font-semibold text-brand-ink hover:underline"
          >
            {t('auth.createAccount')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function MfaStep({
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

  // Sent on the sixth digit (FO-6), or with the button (and always for a recovery code).
  const submit = async (otp = code) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const body =
        recovery !== null ? { ticket, recoveryCode: recovery.trim().toLowerCase() } : { ticket, code: otp };
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="grid gap-4"
      >
        <FormError message={error} />
        {recovery === null ? (
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={(c) => void submit(c)}
            label={t('auth.mfaTitle')}
            autoFocus
          />
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
