import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, CalendarPlus, ExternalLink, MessageSquare, Star, Video } from 'lucide-react';
import {
  FEEDBACK_TAGS,
  FEEDBACK_WINDOW_DAYS,
  LATE_CANCEL_HOURS,
  MAX_RESCHEDULES,
  NO_SHOW_WINDOW_HOURS,
  type BookingView,
  type SlotsView,
} from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Dialog } from '../../components/ui/dialog';
import { Field, Textarea } from '../../components/ui/field';
import { Badge, Card, Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { SlotPicker } from '../../components/ui/slot-picker';
import { Segmented } from '../../components/ui/tab-nav';
import { api, apiBlob, ApiError, saveBlob } from '../../lib/api';
import { bookings } from '../../lib/queries';
import { formatDay, formatTime, localDateKey, newIdempotencyKey } from '../../lib/format';

const HOUR = 3600_000;

/** Re-renders every 30 s so "Join" enables itself when the window opens. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function useBookingAction(id: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return {
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bookings'] }),
    onError: (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
    id,
  };
}

function JoinDialog({
  b,
  open,
  onOpenChange,
}: {
  b: BookingView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const join = useQuery({
    queryKey: ['join', b.id],
    queryFn: () =>
      api.post<{ url: string; provider: string; expiresAt: string }>(`/bookings/${b.id}/join`, {}),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('sessions.joinTitle')}
      description={t('sessions.joinBody')}
    >
      {join.isLoading && <Skeleton className="h-12" />}
      {join.error && (
        <p role="alert" className="text-sm text-danger">
          {join.error instanceof ApiError ? join.error.message : t('errors.generic')}
        </p>
      )}
      {join.data && (
        <div className="grid gap-3">
          <a
            href={join.data.url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'primary', size: 'lg' })}
          >
            <Video className="size-5" aria-hidden /> {t('sessions.openCall')}{' '}
            <ExternalLink className="size-4" aria-hidden />
          </a>
          <p className="text-xs text-fg-3">
            {t('sessions.linkExpires', { time: formatTime(join.data.expiresAt) })}
          </p>
        </div>
      )}
    </Dialog>
  );
}

function RescheduleDialog({
  b,
  open,
  onOpenChange,
}: {
  b: BookingView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const [slot, setSlot] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);
  const opts = useBookingAction(b.id);
  const slots = useQuery({
    queryKey: ['booking-slots', b.id],
    queryFn: () => api.get<SlotsView>(`/bookings/${b.id}/slots?days=14`),
    enabled: open,
  });
  const move = useMutation({
    mutationFn: () => api.postOnce(`/bookings/${b.id}/reschedule`, { slotStart: slot }, key),
    onSuccess: () => {
      opts.onSuccess();
      onOpenChange(false);
      toast.success(t('sessions.moved'));
    },
    onError: opts.onError,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('sessions.rescheduleTitle')}
      description={t('sessions.rescheduleBody', { count: MAX_RESCHEDULES - b.rescheduleCount })}
    >
      <SlotPicker
        label={t('request.pickTime')}
        slots={(slots.data?.slots ?? []).filter((s) => s !== b.start)}
        value={slot}
        onChange={setSlot}
        loading={slots.isLoading}
      />
      <div className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!slot} loading={move.isPending} onClick={() => move.mutate()}>
          {t('sessions.moveHere')}
        </Button>
      </div>
    </Dialog>
  );
}

function CancelDialog({
  b,
  now,
  open,
  onOpenChange,
}: {
  b: BookingView;
  now: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const opts = useBookingAction(b.id);
  const late = new Date(b.start).getTime() - now < LATE_CANCEL_HOURS * HOUR;
  const cancel = useMutation({
    mutationFn: () => api.post(`/bookings/${b.id}/cancel`, reason.trim() ? { reason: reason.trim() } : {}),
    onSuccess: () => {
      opts.onSuccess();
      onOpenChange(false);
    },
    onError: opts.onError,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('sessions.cancelTitle')}
      description={late ? t('sessions.lateWarning', { hours: LATE_CANCEL_HOURS }) : t('sessions.cancelBody')}
    >
      <Field label={t('sessions.cancelReason')}>
        {({ id }) => (
          <Textarea
            id={id}
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>{t('sessions.keep')}</Button>
        <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
          {t('sessions.cancelConfirm')}
        </Button>
      </div>
    </Dialog>
  );
}

function FeedbackDialog({
  b,
  open,
  onOpenChange,
}: {
  b: BookingView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const opts = useBookingAction(b.id);
  const send = useMutation({
    mutationFn: () =>
      api.post(`/bookings/${b.id}/feedback`, {
        rating,
        tags,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      }),
    onSuccess: () => {
      opts.onSuccess();
      onOpenChange(false);
      toast.success(t('sessions.thanks'));
    },
    onError: opts.onError,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('sessions.feedbackTitle', { name: b.mentor.name })}
      description={t('sessions.feedbackPrivate')}
    >
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold">{t('sessions.rating')}</legend>
        <div role="radiogroup" aria-label={t('sessions.rating')} className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={t('sessions.stars', { count: n })}
              onClick={() => setRating(n)}
              className="grid size-11 place-items-center rounded-full hover:bg-surface-2"
            >
              <Star
                className={n <= rating ? 'size-7 fill-[var(--accent)] text-accent-ink' : 'size-7 text-fg-3'}
                aria-hidden
              />
            </button>
          ))}
        </div>
      </fieldset>
      <div role="group" aria-label={t('sessions.tags')} className="flex flex-wrap gap-2">
        {FEEDBACK_TAGS.map((tag) => (
          <Chip
            key={tag}
            pressed={tags.includes(tag)}
            onClick={() => setTags((x) => (x.includes(tag) ? x.filter((y) => y !== tag) : [...x, tag]))}
          >
            {t(`sessions.tag.${tag}`)}
          </Chip>
        ))}
      </div>
      <Field label={t('sessions.comment')}>
        {({ id }) => (
          <Textarea
            id={id}
            rows={3}
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!rating} loading={send.isPending} onClick={() => send.mutate()}>
          {t('sessions.sendFeedback')}
        </Button>
      </div>
    </Dialog>
  );
}

function BookingCard({ b, now }: { b: BookingView; now: number }) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<'join' | 'move' | 'cancel' | 'feedback' | 'noshow' | null>(null);
  const opts = useBookingAction(b.id);
  const noShow = useMutation({
    mutationFn: () => api.post(`/bookings/${b.id}/no-show`, {}),
    onSuccess: () => {
      opts.onSuccess();
      setDialog(null);
    },
    onError: opts.onError,
  });
  const other = b.role === 'mentor' ? b.mentee : b.mentor;
  const start = new Date(b.start).getTime();
  const end = new Date(b.end).getTime();
  const canJoin =
    (b.status === 'scheduled' || b.status === 'completed') &&
    now >= new Date(b.canJoinFrom).getTime() &&
    now <= new Date(b.canJoinUntil).getTime();
  const upcoming = b.status === 'scheduled' && start > now;
  const ics = async () => saveBlob(await apiBlob(`/bookings/${b.id}/ics`), 'session.ics');
  const open = (d: typeof dialog) => (o: boolean) => setDialog(o ? d : null);
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex items-start gap-3">
        <PersonAvatar name={other.name} fileId={other.avatarFileId} />
        <div className="min-w-0 flex-1">
          <b className="block truncate">{other.name}</b>
          <p className="text-sm text-fg-2">
            {t(`session.type.${b.sessionType}`)} · {formatDay(b.start)}, {formatTime(b.start)}–
            {formatTime(b.end)}
          </p>
        </div>
        <Badge tone={b.role === 'mentor' ? 'accent' : 'brand'}>{t(`sessions.role.${b.role}`)}</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {b.status !== 'scheduled' && (
          <Badge tone={b.status === 'completed' ? 'success' : 'neutral'}>
            {t(`sessions.status.${b.status}`)}
          </Badge>
        )}
        {b.lateCancel && <Badge tone="warning">{t('sessions.late')}</Badge>}
        {b.noShowBy && <Badge tone="warning">{t(`sessions.noShowBy.${b.noShowBy}`)}</Badge>}
        {b.rescheduleCount > 0 && <Badge>{t('sessions.moves', { count: b.rescheduleCount })}</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        {(b.status === 'scheduled' || canJoin) && (
          <Button variant="primary" size="sm" disabled={!canJoin} onClick={() => setDialog('join')}>
            <Video className="size-4" aria-hidden /> {t('sessions.join')}
          </Button>
        )}
        {!canJoin && upcoming && (
          <span className="self-center text-xs text-fg-3">
            {t('sessions.joinOpens', { time: formatTime(b.canJoinFrom) })}
          </span>
        )}
        {b.conversationId && (
          <Link to={`/messages/${b.conversationId}`} className={buttonVariants({ size: 'sm' })}>
            <MessageSquare className="size-4" aria-hidden /> {t('sessions.message')}
          </Link>
        )}
        {upcoming && (
          <>
            <Button size="sm" onClick={() => void ics()}>
              <CalendarPlus className="size-4" aria-hidden /> {t('sessions.addToCalendar')}
            </Button>
            {b.rescheduleCount < MAX_RESCHEDULES && (
              <Button size="sm" variant="ghost" onClick={() => setDialog('move')}>
                {t('sessions.reschedule')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setDialog('cancel')}>
              {t('sessions.cancel')}
            </Button>
          </>
        )}
        {b.status === 'completed' &&
          b.role === 'mentee' &&
          !b.feedbackGiven &&
          now < end + FEEDBACK_WINDOW_DAYS * 24 * HOUR && (
            <Button size="sm" variant="accent" onClick={() => setDialog('feedback')}>
              <Star className="size-4" aria-hidden /> {t('sessions.rate')}
            </Button>
          )}
        {b.status === 'completed' && !b.noShowBy && now < end + NO_SHOW_WINDOW_HOURS * HOUR && (
          <Button size="sm" variant="ghost" onClick={() => setDialog('noshow')}>
            {t('sessions.reportNoShow')}
          </Button>
        )}
      </div>
      {dialog === 'join' && <JoinDialog b={b} open onOpenChange={open('join')} />}
      {dialog === 'move' && <RescheduleDialog b={b} open onOpenChange={open('move')} />}
      {dialog === 'cancel' && <CancelDialog b={b} now={now} open onOpenChange={open('cancel')} />}
      {dialog === 'feedback' && <FeedbackDialog b={b} open onOpenChange={open('feedback')} />}
      {dialog === 'noshow' && (
        <Dialog
          open
          onOpenChange={open('noshow')}
          title={t('sessions.noShowTitle')}
          description={t('sessions.noShowBody', { name: other.name })}
        >
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={noShow.isPending} onClick={() => noShow.mutate()}>
              {t('sessions.noShowConfirm')}
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  );
}

/** Two-week strip: how many sessions each day has; picking a day filters the list. */
function WeekStrip({
  items,
  day,
  now,
  onDay,
}: {
  items: BookingView[];
  day: string | null;
  now: number;
  onDay: (d: string | null) => void;
}) {
  const { t } = useTranslation();
  const days = Array.from({ length: 14 }, (_, i) => localDateKey(new Date(now + i * 24 * HOUR)));
  const counts = new Map<string, number>();
  for (const b of items) counts.set(localDateKey(b.start), (counts.get(localDateKey(b.start)) ?? 0) + 1);
  return (
    <div
      role="group"
      aria-label={t('sessions.calendar')}
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
    >
      <Chip pressed={day === null} onClick={() => onDay(null)} className="flex-none">
        {t('sessions.allDays')}
      </Chip>
      {days.map((d) => {
        const n = counts.get(d) ?? 0;
        return (
          <button
            key={d}
            type="button"
            aria-pressed={day === d}
            onClick={() => onDay(d)}
            aria-label={t('sessions.dayCount', { day: formatDay(`${d}T12:00:00`), count: n })}
            className="grid min-h-14 min-w-14 flex-none justify-items-center gap-0.5 rounded-[var(--radius-md)] border border-line-strong px-2 py-1.5 text-xs text-fg-2 aria-pressed:border-brand aria-pressed:text-fg"
          >
            <span>{formatDay(`${d}T12:00:00`).split(/[ ,]/)[0]}</span>
            <b className="font-display text-base text-fg">{Number(d.slice(8))}</b>
            <span aria-hidden className={n ? 'size-1.5 rounded-full bg-brand' : 'size-1.5'} />
          </button>
        );
      })}
    </div>
  );
}

export function SessionsPage() {
  const { t } = useTranslation();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const when = params.get('when') === 'past' ? 'past' : 'upcoming';
  const [day, setDay] = useState<string | null>(null);
  const list = useQuery({ ...bookings(when), placeholderData: keepPreviousData });
  const items = (list.data ?? []).filter((b) => when === 'past' || !day || localDateKey(b.start) === day);
  return (
    <>
      <h1 className="text-[clamp(26px,4vw,34px)] font-bold">{t('nav.sessions')}</h1>
      <Segmented
        label={t('nav.sessions')}
        value={when}
        options={[
          ['upcoming', t('sessions.upcoming')],
          ['past', t('sessions.past')],
        ]}
        onChange={(v) => setParams(v === 'past' ? { when: 'past' } : {}, { replace: true })}
      />
      {when === 'upcoming' && list.data && <WeekStrip items={list.data} day={day} now={now} onDay={setDay} />}
      {list.isLoading && <Skeleton className="h-40" />}
      {list.isSuccess && !items.length && (
        <EmptyState
          icon={<CalendarClock className="size-6" />}
          title={when === 'past' ? t('sessions.emptyPast') : t('sessions.empty')}
          action={
            when === 'upcoming' ? (
              <Link to="/mentors" className={buttonVariants({ variant: 'primary' })}>
                {t('request.findMentor')}
              </Link>
            ) : undefined
          }
        />
      )}
      <ul className="grid gap-3">
        {items.map((b) => (
          <li key={b.id}>
            <BookingCard b={b} now={now} />
          </li>
        ))}
      </ul>
    </>
  );
}
