import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronUp,
  EyeOff,
  MapPin,
  Pencil,
  Users,
  Video,
  XCircle,
} from 'lucide-react';
import type { AttendeeView, EventQuestionView, EventView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Textarea } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Dialog } from '../../components/ui/dialog';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { RichText } from '../../components/ui/rich-text';
import { api, apiBlob, ApiError, saveBlob } from '../../lib/api';
import { findCached, hasId } from '../../lib/query-seed';
import { event } from '../../lib/queries';
import { formatDateTime, formatTime } from '../../lib/format';
import { cn } from '../../lib/cn';
import { hasEnded } from '../../lib/events';
import { ContentMenu } from '../feed/content-menu';

function QaQueue({ e }: { e: EventView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const key = ['event', e.id, 'questions'];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<EventQuestionView[]>(`/events/${e.id}/questions`),
    // A live queue: refresh while the page is open (no extra socket events).
    refetchInterval: 10_000,
  });
  const fail = (err: unknown) => toast.error(err instanceof ApiError ? err.message : t('errors.generic'));
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const ask = useMutation({
    mutationFn: () => api.post(`/events/${e.id}/questions`, { body }),
    onSuccess: () => {
      setBody('');
      refresh();
    },
    onError: fail,
  });
  const vote = useMutation({
    mutationFn: (v: { id: string; on: boolean }) => api.put(`/event-questions/${v.id}/vote`, { on: v.on }),
    onSuccess: refresh,
    onError: fail,
  });
  const status = useMutation({
    mutationFn: (v: { id: string; status: 'open' | 'answered' | 'hidden' }) =>
      api.patch(`/event-questions/${v.id}`, { status: v.status }),
    onSuccess: refresh,
    onError: fail,
  });
  const open = e.status === 'scheduled' && !hasEnded(e.endsAt);
  return (
    <section aria-labelledby="qa" className="grid gap-3">
      <h2 id="qa" className="font-display text-lg font-semibold">
        {t('events.qa.title')}
      </h2>
      {open && (
        <form
          className="grid gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (body.trim().length >= 5) ask.mutate();
          }}
        >
          <label htmlFor="ask" className="sr-only">
            {t('events.qa.ask')}
          </label>
          <Textarea
            id="ask"
            rows={2}
            maxLength={500}
            value={body}
            onChange={(ev) => setBody(ev.target.value)}
            placeholder={t('events.qa.ask')}
          />
          <Button
            type="submit"
            size="sm"
            className="justify-self-end"
            loading={ask.isPending}
            disabled={body.trim().length < 5}
          >
            {t('events.qa.submit')}
          </Button>
        </form>
      )}
      {q.isLoading ? (
        <Skeleton className="h-16" />
      ) : !q.data?.length ? (
        <p className="text-sm text-fg-2">{t('events.qa.empty')}</p>
      ) : (
        <ol className="grid gap-2" aria-live="polite">
          {q.data.map((x) => (
            <li key={x.id}>
              <Card className={cn('flex gap-3 p-3', x.status !== 'open' && 'border-dashed bg-transparent')}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-pressed={x.votedByMe}
                  disabled={x.isMine || x.status !== 'open'}
                  aria-label={t('events.qa.vote', { count: x.votes })}
                  onClick={() => vote.mutate({ id: x.id, on: !x.votedByMe })}
                  className="grid h-auto flex-none justify-items-center py-1 aria-pressed:text-brand-ink"
                >
                  <ChevronUp className="size-5" aria-hidden />
                  <span className="font-mono text-sm">{x.votes}</span>
                </Button>
                <div className="grid min-w-0 flex-1 gap-1">
                  <p className="text-sm">{x.body}</p>
                  <p className="text-xs text-fg-3">
                    {x.author.name}
                    {x.status !== 'open' && (
                      <Badge tone={x.status === 'answered' ? 'success' : 'neutral'} className="ml-2">
                        {t(`events.qa.status.${x.status}`)}
                      </Badge>
                    )}
                  </p>
                </div>
                {e.canManage && (
                  <div className="flex flex-none gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={
                        x.status === 'answered' ? t('events.qa.reopen') : t('events.qa.markAnswered')
                      }
                      onClick={() =>
                        status.mutate({ id: x.id, status: x.status === 'answered' ? 'open' : 'answered' })
                      }
                    >
                      <Check className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={x.status === 'hidden' ? t('events.qa.unhide') : t('events.qa.hide')}
                      onClick={() =>
                        status.mutate({ id: x.id, status: x.status === 'hidden' ? 'open' : 'hidden' })
                      }
                    >
                      <EyeOff className="size-4" aria-hidden />
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Attendees({ e }: { e: EventView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['event', e.id, 'attendees'];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<AttendeeView[]>(`/events/${e.id}/attendees`) });
  const checkIn = useMutation({
    mutationFn: (v: { userId: string; attended: boolean }) => api.post(`/events/${e.id}/check-in`, v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('errors.generic')),
  });
  return (
    <section aria-labelledby="attendees" className="grid gap-2">
      <h2 id="attendees" className="font-display text-lg font-semibold">
        {t('events.attendees')}
      </h2>
      {q.isLoading ? (
        <Skeleton className="h-16" />
      ) : !q.data?.length ? (
        <p className="text-sm text-fg-2">{t('events.noAttendees')}</p>
      ) : (
        <ul className="grid gap-1.5">
          {q.data.map((a) => (
            <li
              key={a.person.userId}
              className="flex items-center gap-3 rounded-[var(--radius-sm)] bg-surface-1 px-3 py-2"
            >
              <PersonAvatar name={a.person.name} fileId={a.person.avatarFileId} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm">{a.person.name}</span>
              {a.status === 'waitlist' ? (
                <Badge>{t('events.rsvp.waitlist')}</Badge>
              ) : (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--brand)]"
                    checked={a.checkedIn}
                    onChange={(ev) =>
                      checkIn.mutate({ userId: a.person.userId, attended: ev.target.checked })
                    }
                  />
                  {t('events.present')}
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function EventPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const q = useQuery({
    ...event(id),
    // The card the member tapped draws the header at once.
    placeholderData: () => findCached(qc, [['events']], hasId<EventView>('id', id, ['title', 'startsAt'])),
  });
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const rsvp = useMutation({
    mutationFn: (going: boolean) => api.put<EventView>(`/events/${id}/rsvp`, { going }),
    // Optimistic: the button and counts change at once; a failure puts them back (audit ST-4).
    onMutate: async (going) => {
      await qc.cancelQueries({ queryKey: ['event', id] });
      const before = qc.getQueryData<EventView>(['event', id]);
      if (before) {
        const was = before.myRsvp;
        const full = before.capacity !== null && before.going >= before.capacity;
        const next = going ? (full && was !== 'going' ? 'waitlist' : 'going') : null;
        qc.setQueryData<EventView>(['event', id], {
          ...before,
          myRsvp: next,
          going: before.going + (next === 'going' ? 1 : 0) - (was === 'going' ? 1 : 0),
          waitlist: before.waitlist + (next === 'waitlist' ? 1 : 0) - (was === 'waitlist' ? 1 : 0),
        });
      }
      return { before };
    },
    onSuccess: (v) => {
      qc.setQueryData(['event', id], v);
      void qc.invalidateQueries({ queryKey: ['events'] });
      toast.success(
        v.myRsvp === 'going'
          ? t('events.youreGoing')
          : v.myRsvp === 'waitlist'
            ? t('events.youreWaitlisted')
            : t('events.rsvpCancelled'),
      );
    },
    onError: (e, _going, ctx) => {
      if (ctx?.before) qc.setQueryData(['event', id], ctx.before);
      fail(e);
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.post<EventView>(`/events/${id}/cancel`, {}),
    onSuccess: (v) => {
      qc.setQueryData(['event', id], v);
      setConfirmCancel(false);
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
    onError: fail,
  });
  const ics = async () => {
    try {
      saveBlob(await apiBlob(`/events/${id}/ics`), 'event.ics');
    } catch (e) {
      fail(e);
    }
  };
  if (q.isLoading) return <Skeleton className="h-80" />;
  const e = q.data;
  if (!e)
    return (
      <EmptyState icon={<CalendarDays className="size-6" />} title={t('events.notFound')}>
        <Link to="/events" className="text-brand-ink underline">
          {t('events.back')}
        </Link>
      </EmptyState>
    );
  const past = hasEnded(e.endsAt);
  const live = e.status === 'scheduled' && !past;
  return (
    <div className="grid gap-5">
      <Link to="/events" className="text-sm text-fg-3 hover:text-fg">
        ← {t('events.title')}
      </Link>
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="brand">{t(`events.kind.${e.kind}`)}</Badge>
          {e.status === 'cancelled' && <Badge tone="danger">{t('events.cancelled')}</Badge>}
          {past && e.status === 'scheduled' && <Badge>{t('events.ended')}</Badge>}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-[clamp(26px,4vw,34px)] leading-tight font-bold">{e.title}</h1>
          <div className="flex gap-2">
            {e.canManage && live && (
              <Link to={`/events/${e.id}/edit`} className={buttonVariants({ size: 'sm' })}>
                <Pencil className="size-4" aria-hidden /> {t('events.edit')}
              </Link>
            )}
            {!e.isHost && e.status !== 'removed' && (
              <ContentMenu
                targetType="event"
                targetId={e.id}
                authorId={e.host.userId}
                authorName={e.host.name}
                isMine={false}
              />
            )}
          </div>
        </div>
        <p className="flex items-center gap-2 text-fg-2">
          <CalendarDays className="size-5 flex-none" aria-hidden />
          {formatDateTime(e.startsAt)} – {formatTime(e.endsAt)}
        </p>
        <p className="flex items-center gap-2 text-fg-2">
          {e.mode === 'online' ? (
            <Video className="size-5 flex-none" aria-hidden />
          ) : (
            <MapPin className="size-5 flex-none" aria-hidden />
          )}
          {e.mode === 'online'
            ? t('events.mode.online')
            : e.mode === 'hybrid'
              ? `${e.location} · ${t('events.mode.hybrid')}`
              : e.location}
        </p>
        <p className="flex items-center gap-2 text-sm text-fg-3">
          <Users className="size-4" aria-hidden />
          {e.capacity
            ? t('events.goingOf', { going: e.going, capacity: e.capacity })
            : t('events.goingN', { count: e.going })}
          {e.waitlist > 0 && ` · ${t('events.waitlistN', { count: e.waitlist })}`}
          {' · '}
          {t('events.hostedBy', { name: e.host.name })}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="grid min-w-0 content-start gap-5">
          <Card className="p-4">
            <RichText text={e.description} />
          </Card>
          {e.hasQa && e.status !== 'removed' && <QaQueue e={e} />}
          {e.canManage && <Attendees e={e} />}
        </div>
        <aside className="grid content-start gap-3">
          <Card className="grid gap-3 p-4">
            {e.myRsvp === 'waitlist' && (
              <p className="text-sm" role="status">
                {t('events.waitlistPosition', { position: e.myWaitlistPosition ?? 1 })}
              </p>
            )}
            {e.myRsvp === 'going' && (
              <p className="text-sm font-semibold text-success" role="status">
                {t('events.youreGoing')}
              </p>
            )}
            {live &&
              !e.isHost &&
              (e.myRsvp ? (
                <Button loading={rsvp.isPending} onClick={() => rsvp.mutate(false)}>
                  {t('events.cancelRsvp')}
                </Button>
              ) : (
                <Button variant="primary" loading={rsvp.isPending} onClick={() => rsvp.mutate(true)}>
                  {e.capacity && e.going >= e.capacity ? t('events.joinWaitlist') : t('events.rsvpGoing')}
                </Button>
              ))}
            {e.onlineUrl ? (
              <a
                href={e.onlineUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'primary' })}
              >
                <Video className="size-4" aria-hidden /> {t('events.join')}
              </a>
            ) : (
              e.mode !== 'in_person' && live && <p className="text-xs text-fg-3">{t('events.linkLater')}</p>
            )}
            <Button onClick={() => void ics()}>
              <CalendarPlus className="size-4" aria-hidden /> {t('events.addToCalendar')}
            </Button>
            {e.canManage && live && (
              <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
                <XCircle className="size-4" aria-hidden /> {t('events.cancelEvent')}
              </Button>
            )}
          </Card>
        </aside>
      </div>
      <Dialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t('events.cancelTitle')}
        description={t('events.cancelBody')}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmCancel(false)}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            {t('events.cancelEvent')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
