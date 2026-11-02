import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { phone as phoneSchema, type CodeSent, type OtpChannel } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, PasswordInput } from '../../components/ui/field';
import { Card } from '../../components/ui/misc';
import { FormError } from '../../components/layout/auth-layout';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/me';
import { maskPhone, toE164 } from '../../lib/phone';
import { toast } from '../../lib/toast';
import { PhoneCodeStep, PhoneField } from '../auth/phone-parts';

type Step = CodeSent & { step: 'old' | 'new' };

/**
 * Settings › Security › Phone number (B2): a code to the old number (or the password when there is
 * none), then a code to the new number. Other devices are signed out when it changes.
 */
export function PhoneSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const next = toE164(number);
  const needsPassword = !me?.phone;
  const close = () => {
    setOpen(false);
    setStep(null);
    setNumber('');
    setPassword('');
    setError(undefined);
  };
  const start = (channel?: OtpChannel) =>
    api.post<Step>('/me/phone/change', {
      phone: next,
      ...(needsPassword ? { password } : {}),
      ...(channel ? { channel } : {}),
    });

  return (
    <Card className="grid gap-3 p-5">
      <h2 className="text-title font-semibold">{t('phone.settingsTitle')}</h2>
      <p className="text-fg-2">{me?.phone ? maskPhone(me.phone) : t('phone.none')}</p>
      <Button className="justify-self-start" onClick={() => setOpen(true)}>
        {me?.phone ? t('phone.change') : t('phone.add')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => (o ? setOpen(true) : close())}
        title={t('phone.settingsTitle')}
      >
        {step ? (
          <PhoneCodeStep
            key={step.challengeId}
            phone={step.step === 'old' && me?.phone ? me.phone : next}
            sent={step}
            onResend={async (channel) => {
              const r = await start(channel);
              setStep(r);
              return r;
            }}
            onBack={() => setStep(null)}
            onCode={async (code, challengeId) => {
              const r = await api.post<{ done: true } | { done: false; next: Step }>(
                '/me/phone/change/confirm',
                {
                  challengeId,
                  code,
                },
              );
              if (!r.done) return setStep(r.next);
              await qc.invalidateQueries({ queryKey: ['me'] });
              await qc.invalidateQueries({ queryKey: ['sessions'] });
              toast.success(t('phone.changed'));
              close();
            }}
          />
        ) : (
          <form
            noValidate
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!phoneSchema.safeParse(next).success) return setError(t('phone.invalid'));
              setBusy(true);
              setError(undefined);
              try {
                setStep(await start());
              } catch (err) {
                setError(err instanceof ApiError ? err.message : t('errors.generic'));
              } finally {
                setBusy(false);
              }
            }}
          >
            <FormError message={error} />
            <p className="text-meta text-fg-2">{me?.phone ? t('phone.changeHint') : t('phone.addHint')}</p>
            <PhoneField label={t('phone.newNumber')} value={number} onChange={setNumber} autoFocus />
            {needsPassword && (
              <Field label={t('common.password')}>
                {({ id }) => (
                  <PasswordInput
                    id={id}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
              </Field>
            )}
            <Button type="submit" variant="primary" loading={busy}>
              {t('phone.sendCode')}
            </Button>
          </form>
        )}
      </Dialog>
    </Card>
  );
}
