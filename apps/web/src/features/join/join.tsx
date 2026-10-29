import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Link2Off } from 'lucide-react';
import {
  BIRTH_MONTH,
  plausibleBirthMonth,
  rollNumber as rollSchema,
  type ClaimCodeSent,
  type MentorSettingsView,
  type OtpChannel,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { AuthLayout, FormError } from '../../components/layout/auth-layout';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Field, Input } from '../../components/ui/field';
import { EmptyState } from '../../components/ui/misc';
import { Illustration } from '../../components/ui/illustration';
import { Switch } from '../../components/ui/switch';
import { TagInput } from '../../components/ui/tag-input';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { applyApiError } from '../../lib/errors';
import { celebrate } from '../../lib/celebrate';
import * as q from '../../lib/queries';
import { BirthMonthField, ConsentFields, PhoneCodeStep } from '../auth/phone-parts';

type Joined = { kind: 'student' | 'alumni'; session: { accessToken: string } };
type ClaimFields = { birthMonth: string; consents: string[]; locale: 'en' | 'te' };

const claimSchema = z.object({
  rollNumber: z.string(),
  birthMonth: z
    .string()
    .refine((v) => BIRTH_MONTH.test(v), 'Choose the month and year you were born')
    .refine((v) => !BIRTH_MONTH.test(v) || plausibleBirthMonth(v), 'Check the year and month you were born'),
  consents: z
    .array(z.string())
    .refine((c) => c.includes('account'), 'This one is needed to create your account'),
});
type ClaimForm = z.infer<typeof claimSchema>;

/**
 * The shared steps of joining by invite link or class code (B4): birth month and consents (plus
 * the roll number for a class code), a code to the contact on the college's record, then in.
 */
