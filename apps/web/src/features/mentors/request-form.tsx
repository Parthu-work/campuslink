import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock } from 'lucide-react';
import {
  isBookable,
  REQUEST_MESSAGE_MAX,
  REQUEST_MESSAGE_MIN,
  type MentorCard,
  type RequestView,
  type SessionType,
  type SlotsView,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Field, Input, Select } from '../../components/ui/field';
import { EmptyState } from '../../components/ui/misc';
import { Illustration } from '../../components/ui/illustration';
import { SlotPicker } from '../../components/ui/slot-picker';
import { Stepper } from '../../components/ui/stepper';
import { FormError } from '../../components/layout/auth-layout';
import { ApiError, api } from '../../lib/api';
import { useCan } from '../../lib/me';
import { interviews, resumes } from '../../lib/queries';
import { focusOnMount } from '../../lib/focus';
import { formatDateTime, newIdempotencyKey } from '../../lib/format';
import { firstName } from '../../lib/names';
import { stripDemo } from './mentor-text';

/** Each answer stays short: two sentences, not an essay (the message as a whole keeps the API's limits). */
const PART_MAX = 600;

/**
 * Asking a senior for help in three steps (prompt 3, U6): what you need (each session type said in
 * plain words), your goal (two short answers with examples), then when (the senior's free slots)
 * with a preview of exactly what they will see. The two answers become the one message the API
 * takes, headed "Goal:" and "What I need:" as before. Loads in its own chunk.
 */
