import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Clock, IdCard } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Field, Input, Textarea } from '../../components/ui/field';
import { Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { OtpInput } from '../../components/ui/otp';
import { PageHeader } from '../../components/ui/page-header';
import { FormError } from '../../components/layout/auth-layout';
import { api, ApiError } from '../../lib/api';
import { useTenant } from '../../lib/tenant-context';
import { useMe } from '../../lib/me';

type Status = {
  verified: boolean;
  smsAvailable: boolean;
  request: { status: 'pending' | 'rejected'; reason: string | null } | null;
};
type Start =
  | { status: 'no_match' | 'no_contact' | 'verified' }
  | { status: 'code_sent'; challengeId: string; destination: string };
type Step =
  | { kind: 'roll' }
  | { kind: 'code'; challengeId: string; destination: string }
  | { kind: 'id' }
  | { kind: 'done' };

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function VerifyPage() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const status = useQuery({ queryKey: ['verification'], queryFn: () => api.get<Status>('/verification') });
  const [step, setStep] = useState<Step>({ kind: 'roll' });
  const [roll, setRoll] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const isAlumni = me?.roles.includes('ALUMNI');

  const finish = async () => {
    setStep({ kind: 'done' });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['me'] }),
      qc.invalidateQueries({ queryKey: ['verification'] }),
    ]);
  };

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const r = await api.post<Start>('/verification/roll', {
        rollNumber: roll,
        ...(gradYear ? { gradYear: Number(gradYear) } : {}),
      });
      if (r.status === 'verified') await finish();
      else if (r.status === 'code_sent')
        setStep({ kind: 'code', challengeId: r.challengeId, destination: r.destination });
      else setNotice(r.status === 'no_contact' ? t('verify.noContact') : t('verify.noMatch'));
    } catch (err) {
      setError(errMsg(err, t('errors.generic')));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step.kind !== 'code') return;
    setBusy(true);
    setError(undefined);
    try {
      await api.post('/verification/roll/confirm', { challengeId: step.challengeId, code });
      await finish();
    } catch (err) {
      setError(errMsg(err, t('errors.generic')));
    } finally {
      setBusy(false);
    }
  };

  if (status.isLoading) return <Skeleton className="h-64" />;
  if (status.data?.verified || step.kind === 'done') {
    return (
      <Card className="p-6">
        <EmptyState
          icon={<BadgeCheck className="size-6" />}
          title={t('verify.done')}
          action={
            <Link to="/people" className="font-semibold text-brand-ink hover:underline">
              {t('nav.people')}
            </Link>
          }
        >
          {t('verify.doneBody')}
        </EmptyState>
      </Card>
    );
  }
  if (status.data?.request?.status === 'pending') {
    return (
      <Card className="p-6">
        <EmptyState icon={<Clock className="size-6" />} title={t('verify.pendingTitle')}>
          {t('verify.pendingBody')}
        </EmptyState>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title={t('verify.title', { college: tenant.branding.shortName })} />
      {status.data?.request?.status === 'rejected' && (
        <FormError
          message={`${t('verify.rejectedTitle')}. ${t('verify.rejectedBody', { reason: status.data.request.reason ?? '' })}`}
        />
      )}
      <Card className="grid gap-4 p-5">
        {step.kind === 'roll' && (
          <form onSubmit={find} className="grid max-w-md gap-4">
            <p className="text-fg-2">{t('verify.intro')}</p>
            <FormError message={error} />
            <Field label={t('verify.roll')}>
              {({ id }) => (
                <Input
                  id={id}
                  value={roll}
                  onChange={(e) => setRoll(e.target.value)}
                  className="font-mono uppercase"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  minLength={4}
                />
              )}
            </Field>
            {isAlumni && (
              <Field label={t('verify.gradYear')} hint={t('verify.gradYearHint')}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={gradYear}
                    onChange={(e) => setGradYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    inputMode="numeric"
                    className="font-mono"
                  />
                )}
              </Field>
            )}
            {notice && (
              <p role="status" className="rounded-[var(--radius-sm)] bg-surface-2 px-3.5 py-2.5 text-sm">
                {notice}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={busy} disabled={roll.trim().length < 4}>
                {t('verify.find')}
              </Button>
              <Button variant="ghost" onClick={() => setStep({ kind: 'id' })}>
                <IdCard className="size-4" aria-hidden /> {t('verify.useId')}
              </Button>
            </div>
          </form>
        )}
        {step.kind === 'code' && (
          <form onSubmit={confirm} className="grid max-w-md gap-4">
            <h2 className="text-lg font-semibold">{t('verify.codeTitle')}</h2>
            <p className="text-fg-2" role="status">
              {t('verify.codeSent', { destination: step.destination })}
            </p>
            <FormError message={error} />
            <OtpInput value={code} onChange={setCode} label={t('verify.codeTitle')} autoFocus />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>
                {t('verify.confirm')}
              </Button>
              <Button variant="ghost" onClick={() => setStep({ kind: 'roll' })}>
                {t('common.back')}
              </Button>
            </div>
          </form>
        )}
        {step.kind === 'id' && (
          <IdCardForm
            defaultRoll={roll}
            onDone={() => void qc.invalidateQueries({ queryKey: ['verification'] })}
            onBack={() => setStep({ kind: 'roll' })}
          />
        )}
      </Card>
    </>
  );
}

function IdCardForm({
  defaultRoll,
  onDone,
  onBack,
}: {
  defaultRoll: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [roll, setRoll] = useState(defaultRoll);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData();
    form.set('rollNumber', roll);
    if (note) form.set('note', note);
    form.set('photo', file);
    try {
      await api.upload('/verification/id-card', form);
      onDone();
    } catch (err) {
      setError(errMsg(err, t('errors.generic')));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid max-w-md gap-4">
      <h2 className="text-lg font-semibold">{t('verify.idTitle')}</h2>
      <p className="text-fg-2">{t('verify.idBody')}</p>
      <FormError message={error} />
      <Field label={t('verify.roll')}>
        {({ id }) => (
          <Input
            id={id}
            value={roll}
            onChange={(e) => setRoll(e.target.value)}
            className="font-mono uppercase"
            required
            minLength={4}
          />
        )}
      </Field>
      <Field label={t('verify.photo')}>
        {({ id }) => (
          <input
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-surface-2 file:px-4 file:font-semibold file:text-fg"
            required
          />
        )}
      </Field>
      <Field label={t('verify.note')}>
        {({ id }) => (
          <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" loading={busy} disabled={!file || roll.trim().length < 4}>
          {t('verify.submit')}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          {t('verify.useRoll')}
        </Button>
      </div>
    </form>
  );
}
