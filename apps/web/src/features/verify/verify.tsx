import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Compass, IdCard, Orbit, UserRound } from 'lucide-react';
import { TOPICS, type FollowState } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Illustration } from '../../components/ui/illustration';
import { IntentLink } from '../../components/ui/intent-link';
import { Stepper } from '../../components/ui/stepper';
import { Field, Input, Textarea } from '../../components/ui/field';
import { Card, Chip, Crest, EmptyState, Skeleton } from '../../components/ui/misc';
import { OtpInput } from '../../components/ui/otp';
import { PageHeader } from '../../components/ui/page-header';
import { FormError } from '../../components/layout/auth-layout';
import { api, ApiError } from '../../lib/api';
import { useTenant } from '../../lib/tenant-context';
import { useMe } from '../../lib/me';
import { celebrate } from '../../lib/celebrate';
import { useFollow } from '../../lib/follows';

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
  const college = tenant.branding.shortName;

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

  const confirm = async (value = code) => {
    if (step.kind !== 'code' || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.post('/verification/roll/confirm', { challengeId: step.challengeId, code: value });
      await finish();
    } catch (err) {
      setError(errMsg(err, t('errors.generic')));
    } finally {
      setBusy(false);
    }
  };

  if (status.isLoading) return <Skeleton className="mx-auto h-80 w-full max-w-[560px]" />;
  if (step.kind === 'done') return <YoureIn />;
  if (status.data?.verified) {
    return (
      <Card className="mx-auto w-full max-w-[560px] p-6">
        <EmptyState
          art={<Illustration kind="done" />}
          title={t('verify.done')}
          action={
            <Link to="/people" className={buttonVariants({ variant: 'primary' })}>
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
      <Card className="mx-auto w-full max-w-[560px] p-6">
        <EmptyState art={<Illustration kind="calendar" />} title={t('verify.pendingTitle')}>
          {t('verify.pendingBody')}
        </EmptyState>
      </Card>
    );
  }

  const byId = step.kind === 'id';
  const steps = byId
    ? [t('verify.steps.photo'), t('verify.steps.review'), t('verify.steps.in')]
    : [t('verify.steps.find'), t('verify.steps.code'), t('verify.steps.in')];
  return (
    <div className="mx-auto grid w-full max-w-[560px] gap-4">
      <section className="aurora-mesh grid justify-items-center gap-3 rounded-[var(--radius-xl)] border border-line px-5 pt-7 pb-5 text-center">
        <Crest monogram={tenant.branding.monogram} size={56} />
        <PageHeader
          className="justify-center text-center [&_p]:mx-auto"
          title={t('verify.title', { college })}
          intro={t('verify.intro')}
        />
        <Stepper
          className="mt-2 w-full max-w-[420px]"
          label={t('verify.steps.label')}
          steps={steps}
          current={step.kind === 'code' ? 1 : 0}
        />
      </section>
      {status.data?.request?.status === 'rejected' && (
        <FormError
          message={`${t('verify.rejectedTitle')}. ${t('verify.rejectedBody', { reason: status.data.request.reason ?? '' })}`}
        />
      )}
      <Card variant="raised" className="grid gap-4 p-5 sm:p-6">
        {step.kind === 'roll' && (
          <form onSubmit={find} className="grid gap-4">
            <FormError message={error} />
            <Field label={t('verify.roll')}>
              {({ id }) => (
                <Input
                  id={id}
                  value={roll}
                  onChange={(e) => setRoll(e.target.value)}
                  className="min-h-14 font-mono text-lead tracking-wider uppercase"
                  autoComplete="off"
                  autoCapitalize="characters"
                  enterKeyHint={isAlumni ? 'next' : 'go'}
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
                    enterKeyHint="go"
                    className="min-h-14 font-mono text-lead"
                  />
                )}
              </Field>
            )}
            {notice && (
              <p role="status" className="rounded-[var(--radius-md)] bg-surface-2 px-4 py-3 text-meta">
                {notice}
              </p>
            )}
            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={busy}
                disabled={roll.trim().length < 4}
              >
                {t('verify.find')}
              </Button>
              <Button variant="ghost" size="lg" onClick={() => setStep({ kind: 'id' })}>
                <IdCard className="size-5" aria-hidden /> {t('verify.useId')}
              </Button>
            </div>
          </form>
        )}
        {step.kind === 'code' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
            className="grid gap-4"
          >
            <h2 className="text-title font-semibold">{t('verify.codeTitle')}</h2>
            <p className="text-fg-2" role="status">
              {t('verify.codeSent', { destination: step.destination })}
            </p>
            <FormError message={error} />
            <OtpInput
              value={code}
              onChange={setCode}
              label={t('verify.codeTitle')}
              autoFocus
              onComplete={(c) => void confirm(c)}
            />
            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <Button type="submit" variant="primary" size="lg" loading={busy} disabled={code.length !== 6}>
                {t('verify.confirm')}
              </Button>
              <Button variant="ghost" size="lg" onClick={() => setStep({ kind: 'roll' })}>
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
    </div>
  );
}

