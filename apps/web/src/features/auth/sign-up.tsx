import { useState } from 'react';
import { Link } from 'react-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { MailCheck } from 'lucide-react';
import {
  CONSENT_PURPOSES,
  CONSENT_PURPOSE_KEYS,
  email,
  password,
  personName,
  type ConsentPurpose,
} from '@campuslink/shared';
import { AuthLayout, FormError } from '../../components/layout/auth-layout';
import { Button } from '../../components/ui/button';
import { Checkbox, Field, Input, PasswordInput } from '../../components/ui/field';
import { Chip, EmptyState } from '../../components/ui/misc';
import { api } from '../../lib/api';
import { useTenant } from '../../lib/tenant-context';
import { applyApiError } from '../../lib/errors';

const schema = z.object({
  name: personName,
  email,
  password,
  intent: z.enum(['STUDENT', 'ALUMNI']),
  isAdult: z.boolean().refine((v) => v, 'You must be 18 or older to join'),
  consents: z
    .array(z.string())
    .refine((c) => c.includes('account'), 'This one is needed to create your account'),
});
type Form = z.infer<typeof schema>;

export function SignUpPage() {
  const { t, i18n } = useTranslation();
  const tenant = useTenant();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<Form>({
    mode: 'onTouched',
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      intent: 'STUDENT',
      isAdult: false,
      consents: ['account', 'mentorship_matching'],
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.post('/auth/signup', {
        ...values,
        isAdult: true,
        locale: i18n.language === 'te' ? 'te' : 'en',
      });
      setSentTo(values.email);
    } catch (err) {
      applyApiError(err, form.setError, t('errors.generic'), 'password');
    }
  });

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
      subtitle={t('auth.signUpSub')}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={errors.root?.message} />
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
        <Field label={t('common.password')} hint={t('auth.passwordHint')} error={errors.password?.message}>
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

        <fieldset className="grid gap-3 rounded-[var(--radius-md)] border border-line p-4">
          <legend className="px-1 text-meta font-semibold">{t('auth.consentTitle')}</legend>
          <Controller
            control={form.control}
            name="consents"
            render={({ field }) => (
              <>
                {CONSENT_PURPOSE_KEYS.map((p: ConsentPurpose) => (
                  <Checkbox
                    key={p}
                    id={`consent-${p}`}
                    checked={field.value.includes(p)}
                    onChange={(on) =>
                      field.onChange(on ? [...field.value, p] : field.value.filter((x) => x !== p))
                    }
                  >
                    {t(`auth.consent.${p}`)}
                    {CONSENT_PURPOSES[p].required && (
                      <span className="sr-only"> ({t('settings.required')})</span>
                    )}
                  </Checkbox>
                ))}
              </>
            )}
          />
          {errors.consents && (
            <p role="alert" className="text-caption font-medium text-danger">
              {errors.consents.message}
            </p>
          )}
          <p className="text-caption text-fg-3">{t('auth.privacyNote')}</p>
        </fieldset>

        <Controller
          control={form.control}
          name="isAdult"
          render={({ field }) => (
            <Checkbox
              id="adult"
              checked={field.value}
              onChange={field.onChange}
              {...(errors.isAdult ? { describedBy: 'adult-err' } : {})}
            >
              {t('auth.adult')}
            </Checkbox>
          )}
        />
        {errors.isAdult && (
          <p id="adult-err" role="alert" className="-mt-2 text-caption font-medium text-danger">
            {errors.isAdult.message}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
          {t('auth.signUpCta')}
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
