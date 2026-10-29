import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '../../i18n/react';
import { MailCheck } from 'lucide-react';
import {
  BIRTH_MONTH,
  email,
  password,
  personName,
  phone as phoneSchema,
  plausibleBirthMonth,
  type CodeSent,
  type OtpChannel,
} from '@campuslink/shared';
import { AuthLayout, FormError } from '../../components/layout/auth-layout';
import { Button } from '../../components/ui/button';
import { Field, Input, PasswordInput } from '../../components/ui/field';
import { Chip, EmptyState } from '../../components/ui/misc';
import { Segmented } from '../../components/ui/tab-nav';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useTenant } from '../../lib/tenant-context';
import { applyApiError } from '../../lib/errors';
import { toE164 } from '../../lib/phone';
import { BirthMonthField, ConsentFields, PhoneCodeStep, PhoneField } from './phone-parts';
import { MfaStep } from './sign-in';

type Method = 'phone' | 'email';
const schema = z
  .object({
    method: z.enum(['phone', 'email']),
    name: personName,
    intent: z.enum(['STUDENT', 'ALUMNI']),
    birthMonth: z
      .string()
      .refine((v) => BIRTH_MONTH.test(v), 'Choose the month and year you were born')
      .refine(
        (v) => !BIRTH_MONTH.test(v) || plausibleBirthMonth(v),
        'Check the year and month you were born',
      ),
    consents: z
      .array(z.string())
      .refine((c) => c.includes('account'), 'This one is needed to create your account'),
    phone: z.string(),
    email: z.string(),
    password: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.method === 'phone') {
      if (!phoneSchema.safeParse(toE164(v.phone)).success)
        ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a 10-digit mobile number' });
      return;
    }
    const e = email.safeParse(v.email);
    if (!e.success)
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: e.error.issues[0]?.message ?? 'Enter an email',
      });
    const p = password.safeParse(v.password);
    if (!p.success)
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: p.error.issues[0]?.message ?? 'Choose a password',
      });
  });
type Form = z.infer<typeof schema>;

