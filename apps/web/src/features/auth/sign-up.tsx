import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm, useWatch, Controller, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '../../i18n/react';
import { ArrowLeft, ArrowRight, ChevronDown, MailCheck } from 'lucide-react';
import {
  BIRTH_MONTH,
  CONSENT_PURPOSE_KEYS,
  LOCALE_TAGS,
  adultOnFromBirthMonth,
  email,
  isMinor,
  password,
  personName,
  phone as phoneSchema,
  plausibleBirthMonth,
  type CodeSent,
  type OtpChannel,
  toLocale,
} from '@campuslink/shared';
import { AuthLayout, FormError } from '../../components/layout/auth-layout';
import { Button } from '../../components/ui/button';
import { Field, Input, PasswordInput } from '../../components/ui/field';
import { Chip, EmptyState } from '../../components/ui/misc';
import { ProgressBar } from '../../components/ui/progress';
import { api } from '../../lib/api';
import { useTenant } from '../../lib/tenant-context';
import { applyApiError } from '../../lib/errors';
import { toE164 } from '../../lib/phone';
import { WhatHappensNext } from '../guardian/what-next';
import { BirthMonthField, ConsentFields, PhoneCodeStep, PhoneField } from './phone-parts';
import { MfaStep } from './sign-in';
import { startSession } from '../../lib/start-session';

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

/** Which step owns a field, so a server error brings the member back to it. */
const STEP_ONE: FieldPath<Form>[] = ['intent', 'phone', 'email', 'password'];

/** "Step 2 of 3", a bar, and Back (which keeps what was typed). */
function Steps({ n, onBack }: { n: 1 | 2 | 3; onBack?: (() => void) | undefined }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2">
      <div className="flex min-h-11 items-center justify-between gap-3">
        {onBack ? (
          <Button variant="tertiary" size="sm" className="-ml-2" onClick={onBack}>
            <ArrowLeft aria-hidden /> {t('common.back')}
          </Button>
        ) : (
          <span />
        )}
        <span className="text-callout text-fg-2">{t('ui.stepOf', { n, total: 3 })}</span>
      </div>
      <ProgressBar
        value={n}
        max={3}
        size="sm"
        label={t('signup.progress')}
        valueText={t('ui.stepOf', { n, total: 3 })}
      />
    </div>
  );
}

/**
 * Consents as one sentence (prompt 3, U4): what the ticked purposes do, in a list, and "Review
 * choices" to open the full, versioned checklist (unchanged, B2). It opens by itself when a choice
 * needs attention.
 */