/**
 * The "You're in" moment (master prompt §3): an aurora burst, then the topics to hear about first
 * and three good next steps. Shown once, right after this member verified.
 */
function YoureIn() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const hero = useRef<HTMLHeadingElement>(null);
  const follows = useQuery({ queryKey: ['follows'], queryFn: () => api.get<FollowState>('/me/follows') });
  const follow = useFollow();
  useEffect(() => {
    celebrate(hero.current);
    hero.current?.focus();
  }, []);
  const f = follows.data;
  const next = [
    ['/mentors', Compass, 'verify.nextMentor', 'verify.nextMentorBody'],
    ['/profile', UserRound, 'verify.nextProfile', 'verify.nextProfileBody'],
    ['/roadmaps', Orbit, 'verify.nextRoadmaps', 'verify.nextRoadmapsBody'],
  ] as const;
  return (
    <div className="mx-auto grid w-full max-w-[560px] gap-4">
      <section className="aurora-mesh grid justify-items-center gap-2 rounded-[var(--radius-xl)] border border-line px-5 py-8 text-center">
        <Illustration kind="done" size={120} />
        <h1 ref={hero} tabIndex={-1} className="text-display font-bold">
          {t('verify.youreIn')}
        </h1>
        <p className="max-w-[44ch] text-lead text-fg-2">
          {t('verify.youreInBody', { college: tenant.branding.shortName })}
        </p>
      </section>
      <Card variant="raised" className="grid gap-3 p-5">
        <div>
          <h2 className="text-title font-semibold">{t('verify.interestsTitle')}</h2>
          <p className="text-meta text-fg-2">{t('verify.interestsBody')}</p>
        </div>
        <div role="group" aria-label={t('verify.interestsTitle')} className="flex flex-wrap gap-2">
          {TOPICS.map((tp) => {
            const on = !!f?.topics.includes(tp);
            return (
              <Chip
                key={tp}
                pressed={on}
                disabled={!f}
                onClick={() => follow.mutate({ type: 'topic', id: tp, on: !on })}
              >
                {t(`topics.${tp}`)}
              </Chip>
            );
          })}
        </div>
      </Card>
      <nav aria-label={t('verify.nextTitle')} className="grid gap-2">
        <h2 className="text-title font-semibold">{t('verify.nextTitle')}</h2>
        {next.map(([to, Icon, title, body]) => (
          <IntentLink key={to} to={to} className="block">
            <Card variant="interactive" className="flex items-center gap-3 p-4">
              <span className="grid size-11 flex-none place-items-center rounded-full bg-brand-surface text-brand-ink">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-body">{t(title)}</b>
                <span className="block text-meta text-fg-2">{t(body)}</span>
              </span>
              <ChevronRight className="size-5 flex-none text-fg-3" aria-hidden />
            </Card>
          </IntentLink>
        ))}
      </nav>
    </div>
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
    <form onSubmit={submit} className="grid gap-4">
      <h2 className="text-title font-semibold">{t('verify.idTitle')}</h2>
      <p className="text-fg-2">{t('verify.idBody')}</p>
      <FormError message={error} />
      <Field label={t('verify.roll')}>
        {({ id }) => (
          <Input
            id={id}
            value={roll}
            onChange={(e) => setRoll(e.target.value)}
            className="min-h-14 font-mono text-lead tracking-wider uppercase"
            autoCapitalize="characters"
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
            className="text-meta file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-surface-2 file:px-4 file:font-semibold file:text-fg"
            required
          />
        )}
      </Field>
      <Field label={t('verify.note')}>
        {({ id }) => (
          <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        )}
      </Field>
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={busy}
          disabled={!file || roll.trim().length < 4}
        >
          {t('verify.submit')}
        </Button>
        <Button variant="ghost" size="lg" onClick={onBack}>
          {t('verify.useRoll')}
        </Button>
      </div>
    </form>
  );
}