function ClaimFlow({
  title,
  intro,
  askRoll,
  start,
  confirm,
}: {
  title: string;
  intro: ReactNode;
  askRoll: boolean;
  start: (roll: string, channel?: OtpChannel) => Promise<ClaimCodeSent>;
  confirm: (body: ClaimFields & { challengeId: string; code: string }) => Promise<Joined>;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setToken = useSession((s) => s.setToken);
  const [sent, setSent] = useState<ClaimCodeSent | null>(null);
  const [alumni, setAlumni] = useState(false);
  const locale = i18n.language === 'te' ? 'te' : 'en';
  const form = useForm<ClaimForm>({
    mode: 'onTouched',
    resolver: zodResolver(
      askRoll
        ? claimSchema.refine((v) => rollSchema.safeParse(v.rollNumber).success, {
            path: ['rollNumber'],
            message: 'Enter your roll number as it appears on your ID card',
          })
        : claimSchema,
    ),
    defaultValues: { rollNumber: '', birthMonth: '', consents: ['account', 'mentorship_matching'] },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      setSent(await start(v.rollNumber.trim().toUpperCase()));
    } catch (err) {
      applyApiError(err, form.setError, t('errors.generic'));
    }
  });

  if (alumni) return <AlumniQuickStart />;

  if (sent) {
    const v = form.getValues();
    return (
      <AuthLayout title={t('phone.codeTitle')} subtitle={t('join.codeSub')}>
        <PhoneCodeStep
          sent={sent}
          backLabel={t('common.back')}
          onBack={() => setSent(null)}
          onResend={(channel) => start(v.rollNumber.trim().toUpperCase(), channel)}
          onCode={async (code, challengeId) => {
            const r = await confirm({
              challengeId,
              code,
              birthMonth: v.birthMonth,
              consents: v.consents,
              locale,
            });
            setToken(r.session.accessToken);
            await qc.invalidateQueries({ queryKey: ['me'] });
            // Joining verified is the verification moment ADR 0008 lists, and it happens once.
            celebrate();
            if (r.kind === 'alumni') setAlumni(true);
            else navigate('/home', { replace: true });
          }}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={title}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {intro}
        <FormError message={errors.root?.message} />
        {askRoll && (
          <Field label={t('join.rollNumber')} hint={t('join.rollHint')} error={errors.rollNumber?.message}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                autoComplete="off"
                autoCapitalize="characters"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className="font-mono uppercase"
                {...form.register('rollNumber')}
              />
            )}
          </Field>
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
          {t('join.sendCode')}
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

/** A link or code that no longer works: say so plainly and offer the other ways in. */
function Unusable({ error, kind }: { error: unknown; kind: 'invite' | 'code' }) {
  const { t } = useTranslation();
  const gone = error instanceof ApiError && (error.status === 404 || error.status === 400);
  return (
    <AuthLayout title={t(gone ? `join.${kind}Gone` : 'errors.generic')}>
      <EmptyState
        icon={<Link2Off className="size-6" />}
        title={t(gone ? `join.${kind}Gone` : 'errors.generic')}
        action={
          <Link to="/sign-up" className={buttonVariants({ variant: 'primary' })}>
            {t('join.signUpInstead')}
          </Link>
        }
      >
        <p>{t(`join.${kind}GoneBody`)}</p>
      </EmptyState>
    </AuthLayout>
  );
}

/** `/invite/:token`: a personal link from the college (WhatsApp or the college's own message). */
export function InvitePage() {
  const { t } = useTranslation();
  const token = useParams().token ?? '';
  const info = useQuery(q.invite(token));
  if (info.isPending) return <AuthLayout title={t('join.inviteLoading')}>{null}</AuthLayout>;
  if (info.isError) return <Unusable error={info.error} kind="invite" />;
  const v = info.data;
  if (!v.contact) {
    return (
      <AuthLayout title={t('join.inviteTitle', { name: v.firstName, college: v.college })}>
        <EmptyState icon={<Link2Off className="size-6" />} title={t('join.noContact')}>
          <p>{t('join.noContactBody')}</p>
        </EmptyState>
      </AuthLayout>
    );
  }
  return (
    <ClaimFlow
      title={t('join.inviteTitle', { name: v.firstName, college: v.college })}
      askRoll={false}
      intro={
        <div className="grid gap-2 rounded-[var(--radius-md)] bg-surface-2 p-4">
          <p className="flex items-center gap-2 font-semibold">
            <BadgeCheck className="size-5 flex-none text-brand-ink" aria-hidden />
            {t(v.kind === 'alumni' ? 'join.inviteAlumni' : 'join.inviteStudent')}
          </p>
          <p className="text-meta text-fg-2">
            {t('join.rollOnRecord')} <span className="font-mono">{v.rollNumber}</span>
          </p>
          <p className="text-meta text-fg-2">
            {t(v.contact === 'phone' ? 'join.codeToPhone' : 'join.codeToEmail')}
          </p>
        </div>
      }
      start={(_roll, channel) =>
        api.post<ClaimCodeSent>(`/invite/${token}/accept`, channel ? { channel } : {})
      }
      confirm={(body) => api.post<Joined>(`/invite/${token}/accept/confirm`, body)}
    />
  );
}

/** `/join/:code`: a class code from a poster or the class WhatsApp group; the roll number finds you. */
export function JoinPage() {
  const { t } = useTranslation();
  const code = useParams().code ?? '';
  const info = useQuery(q.joinCode(code));
  if (info.isPending) return <AuthLayout title={t('join.inviteLoading')}>{null}</AuthLayout>;
  if (info.isError) return <Unusable error={info.error} kind="code" />;
  const v = info.data;
  const cls = [v.branch, v.gradYear].filter(Boolean).join(' · ');
  return (
    <ClaimFlow
      title={t('join.codeTitle', { college: v.college })}
      askRoll
      intro={
        <p className="rounded-[var(--radius-md)] bg-surface-2 p-4 text-fg-2">
          {t(v.kind === 'alumni' ? 'join.codeForAlumni' : 'join.codeForStudents', { class: cls || '—' })}
        </p>
      }
      start={(roll, channel) =>
        api.post<ClaimCodeSent>(`/join/${code}/start`, { rollNumber: roll, ...(channel ? { channel } : {}) })
      }
      confirm={(body) => api.post<Joined>(`/join/${code}/confirm`, body)}
    />
  );
}

/** Alumni, right after joining: three quick answers, all skippable (B4). */
function AlumniQuickStart() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [mentor, setMentor] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const home = () => navigate('/home', { replace: true });

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.put('/me/profile', {
        ...(company.trim() ? { company: company.trim() } : {}),
        ...(jobTitle.trim() ? { jobTitle: jobTitle.trim() } : {}),
        ...(topics.length ? { topics } : {}),
      });
      if (mentor) {
        const { availability: _availability, ...settings } = await api.get<MentorSettingsView>('/me/mentor');
        // Thirty minutes a month is one session: open to requests, one a week at most.
        await api.put('/me/mentor', { ...settings, accepting: true, weeklyCap: 1 });
      }
      home();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.generic'));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('join.alumniTitle')} subtitle={t('join.alumniSub')}>
      <div className="grid gap-4">
        <div className="grid place-items-center">
          <Illustration kind="people" size={96} />
        </div>
        <FormError message={error} />
        <Field label={t('join.company')}>
          {({ id }) => (
            <Input
              id={id}
              autoComplete="organization"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('join.jobTitle')}>
          {({ id }) => (
            <Input
              id={id}
              autoComplete="organization-title"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />
          )}
        </Field>
        <TagInput
          label={t('join.topics')}
          hint={t('profile.tagHint')}
          value={topics}
          onChange={setTopics}
          max={15}
        />
        <Switch
          checked={mentor}
          onChange={setMentor}
          label={t('join.mentorAsk')}
          description={t('join.mentorAskHint')}
        />
        <Button variant="primary" size="lg" loading={busy} onClick={() => void save()}>
          {t('join.alumniSave')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={home}>
          {t('join.skip')}
        </Button>
      </div>
    </AuthLayout>
  );
}