export function SignUpPage() {
  const { t, i18n } = useTranslation();
  const tenant = useTenant();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setToken = useSession((s) => s.setToken);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState<{ phone: string; sent: CodeSent } | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const form = useForm<Form>({
    mode: 'onTouched',
    resolver: zodResolver(schema),
    defaultValues: {
      method: tenant.phoneSignIn ? 'phone' : 'email',
      name: '',
      intent: 'STUDENT',
      birthMonth: '',
      consents: ['account', 'mentorship_matching'],
      phone: '',
      email: '',
      password: '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const method = useWatch({ control: form.control, name: 'method' });
  const locale = i18n.language === 'te' ? 'te' : 'en';

  const finish = async (accessToken: string) => {
    setToken(accessToken);
    await qc.invalidateQueries({ queryKey: ['me'] });
    navigate('/home', { replace: true });
  };
  const sendCode = (phone: string, channel?: OtpChannel) =>
    api.post<CodeSent>('/auth/phone/start', {
      phone,
      purpose: 'signup',
      locale,
      ...(channel ? { channel } : {}),
    });

  const onSubmit = form.handleSubmit(async (v) => {
    const common = { name: v.name, intent: v.intent, birthMonth: v.birthMonth, consents: v.consents, locale };
    try {
      if (v.method === 'phone') {
        const phone = toE164(v.phone);
        setCode({ phone, sent: await sendCode(phone) });
      } else {
        await api.post('/auth/signup', { ...common, email: v.email, password: v.password });
        setSentTo(v.email);
      }
    } catch (err) {
      applyApiError(err, form.setError, t('errors.generic'), 'password');
    }
  });

  if (ticket) return <MfaStep ticket={ticket} onDone={finish} onRestart={() => setTicket(null)} />;

  if (code) {
    const v = form.getValues();
    return (
      <AuthLayout title={t('phone.codeTitle')} subtitle={t('phone.codeSub')}>
        <PhoneCodeStep
          phone={code.phone}
          sent={code.sent}
          onResend={(channel) => sendCode(code.phone, channel)}
          onBack={() => setCode(null)}
          onCode={async (otp, challengeId) => {
            const r = await api.post<
              { mfaRequired: true; ticket: string } | { mfaRequired: false; session: { accessToken: string } }
            >('/auth/phone/verify', {
              challengeId,
              code: otp,
              signup: {
                name: v.name,
                intent: v.intent,
                birthMonth: v.birthMonth,
                consents: v.consents,
                locale,
              },
            });
            if (r.mfaRequired) setTicket(r.ticket);
            else await finish(r.session.accessToken);
          }}
        />
      </AuthLayout>
    );
  }

  if (sentTo) {
    return (
      <AuthLayout title={t('auth.checkEmailTitle')}>
        <EmptyState icon={<MailCheck className="size-6" />} title={t('auth.checkEmailTitle')}>
          <p>{t('auth.checkEmailBody', { email: sentTo })}</p>
        </EmptyState>
        <Link to="/sign-in" className="text-center font-semibold text-brand-ink hover:underline">
          {t('auth.signInCta')}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('auth.signUpTitle', { college: tenant.branding.shortName })}
      subtitle={t(method === 'phone' ? 'phone.signUpSub' : 'auth.signUpSub')}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={errors.root?.message} />
        {tenant.phoneSignIn && (
          <Controller
            control={form.control}
            name="method"
            render={({ field }) => (
              <Segmented<Method>
                label={t('phone.method')}
                value={field.value}
                options={[
                  ['phone', t('phone.withPhone')],
                  ['email', t('phone.withEmail')],
                ]}
                onChange={field.onChange}
              />
            )}
          />
        )}
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-meta font-semibold">{t('auth.iAm')}</legend>
          <Controller
            control={form.control}
            name="intent"
            render={({ field }) => (
              <div className="flex gap-2">
                {(['STUDENT', 'ALUMNI'] as const).map((v) => (
                  <Chip key={v} pressed={field.value === v} onClick={() => field.onChange(v)}>
                    {v === 'STUDENT' ? t('auth.student') : t('auth.alumnus')}
                  </Chip>
                ))}
              </div>
            )}
          />
        </fieldset>
        <Field label={t('common.name')} error={errors.name?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="name"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('name')}
            />
          )}
        </Field>
        {method === 'phone' ? (
          <Controller
            control={form.control}
            name="phone"
            render={({ field }) => (
              <PhoneField
                label={t('phone.number')}
                value={field.value}
                onChange={field.onChange}
                error={errors.phone?.message}
              />
            )}
          />
        ) : (
          <>
            <Field label={t('common.email')} error={errors.email?.message}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  {...form.register('email')}
                />
              )}
            </Field>
            <Field
              label={t('common.password')}
              hint={t('auth.passwordHint')}
              error={errors.password?.message}
            >
              {({ id, describedBy, invalid }) => (
                <PasswordInput
                  id={id}
                  autoComplete="new-password"
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  {...form.register('password')}
                />
              )}
            </Field>
          </>
        )}
        <Controller
          control={form.control}
          name="birthMonth"
          render={({ field }) => (
            <BirthMonthField
              value={field.value}
              onChange={field.onChange}
              error={errors.birthMonth?.message}
            />
          )}
        />

        <Controller
          control={form.control}
          name="consents"
          render={({ field }) => (
            <ConsentFields value={field.value} onChange={field.onChange} error={errors.consents?.message} />
          )}
        />

        <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
          {method === 'phone' ? t('phone.sendCode') : t('auth.signUpCta')}
        </Button>
        <p className="text-center text-meta text-fg-2">
          {t('auth.haveAccount')}{' '}
          <Link to="/sign-in" className="font-semibold text-brand-ink hover:underline">
            {t('auth.signInCta')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