export function RequestForm({ mentor }: { mentor: MentorCard }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [type, setType] = useState<SessionType>(mentor.sessionTypes[0]?.type ?? 'quick_chat');
  const [slot, setSlot] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  const [need, setNeed] = useState('');
  const [short, setShort] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const bookable = isBookable(type);
  const name = stripDemo(mentor.name);
  const first = firstName(name);
  // Prompt 2, G2: a résumé review can carry one of the mentee's résumés (the mentor opens it).
  const canResumes = useCan('resumes:manage');
  const myResumes = useQuery({ ...resumes(), enabled: canResumes && type === 'resume_review' });
  const [resumeId, setResumeId] = useState<string | null>(null);
  const chosenResume = type === 'resume_review' ? (resumeId ?? myResumes.data?.[0]?.id ?? '') : '';
  // Prompt 2, G3: a mock interview can share a finished practice report (the mentor opens it).
  const canPractise = useCan('interviews:practice');
  const practice = useQuery({ ...interviews(), enabled: canPractise && type === 'mock_interview' });
  const reports = (practice.data?.sessions ?? []).filter((x) => x.status === 'completed');
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const chosenReport = type === 'mock_interview' ? (interviewId ?? reports[0]?.id ?? '') : '';
  const slots = useQuery({
    queryKey: ['slots', mentor.userId, type],
    queryFn: () => api.get<SlotsView>(`/mentors/${mentor.userId}/slots?type=${type}&days=14`),
    enabled: bookable,
  });
  // The one message the senior reads, in the headings they already know.
  const message = [
    goal.trim() && `${t('request.prompt.goal')}: ${goal.trim()}`,
    need.trim() && `${t('request.prompt.need')}: ${need.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const send = useMutation({
    mutationFn: () =>
      api.postOnce<RequestView>(
        '/mentorship/requests',
        {
          mentorId: mentor.userId,
          sessionType: type,
          message,
          ...(bookable && slot ? { slotStart: slot } : {}),
          ...(chosenResume ? { resumeId: chosenResume } : {}),
          ...(chosenReport ? { interviewId: chosenReport } : {}),
        },
        key,
      ),
    onSuccess: () => setKey(newIdempotencyKey()),
    onError: () => void slots.refetch(),
  });

  if (send.isSuccess)
    return (
      <div role="status">
        <EmptyState
          art={<Illustration kind="done" />}
          title={t('request.sentTitle')}
          action={
            <Link to="/mentorship?box=sent" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              {t('request.track')}
            </Link>
          }
        >
          <span ref={focusOnMount} tabIndex={-1} className="outline-none">
            {send.data.slotStart
              ? t('request.sentBodySlot', { name, time: formatDateTime(send.data.slotStart) })
              : t('request.sentBody', { name })}
          </span>
        </EmptyState>
      </div>
    );

  const steps = [
    t('mentoring.stepNeed'),
    t('mentoring.stepGoal'),
    bookable ? t('mentoring.stepWhen') : t('mentoring.stepCheck'),
  ];
  const back = (to: 0 | 1) => (
    <Button variant="tertiary" className="justify-self-start" onClick={() => setStep(to)}>
      <ArrowLeft aria-hidden /> {t('common.back')}
    </Button>
  );
  const shared = [
    chosenResume && myResumes.data?.find((r) => r.id === chosenResume)?.title,
    chosenReport && t('request.report'),
  ].filter(Boolean) as string[];

  if (step === 0)
    return (
      <div className="grid gap-5">
        <Stepper label={t('request.steps')} steps={steps} current={0} />
        <p className="text-callout text-fg-2">{t('request.noColdDms')}</p>
        <ChoiceGroup
          label={t('mentoring.stepNeed')}
          value={type}
          columns={1}
          options={mentor.sessionTypes.map((s) => ({
            value: s.type,
            label: t(`session.type.${s.type}`),
            detail: (
              <span className="grid gap-0.5">
                <span>{t(`mentoring.about.${s.type}`)}</span>
                <span className="flex items-center gap-1 text-fg-3">
                  <Clock className="size-3.5" aria-hidden />
                  {s.durationMin ? t('session.minutes', { n: s.durationMin }) : t('session.async')}
                </span>
              </span>
            ),
          }))}
          onChange={(v) => {
            setType(v);
            setSlot(null);
          }}
        />
        {type === 'resume_review' && !!myResumes.data?.length && (
          <Field label={t('request.resume')} hint={t('request.resumeHint', { name: first })}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={chosenResume}
                onChange={(e) => setResumeId(e.target.value)}
              >
                <option value="">{t('request.noResume')}</option>
                {myResumes.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {type === 'mock_interview' && reports.length > 0 && (
          <Field label={t('request.report')} hint={t('request.reportHint', { name: first })}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={chosenReport}
                onChange={(e) => setInterviewId(e.target.value)}
              >
                <option value="">{t('request.noReport')}</option>
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.company
                      ? t('request.reportNameCompany', {
                          company: r.company,
                          date: formatDateTime(r.createdAt),
                        })
                      : t('request.reportName', { date: formatDateTime(r.createdAt) })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Button variant="primary" size="lg" disabled={!mentor.open} onClick={() => setStep(1)}>
          {t('common.continue')}
        </Button>
      </div>
    );

  if (step === 1) {
    const next = () => {
      if (message.length < REQUEST_MESSAGE_MIN || !goal.trim() || !need.trim()) setShort(true);
      else {
        setShort(false);
        setStep(2);
      }
    };
    return (
      <form
        className="grid gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        <Stepper label={t('request.steps')} steps={steps} current={1} />
        {back(0)}
        <Field
          label={t('mentoring.goalLabel')}
          hint={t('mentoring.goalExample')}
          error={short && !goal.trim() ? t('mentoring.tooShort', { min: REQUEST_MESSAGE_MIN }) : undefined}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              maxLength={PART_MAX}
              autoFocus
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('mentoring.needLabel')}
          hint={t('mentoring.needExample')}
          error={short && !need.trim() ? t('mentoring.tooShort', { min: REQUEST_MESSAGE_MIN }) : undefined}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              maxLength={PART_MAX}
              value={need}
              onChange={(e) => setNeed(e.target.value)}
            />
          )}
        </Field>
        {short && goal.trim() && need.trim() && (
          <p role="alert" className="text-callout font-medium text-danger">
            {t('mentoring.tooShort', { min: REQUEST_MESSAGE_MIN })}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg">
          {t('common.continue')}
        </Button>
      </form>
    );
  }

  const error =
    send.error instanceof ApiError ? send.error.message : send.error ? t('errors.generic') : undefined;
  return (
    <div className="grid gap-5">
      <Stepper label={t('request.steps')} steps={steps} current={2} />
      {back(1)}
      {bookable && (
        <SlotPicker
          label={t('request.pickTime')}
          slots={slots.data?.slots ?? []}
          value={slot}
          onChange={setSlot}
          loading={slots.isLoading}
        />
      )}
      <section
        aria-labelledby="request-preview"
        className="grid gap-2 rounded-[var(--radius-md)] border border-line bg-surface-2 p-4"
      >
        <h3 id="request-preview" className="text-headline font-semibold">
          {t('mentoring.preview', { name: first })}
        </h3>
        <p className="text-callout font-semibold">
          {t(`session.type.${type}`)}
          {bookable && slot ? ` · ${formatDateTime(slot)}` : ''}
        </p>
        <p className="text-body whitespace-pre-line">{message}</p>
        {shared.length > 0 && (
          <p className="text-callout text-fg-2">
            {t('mentoring.previewShared', { what: shared.join(', ') })}
          </p>
        )}
      </section>
      <FormError message={error} />
      <Button
        variant="primary"
        size="lg"
        loading={send.isPending}
        disabled={!mentor.open || (bookable && !slot) || message.length > REQUEST_MESSAGE_MAX}
        onClick={() => send.mutate()}
      >
        {t('request.send')}
      </Button>
      {bookable && !slot && (
        <p className="-mt-3 text-center text-caption text-fg-3">{t('request.pickFirst')}</p>
      )}
    </div>
  );
}
