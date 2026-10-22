import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarCheck, Clock } from 'lucide-react';
import {
  isBookable,
  requestText,
  type MentorCard,
  type RequestView,
  type SessionType,
  type SlotsView,
} from '@campuslink/shared';
import type { z } from 'zod';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Field, Textarea } from '../../components/ui/field';
import { Card } from '../../components/ui/misc';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { SlotPicker } from '../../components/ui/slot-picker';
import { FormError } from '../../components/layout/auth-layout';
import { api } from '../../lib/api';
import { focusOnMount } from '../../lib/focus';
import { applyApiError } from '../../lib/errors';
import { formatDateTime, newIdempotencyKey } from '../../lib/format';

type Text = z.infer<typeof requestText>;

/** Loads after the mentor's header (its own chunk: the form library and Zod). */
export function RequestForm({ mentor }: { mentor: MentorCard }) {
  const { t } = useTranslation();
  const [type, setType] = useState<SessionType>(mentor.sessionTypes[0]?.type ?? 'quick_chat');
  const [slot, setSlot] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const bookable = isBookable(type);
  const slots = useQuery({
    queryKey: ['slots', mentor.userId, type],
    queryFn: () => api.get<SlotsView>(`/mentors/${mentor.userId}/slots?type=${type}&days=14`),
    enabled: bookable,
  });
  const form = useForm<Text>({
    resolver: zodResolver(requestText),
    defaultValues: { goal: '', background: '', need: '' },
  });
  const send = useMutation({
    mutationFn: (text: Text) =>
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
  if (send.isSuccess)
    return (
      <Card className="grid justify-items-start gap-3 p-5" role="status">
        <CalendarCheck className="size-8 text-success" aria-hidden />
        <h2 ref={focusOnMount} tabIndex={-1} className="text-xl font-bold outline-none">
          {t('request.sentTitle')}
        </h2>
        <p className="text-fg-2">
          {send.data.slotStart
            ? t('request.sentBodySlot', { name: mentor.name, time: formatDateTime(send.data.slotStart) })
            : t('request.sentBody', { name: mentor.name })}
        </p>
        <Link to="/mentorship?box=sent" className={buttonVariants({ variant: 'primary' })}>
          {t('request.track')}
        </Link>
      </Card>
    );
  const err = form.formState.errors;
  return (
    <Card className="p-5">
      <form className="grid gap-5" onSubmit={form.handleSubmit((v) => send.mutate(v))} noValidate>
        <h2 className="text-xl font-bold">{t('request.title', { name: mentor.name.split(' ')[0] })}</h2>
        <p className="-mt-3 text-sm text-fg-2">{t('request.noColdDms')}</p>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-meta font-semibold">{t('request.sessionType')}</legend>
          <ChoiceGroup
            label={t('request.sessionType')}
            value={type}
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
        {(['goal', 'background', 'need'] as const).map((f) => (
          <Field key={f} label={t(`request.${f}`)} hint={t(`request.${f}Hint`)} error={err[f]?.message}>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                maxLength={f === 'goal' ? 300 : 600}
                rows={f === 'goal' ? 2 : 3}
                {...form.register(f)}
              />
            )}
          </Field>
        ))}
        <FormError message={err.root?.message} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={send.isPending}
          disabled={!mentor.open || (bookable && !slot)}
        >
          {t('request.send')}
        </Button>
        {bookable && !slot && <p className="-mt-3 text-center text-xs text-fg-3">{t('request.pickFirst')}</p>}
      </form>
    </Card>
  );
}
