import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarClock, Clock, Plus } from 'lucide-react';
import {
  isBookable,
  REQUEST_MESSAGE_MAX,
  REQUEST_MESSAGE_MIN,
  requestMessage,
  type MentorCard,
  type RequestView,
  type SessionType,
  type SlotsView,
} from '@campuslink/shared';
import type { z } from 'zod';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Field, Textarea } from '../../components/ui/field';
import { EmptyState } from '../../components/ui/misc';
import { Illustration } from '../../components/ui/illustration';
import { SlotPicker } from '../../components/ui/slot-picker';
import { Stepper } from '../../components/ui/stepper';
import { FormError } from '../../components/layout/auth-layout';
import { api } from '../../lib/api';
import { focusOnMount } from '../../lib/focus';
import { applyApiError } from '../../lib/errors';
import { formatDateTime, newIdempotencyKey } from '../../lib/format';
import { firstName } from '../../lib/names';

type Message = z.infer<typeof requestMessage>;
const PROMPTS = ['goal', 'background', 'need'] as const;

/**
 * Asking a mentor for help, in two steps (owner decision Q12): the session type and a time, then
 * one message in the mentee's own words. Optional prompts add "Goal:", "Background:" and "What I
 * need:" headings so mentors still get structure. Loads in its own chunk (the form library and Zod).
 */
export function RequestForm({ mentor }: { mentor: MentorCard }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'session' | 'message'>('session');
  const [type, setType] = useState<SessionType>(mentor.sessionTypes[0]?.type ?? 'quick_chat');
  const [slot, setSlot] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const bookable = isBookable(type);
  const slots = useQuery({
    queryKey: ['slots', mentor.userId, type],
    queryFn: () => api.get<SlotsView>(`/mentors/${mentor.userId}/slots?type=${type}&days=14`),
    enabled: bookable,
  });
  const form = useForm<Message>({
    mode: 'onTouched',
    resolver: zodResolver(requestMessage),
    defaultValues: { message: '' },
  });
  const length = useWatch({ control: form.control, name: 'message' }).length;
  const send = useMutation({
    mutationFn: (text: Message) =>
      api.postOnce<RequestView>(
        '/mentorship/requests',
        {
          mentorId: mentor.userId,
          sessionType: type,
          ...text,
          ...(bookable && slot ? { slotStart: slot } : {}),
        },
        key,
      ),
    onSuccess: () => setKey(newIdempotencyKey()),
    onError: (e) => {
      applyApiError(e, form.setError, t('errors.generic'));
      void slots.refetch();
    },
  });
  const first = firstName(mentor.name);

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
              ? t('request.sentBodySlot', { name: mentor.name, time: formatDateTime(send.data.slotStart) })
              : t('request.sentBody', { name: mentor.name })}
          </span>
        </EmptyState>
      </div>
    );

  const steps = [t('request.stepSession'), t('request.stepMessage')];
  if (step === 'session')
    return (
      <div className="grid gap-5">
        <Stepper label={t('request.steps')} steps={steps} current={0} />
        <p className="text-meta text-fg-2">{t('request.noColdDms')}</p>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-meta font-semibold">{t('request.sessionType')}</legend>
          <ChoiceGroup
            label={t('request.sessionType')}
            value={type}
            columns={1}
            options={mentor.sessionTypes.map((s) => ({
              value: s.type,
              label: t(`session.type.${s.type}`),
              detail: (
                <span className="flex items-center gap-1">
                  <Clock className="size-3.5" aria-hidden />
                  {s.durationMin ? t('session.minutes', { n: s.durationMin }) : t('session.async')}
                </span>
              ),
            }))}
            onChange={(v) => {
              setType(v);
              setSlot(null);
            }}
          />
        </fieldset>
        {bookable && (
          <SlotPicker
            label={t('request.pickTime')}
            slots={slots.data?.slots ?? []}
            value={slot}
            onChange={setSlot}
            loading={slots.isLoading}
          />
        )}
        <Button
          variant="primary"
          size="lg"
          disabled={!mentor.open || (bookable && !slot)}
          onClick={() => setStep('message')}
        >
          {t('common.continue')}
        </Button>
        {bookable && !slot && (
          <p className="-mt-3 text-center text-caption text-fg-3">{t('request.pickFirst')}</p>
        )}
      </div>
    );

  const err = form.formState.errors;
  const { ref: registerRef, ...message } = form.register('message');
  const addPrompt = (p: (typeof PROMPTS)[number]) => {
    const now = form.getValues('message').trimEnd();
    const heading = `${t(`request.prompt.${p}`)}: `;
    form.setValue('message', now ? `${now}\n\n${heading}` : heading, { shouldDirty: true });
    const el = box.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  };
  return (
    <form className="grid gap-5" onSubmit={form.handleSubmit((v) => send.mutate(v))} noValidate>
      <Stepper label={t('request.steps')} steps={steps} current={1} />
      <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-surface-2 px-4 py-3">
        <CalendarClock className="size-5 flex-none text-brand-ink" aria-hidden />
        <p className="min-w-0 flex-1 text-meta">
          <b>{t(`session.type.${type}`)}</b>
          {slot ? ` · ${formatDateTime(slot)}` : ''}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setStep('session')}>
          {t('common.change')}
        </Button>
      </div>
      <Field
        label={t('request.message', { name: first })}
        hint={t('request.messageHint', { min: REQUEST_MESSAGE_MIN })}
        error={err.message?.message}
        aside={<span className="tabular-nums">{`${length}/${REQUEST_MESSAGE_MAX}`}</span>}
      >
        {({ id, describedBy, invalid }) => (
          <>
            <div role="group" aria-label={t('request.prompts')} className="mb-1 flex flex-wrap gap-2">
              {PROMPTS.map((p) => (
                <Button key={p} size="sm" variant="outline" onClick={() => addPrompt(p)}>
                  <Plus className="size-4" aria-hidden /> {t(`request.prompt.${p}`)}
                </Button>
              ))}
            </div>
            <Textarea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              maxLength={REQUEST_MESSAGE_MAX}
              rows={6}
              autoFocus
              enterKeyHint="enter"
              ref={(el) => {
                registerRef(el);
                box.current = el;
              }}
              {...message}
            />
          </>
        )}
      </Field>
      <FormError message={err.root?.message} />
      <div className="grid gap-2 sm:flex sm:flex-row-reverse">
        <Button type="submit" variant="primary" size="lg" loading={send.isPending} disabled={!mentor.open}>
          {t('request.send')}
        </Button>
        <Button variant="ghost" size="lg" onClick={() => setStep('session')}>
          {t('common.back')}
        </Button>
      </div>
    </form>
  );
}
