import { useEffect, useId, useState } from 'react';
import { MessageCircle, Smartphone } from 'lucide-react';
import type { CodeSent, OtpChannel } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Field, Input, Select } from '../../components/ui/field';
import { OtpInput } from '../../components/ui/otp';
import { FormError } from '../../components/layout/auth-layout';
import { ApiError } from '../../lib/api';
import { birthYears, maskPhone } from '../../lib/phone';

/** A mobile number with the +91 prefix shown (members type the ten digits they know). */
export function PhoneField({
  value,
  onChange,
  error,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  label: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label} hint={t('phone.numberHint')} error={error}>
      {({ id, describedBy, invalid }) => (
        <div className="flex items-stretch gap-2">
          <span
            className="grid min-h-12 place-items-center rounded-[var(--radius-md)] border border-line bg-surface-2 px-3 font-mono text-body text-fg-2"
            aria-hidden
          >
            +91
          </span>
          <Input
            id={id}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoFocus={autoFocus}
            className="font-mono"
          />
        </div>
      )}
    </Field>
  );
}

/** Birth month and year (D2): only the date the member turns 18 is kept, never this month. */
export function BirthMonthField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [y = '', m = ''] = value.split('-');
  const months = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(i18n.language === 'te' ? 'te-IN' : 'en-IN', {
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2000, i, 1))),
  );
  const set = (year: string, month: string) =>
    onChange(year && month ? `${year}-${month}` : `${year}-${month}`);
  return (
    <fieldset className="grid gap-1.5" aria-describedby={`${id}-hint${error ? ` ${id}-err` : ''}`}>
      <legend className="mb-1.5 text-meta font-semibold">{t('phone.birthMonth')}</legend>
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2">
        <Select aria-label={t('phone.month')} value={m} onChange={(e) => set(y, e.target.value)}>
          <option value="">{t('phone.month')}</option>
          {months.map((name, i) => (
            <option key={name} value={String(i + 1).padStart(2, '0')}>
              {name}
            </option>
          ))}
        </Select>
        <Select aria-label={t('phone.year')} value={y} onChange={(e) => set(e.target.value, m)}>
          <option value="">{t('phone.year')}</option>
          {birthYears().map((year) => (
            <option key={year} value={String(year)}>
              {year}
            </option>
          ))}
        </Select>
      </div>
      <p id={`${id}-hint`} className="text-caption text-fg-3">
        {t('phone.birthMonthHint')}
      </p>
      {error && (
        <p id={`${id}-err`} role="alert" className="text-caption font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * The code step: six digits that send themselves, which channel the code came by, "send by SMS
 * instead", and resend after a countdown.
 */
export function PhoneCodeStep({
  phone,
  sent,
  onResend,
  onCode,
  onBack,
}: {
  phone: string;
  sent: CodeSent;
  onResend: (channel?: OtpChannel) => Promise<CodeSent>;
  onCode: (code: string, challengeId: string) => Promise<void>;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(sent);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(sent.resendAfterSec);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const submit = async (c = code) => {
    if (busy || c.length !== 6) return;
    setBusy(true);
    setError(undefined);
    try {
      await onCode(c, current.challengeId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.generic'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  const resend = async (channel?: OtpChannel) => {
    setError(undefined);
    try {
      const next = await onResend(channel);
      setCurrent(next);
      setCode('');
      setWait(next.resendAfterSec);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.generic'));
    }
  };
  const Icon = current.channel === 'whatsapp' ? MessageCircle : Smartphone;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="flex items-start gap-2 text-fg-2" role="status">
        <Icon className="mt-0.5 size-5 flex-none text-brand-ink" aria-hidden />
        {t(current.channel === 'whatsapp' ? 'phone.sentWhatsApp' : 'phone.sentSms', {
          phone: maskPhone(phone),
        })}
      </p>
      <FormError message={error} />
      <OtpInput
        value={code}
        onChange={setCode}
        onComplete={(c) => void submit(c)}
        label={t('phone.code')}
        autoFocus
      />
      <Button type="submit" variant="primary" size="lg" loading={busy} disabled={code.length !== 6}>
        {t('phone.confirm')}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          {t('phone.changeNumber')}
        </Button>
        <div className="flex flex-wrap gap-2">
          {current.channel === 'whatsapp' && (
            <Button variant="ghost" disabled={wait > 0} onClick={() => void resend('sms')}>
              {t('phone.smsInstead')}
            </Button>
          )}
          <Button variant="ghost" disabled={wait > 0} onClick={() => void resend(current.channel)}>
            {wait > 0 ? t('phone.resendIn', { seconds: wait }) : t('phone.resend')}
          </Button>
        </div>
      </div>
    </form>
  );
}
