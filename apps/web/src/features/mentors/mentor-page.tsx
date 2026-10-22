import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Clock, PauseCircle, UserX } from 'lucide-react';
import {
  isBookable,
  requestText,
  type MentorCard,
  type RequestView,
  type SessionType,
  type SlotsView,
} from '@campuslink/shared';
import type { z } from 'zod';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Field, Textarea } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { SlotPicker } from '../../components/ui/slot-picker';
import { SafetyMenu } from '../../components/layout/safety-menu';
import { FormError } from '../../components/layout/auth-layout';
import { api } from '../../lib/api';
import { focusOnMount } from '../../lib/focus';
import { findCached, hasId } from '../../lib/query-seed';
import { applyApiError } from '../../lib/errors';
import { formatDateTime, newIdempotencyKey } from '../../lib/format';

type Text = z.infer<typeof requestText>;

function RequestForm({ mentor }: { mentor: MentorCard }) {
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
          <legend className="mb-2 text-[13px] font-semibold">{t('request.sessionType')}</legend>
          <div role="radiogroup" aria-label={t('request.sessionType')} className="grid gap-2 sm:grid-cols-2">
            {mentor.sessionTypes.map((s) => (
              <button
                key={s.type}
                type="button"
                role="radio"
                aria-checked={type === s.type}
                onClick={() => {
                  setType(s.type);
                  setSlot(null);
                }}
                className="flex min-h-14 items-center justify-between gap-2 rounded-[var(--radius-md)] border border-line-strong px-4 text-left aria-checked:border-brand aria-checked:bg-[color-mix(in_srgb,var(--brand)_14%,transparent)]"
              >
                <span className="font-semibold">{t(`session.type.${s.type}`)}</span>
                <span className="flex items-center gap-1 text-xs text-fg-2">
                  <Clock className="size-3.5" aria-hidden />
                  {s.durationMin ? t('session.minutes', { n: s.durationMin }) : t('session.async')}
                </span>
              </button>
            ))}
          </div>
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

export function MentorPage() {
  const { userId = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['mentor', userId],
    queryFn: () => api.get<MentorCard & { timezone: string }>(`/mentors/${userId}`),
    enabled: /^[a-f0-9]{24}$/.test(userId),
    // The tile the member tapped (Alumni Match or Browse) draws the header at once.
    placeholderData: () => {
      const tile = findCached(
        qc,
        [['match'], ['mentors']],
        hasId<MentorCard>('userId', userId, ['sessionTypes', 'headline']),
      );
      return tile ? { ...tile, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : undefined;
    },
    retry: false,
  });
  const back = <BackLink to="/mentors">{t('mentors.back')}</BackLink>;
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (!q.data)
    return (
      <>
        {back}
        <EmptyState icon={<UserX className="size-6" />} title={t('mentors.notFound')}>
          {t('mentors.notFoundBody')}
        </EmptyState>
      </>
    );
  const m = q.data;
  return (
    <>
      {back}
      <Card className="grid gap-4 p-5">
        <div className="flex items-start gap-4">
          <span className="flex-none" style={{ viewTransitionName: `mentor-${m.userId}` }}>
            <PersonAvatar name={m.name} fileId={m.avatarFileId} size={72} verified />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] leading-tight font-bold">{m.name}</h1>
            {m.headline && <p className="text-fg-2">{m.headline}</p>}
            {(m.jobTitle || m.company) && (
              <p className="text-sm">{[m.jobTitle, m.company].filter(Boolean).join(' · ')}</p>
            )}
          </div>
          <SafetyMenu userId={m.userId} name={m.name} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {m.branch && (
            <Badge>
              {[m.branch, m.gradYear ? t('people.batch', { year: m.gradYear }) : '']
                .filter(Boolean)
                .join(' · ')}
            </Badge>
          )}
          {[...m.topics, ...m.skills].map((x) => (
            <Badge key={x} tone="brand">
              {x}
            </Badge>
          ))}
          {m.languages.map((x) => (
            <Badge key={x}>{x}</Badge>
          ))}
        </div>
        <Link
          to={`/people/${m.userId}`}
          className="justify-self-start text-sm font-semibold text-brand-ink hover:underline"
        >
          {t('mentors.fullProfile')}
        </Link>
      </Card>
      {!m.open && (
        <Card className="flex gap-3 p-4" role="status">
          <PauseCircle className="mt-0.5 size-5 flex-none text-warning" aria-hidden />
          <p className="text-sm">{t('mentors.fullBody')}</p>
        </Card>
      )}
      <RequestForm mentor={m} />
    </>
  );
}