function ConsentSummary({
  value,
  onChange,
  error,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  error?: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const shown = open || !!error;
  const uses = CONSENT_PURPOSE_KEYS.filter((p) => value.includes(p)).map((p) => t(`signup.uses.${p}`));
  const list = new Intl.ListFormat(LOCALE_TAGS[toLocale(i18n.language)], { type: 'conjunction' }).format(
    uses,
  );
  return (
    <div className="grid gap-3">
      <p className="text-callout text-fg-2">
        {uses.length ? t('signup.consentSummary', { list }) : t('signup.consentNone')}{' '}
        {t('signup.consentNever')}
      </p>
      <Button
        variant="tertiary"
        size="sm"
        className="-ml-2 justify-self-start text-brand-ink"
        aria-expanded={shown}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {t('signup.reviewChoices')}{' '}
        <ChevronDown
          className={shown ? 'rotate-180 transition-transform' : 'transition-transform'}
          aria-hidden
        />
      </Button>
      <div id={id} hidden={!shown}>
        <ConsentFields value={value} onChange={onChange} error={error} />
      </div>
    </div>
  );
}

/**
 * Sign-up in three steps (prompt 3, U4): (1) the role and the mobile number (or "Use email
 * instead"); (2) name, birth month and the consents as one sentence; (3) the code, which sends
 * itself and creates the account. The code comes last because the API checks it and creates the
 * account in one call (`/auth/phone/verify`), so every legal behaviour of B2 and R1 is unchanged.
 */
export function SignUpPage() {
  const { t, i18n } = useTranslation();
  const tenant = useTenant();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
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
  const birthMonth = useWatch({ control: form.control, name: 'birthMonth' });
  const minor =
    BIRTH_MONTH.test(birthMonth) &&
    plausibleBirthMonth(birthMonth) &&
    isMinor(adultOnFromBirthMonth(birthMonth));
  const locale = toLocale(i18n.language);

  const finish = async (accessToken: string) => {
    await startSession(qc, accessToken);
    navigate('/home', { replace: true });
  };
  const sendCode = (phone: string, channel?: OtpChannel) =>
    api.post<CodeSent>('/auth/phone/start', {
      phone,
      purpose: 'signup',
      locale,
      ...(channel ? { channel } : {}),
    });

  const next = async () => {
    const fields: FieldPath<Form>[] =
      method === 'phone' ? ['intent', 'phone'] : ['intent', 'email', 'password'];
    if (await form.trigger(fields)) setStep(2);
  };

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
      // A problem with the number, the email or the password belongs to the first step.
      if (STEP_ONE.some((f) => form.getFieldState(f).error)) setStep(1);
    }
  });

  if (ticket) return <MfaStep ticket={ticket} onDone={finish} onRestart={() => setTicket(null)} />;

  if (code) {
    const v = form.getValues();
    return (
      <AuthLayout title={t('phone.codeTitle')} subtitle={t('phone.codeSub')}>
        <Steps n={3} onBack={() => setCode(null)} />
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
        <Steps n={3} />
        <EmptyState icon={<MailCheck className="size-6" />} title={t('auth.checkEmailTitle')}>
          <p>{t('auth.checkEmailBody', { email: sentTo })}</p>
        </EmptyState>
        <Link to="/sign-in" className="text-center font-semibold text-brand-ink hover:underline">
          {t('auth.signInCta')}
        </Link>
      </AuthLayout>
    );
  }

  if (step === 2)
    return (
      <AuthLayout title={t('signup.aboutTitle')} subtitle={t('signup.aboutSub')}>
        <Steps n={2} onBack={() => setStep(1)} />
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <FormError message={errors.root?.message} />
          <Field label={t('common.name')} error={errors.name?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                autoComplete="name"
                autoFocus
                aria-describedby={describedBy}
                aria-invalid={invalid}
                {...form.register('name')}
              />
            )}
          </Field>
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
          {minor && <WhatHappensNext />}
          <Controller
            control={form.control}
            name="consents"
            render={({ field }) => (
              <ConsentSummary
                value={field.value}
                onChange={field.onChange}
                error={errors.consents?.message}
              />
            )}
          />
          <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
            {method === 'phone' ? t('phone.sendCode') : t('auth.signUpCta')}
          </Button>
        </form>
      </AuthLayout>
    );

  return (
    <AuthLayout
      title={t('auth.signUpTitle', { college: tenant.branding.shortName })}
      subtitle={t(method === 'phone' ? 'phone.signUpSub' : 'auth.signUpSub')}
    >
      <Steps n={1} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void next();
        }}
        noValidate
        className="grid gap-5"
      >
        <FormError message={errors.root?.message} />
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-callout font-semibold">{t('auth.iAm')}</legend>
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
        <Button type="submit" variant="primary" size="lg">
          {t('common.continue')} <ArrowRight aria-hidden />
        </Button>
        {tenant.phoneSignIn && (
          <Button
            variant="tertiary"
            className="justify-self-center"
            onClick={() => {
              form.clearErrors();
              form.setValue('method', method === 'phone' ? 'email' : 'phone');
            }}
          >
            {method === 'phone' ? t('signup.useEmail') : t('signup.usePhone')}
          </Button>
        )}
        <p className="text-center text-callout text-fg-2">
          {t('auth.haveAccount')}{' '}
          <Link to="/sign-in" className="hit font-semibold text-brand-ink hover:underline">
            {t('auth.signInCta')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
