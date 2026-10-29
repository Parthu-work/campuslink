import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, MailCheck } from 'lucide-react';
import { email, password } from '@campuslink/shared';
import { AuthLayout, FormError } from '../../components/layout/auth-layout';
import { Button } from '../../components/ui/button';
import { Field, Input, PasswordInput } from '../../components/ui/field';
import { EmptyState } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { applyApiError } from '../../lib/errors';

/** Strips the token from the address bar immediately so it does not linger in history or screenshots. */
function useOneTimeToken(): string | null {
  const [params, setParams] = useSearchParams();
  const [token] = useState(() => params.get('token'));
  useEffect(() => {
    if (params.has('token')) setParams({}, { replace: true });
  }, [params, setParams]);
  return token;
}

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const token = useOneTimeToken();
  const [state, setState] = useState<'working' | 'done' | 'error'>(token ? 'working' : 'error');
  const [error, setError] = useState<string>(token ? '' : t('auth.missingToken'));
  const ran = useRef(false);
  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    api
      .post('/auth/verify-email', { token })
      .then(() => setState('done'))
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : t('errors.generic'));
        setState('error');
      });
  }, [token, t]);
  return (
    <AuthLayout title={state === 'done' ? t('auth.verifiedTitle') : t('auth.verifyTitle')}>
      {state === 'working' && (
        <Loader2
          className="size-8 animate-spin text-brand-ink motion-reduce:animate-none"
          aria-label={t('common.loading')}
        />
      )}
      {state === 'done' && (
        <EmptyState
          icon={<CheckCircle2 className="size-6" />}
          title={t('auth.verifiedTitle')}
          action={
            <Link className="font-semibold text-brand-ink hover:underline" to="/sign-in">
              {t('auth.signInCta')}
            </Link>
          }
        >
          {t('auth.verifiedBody')}
        </EmptyState>
      )}
      {state === 'error' && <FormError message={error} />}
    </AuthLayout>
  );
}

const forgotSchema = z.object({ email });
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const form = useForm<z.infer<typeof forgotSchema>>({
    mode: 'onTouched',
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.post('/auth/password/forgot', v);
      setSent(true);
    } catch (err) {
      applyApiError(err, form.setError, t('errors.generic'));
    }
  });
  return (
    <AuthLayout title={t('auth.forgotTitle')} subtitle={sent ? undefined : t('auth.forgotSub')}>
      {sent ? (
        <EmptyState icon={<MailCheck className="size-6" />} title={t('auth.checkEmailTitle')}>
          {t('auth.forgotSent')}
        </EmptyState>
      ) : (
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormError message={form.formState.errors.root?.message} />
          <Field label={t('common.email')} error={form.formState.errors.email?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                {...form.register('email')}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting}>
            {t('auth.forgotCta')}
          </Button>
        </form>
      )}
      <Link
        to="/sign-in"
        className="inline-flex min-h-11 items-center justify-center text-meta font-semibold text-brand-ink hover:underline"
      >
        {t('common.back')}
      </Link>
    </AuthLayout>
  );
}

const resetSchema = z.object({ password });
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const token = useOneTimeToken();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const form = useForm<z.infer<typeof resetSchema>>({
    mode: 'onTouched',
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '' },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.post('/auth/password/reset', { token, password: v.password });
      setDone(true);
    } catch (err) {
      applyApiError(err, form.setError, t('errors.generic'), 'password');
    }
  });
  if (!token)
    return (
      <AuthLayout title={t('auth.resetTitle')}>
        <FormError message={t('auth.missingToken')} />
      </AuthLayout>
    );
  return (
    <AuthLayout title={t('auth.resetTitle')}>
      {done ? (
        <EmptyState
          icon={<CheckCircle2 className="size-6" />}
          title={t('auth.resetDone')}
          action={
            <Button variant="primary" onClick={() => navigate('/sign-in')}>
              {t('auth.signInCta')}
            </Button>
          }
        />
      ) : (
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormError message={form.formState.errors.root?.message} />
          <Field
            label={t('auth.newPassword')}
            hint={t('auth.passwordHint')}
            error={form.formState.errors.password?.message}
          >
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                autoComplete="new-password"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                autoFocus
                {...form.register('password')}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting}>
            {t('auth.resetCta')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
