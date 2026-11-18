import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarClock, CalendarDays, Clock, Video } from 'lucide-react';
import type { FollowState, RequestView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { ActionCard } from '../../components/ui/action-card';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Countdown } from '../../components/ui/countdown';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { PersonCard } from '../../components/ui/person-card';
import { api } from '../../lib/api';
import { formatDay, formatTime } from '../../lib/format';
import { useCan, useMe } from '../../lib/me';
import { useNow } from '../../lib/use-now';
import * as q from '../../lib/queries';
import { DRIVE_SOON_MS, HOUR, openToMe, SESSION_SOON_MS, type TodayPick } from './today-pick';

/** Records which Next Step item was opened (prompt 2, G7). */
function useOpened() {
  return useMutation({
    mutationFn: (item: 'roadmap' | 'opportunity' | 'alumnus') => api.post('/me/next-step/open', { item }),
  });
}

/** Home's top card: the single most urgent thing, as one large ActionCard; nothing when nothing is. */
export function TodayCard({ pick }: { pick: TodayPick }) {
  const { t } = useTranslation();
  const opened = useOpened();
  if (!pick) return null;
  if (pick.kind === 'session') {
    const b = pick.booking;
    const other = b.role === 'mentor' ? b.mentee : b.mentor;
    return (
      <ActionCard
        kicker={t('today.session')}
        deadline={<Countdown at={b.start} endsAt={b.end} kind="starts" urgentWithinMs={SESSION_SOON_MS} />}
        leading={<PersonAvatar name={other.name} fileId={other.avatarFileId} size={48} />}
        title={t('today.sessionWith', { type: t(`session.type.${b.sessionType}`), name: other.name })}
        meta={`${formatTime(b.start)}–${formatTime(b.end)}`}
        action={
          <Link
            to={`/sessions/${b.id}?join=1`}
            className={buttonVariants({ variant: 'primary', size: 'lg' })}
          >
            <Video aria-hidden /> {t('today.join')}
          </Link>
        }
      />
    );
  }
  if (pick.kind === 'drive') {
    const d = pick.drive;
    return (
      <ActionCard
        kicker={t('today.driveCloses')}
        deadline={<Countdown at={d.registrationCloseAt} kind="closes" urgentWithinMs={DRIVE_SOON_MS} />}
        title={`${d.company.name}: ${d.title}`}
        meta={t('today.driveOn', { date: formatDay(d.driveDate) })}
        action={
          <Link
            to={`/placements/${d.id}?register=1`}
            className={buttonVariants({ variant: 'primary', size: 'lg' })}
          >
            {t('today.register')} <ArrowRight aria-hidden />
          </Link>
        }
      />
    );
  }
  const s = pick.step;
  const item = s.roadmapStep
    ? {
        kicker: t('today.step'),
        title: s.roadmapStep.title,
        meta: t('today.stepOn', { roadmap: s.roadmapStep.roadmap }),
        to: `/roadmaps/${s.roadmapStep.slug}?step=${encodeURIComponent(s.roadmapStep.nodeId)}`,
        open: 'roadmap' as const,
      }
    : s.opportunity
      ? {
          kicker: t('today.step'),
          title: `${s.opportunity.company}: ${s.opportunity.title}`,
          meta:
            s.opportunity.kind === 'drive'
              ? t('today.closesOn', { date: formatDay(s.opportunity.closesAt) })
              : null,
          to:
            s.opportunity.kind === 'drive' ? `/placements/${s.opportunity.id}` : `/jobs/${s.opportunity.id}`,
          open: 'opportunity' as const,
        }
      : s.alumnus
        ? {
            kicker: t('today.step'),
            title: t('today.askAlumnus', { name: s.alumnus.name }),
            meta: [s.alumnus.jobTitle, s.alumnus.company].filter(Boolean).join(' · '),
            to: `/mentors/${s.alumnus.userId}`,
            open: 'alumnus' as const,
          }
        : null;
  if (!item) return null;
  return (
    <ActionCard
      kicker={item.kicker}
      title={item.title}
      meta={item.meta}
      action={
        <Link
          to={item.to}
          onClick={() => opened.mutate(item.open)}
          className={buttonVariants({ variant: 'primary', size: 'lg' })}
        >
          {t('today.continue')} <ArrowRight aria-hidden />
        </Link>
      }
    />
  );
}

/** Alumni: who is waiting for them, first (prompt 3, U5). Accept in one tap; a decline's reason is chosen on Requests. */
export function WaitingForYou() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canMentor = useCan('mentorship:mentor');
  const requests = useQuery({ ...q.receivedRequests(), enabled: canMentor });
  const asks = useQuery({ ...q.microAsks('received'), enabled: canMentor });
  const respond = useMutation({
    mutationFn: (id: string) =>
      api.post<RequestView>(`/mentorship/requests/${id}/respond`, { action: 'accept' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['requests'] }),
  });
  const reply = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'decline' }) =>
      api.post(`/micro-asks/${id}/reply`, { action }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['micro-asks'] }),
  });
  if (!canMentor) return null;
  const pending = (requests.data ?? []).filter((r) => r.status === 'pending');
  const waiting = (asks.data?.asks ?? []).filter((a) => a.role === 'helper' && a.status === 'assigned');
  if (!pending.length && !waiting.length) return null;
  return (
    <ListSection title={t('today.waiting')} level={2}>
      {pending.slice(0, 3).map((r) => (
        <ListRow
          key={r.id}
          leading={<PersonAvatar name={r.mentee.name} fileId={r.mentee.avatarFileId} size={40} />}
          title={t('today.requestFrom', { name: r.mentee.name, type: t(`session.type.${r.sessionType}`) })}
          meta={r.message ?? r.goal ?? undefined}
          trailing={
            <span className="flex flex-wrap justify-end gap-2">
              <Link to="/mentorship" className={buttonVariants({ variant: 'tertiary', size: 'sm' })}>
                {t('today.declineMore')}
              </Link>
              <Button
                size="sm"
                variant="secondary"
                loading={respond.isPending && respond.variables === r.id}
                onClick={() => respond.mutate(r.id)}
              >
                {t('today.accept')}
              </Button>
            </span>
          }
        />
      ))}
      {waiting.slice(0, 3).map((a) => (
        <ListRow
          key={a.id}
          leading={<PersonAvatar name={a.asker.name} fileId={a.asker.avatarFileId} size={40} />}
          title={t(`today.ask.${a.kind}`, { name: a.asker.name })}
          meta={a.note}
          trailing={
            <span className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="tertiary"
                disabled={reply.isPending}
                onClick={() => reply.mutate({ id: a.id, action: 'decline' })}
              >
                {t('today.decline')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={reply.isPending}
                onClick={() => reply.mutate({ id: a.id, action: 'accept' })}
              >
                {t('today.accept')}
              </Button>
            </span>
          }
        />
      ))}
    </ListSection>
  );
}

function FollowPerson({ id, following }: { id: string; following: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () =>
      following
        ? api.delete<FollowState>(`/follows/user/${id}`)
        : api.post<FollowState>('/follows', { targetType: 'user', targetId: id }),
    onSuccess: (state) => {
      qc.setQueryData(['follows'], state);
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
  return (
    <Button
      size="sm"
      variant={following ? 'tertiary' : 'secondary'}
      loading={m.isPending}
      onClick={() => m.mutate()}
    >
      {following ? t('today.following') : t('today.follow')}
    </Button>
  );
}

/** One row of people to follow, each with the reason it is based on (X7) and one Follow. */
export function Suggested() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const canFollow = useCan('sources:follow');
  const s = useQuery({ ...q.followSuggestions(), enabled: canFollow });
  const follows = useQuery({ ...q.myFollows(), enabled: canFollow });
  const people = s.data?.people.slice(0, 6) ?? [];
  if (!people.length) return null;
  return (
    <section aria-labelledby="suggested-title" className="grid gap-3">
      <h2 id="suggested-title" className="text-headline font-semibold">
        {t('today.suggested')}
      </h2>
      <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto overscroll-x-contain px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {people.map((p) => (
          <li key={p.userId} className="w-[220px] flex-none snap-start">
            <PersonCard
              className="h-full"
              name={p.name}
              photoId={p.avatarFileId}
              role={p.headline || undefined}
              batch={p.gradYear ? t('today.batch', { year: p.gradYear }) : undefined}
              reason={
                p.branch && p.branch === me?.branch
                  ? t('today.reasonBranch', { branch: p.branch })
                  : t('today.reasonCollege')
              }
              to={`/people/${p.userId}`}
              action={<FollowPerson id={p.userId} following={!!follows.data?.users.includes(p.userId)} />}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Wide screens: a narrow column of what is coming (sessions, deadlines, events); no promotions. */
export function ComingUp() {
  const { t } = useTranslation();
  const now = useNow();
  const canBook = useCan('sessions:book');
  const canDrives = useCan('placements:view');
  const bookings = useQuery({ ...q.upcomingBookings(), enabled: canBook });
  const drives = useQuery({ ...q.placementDrives('eligible'), enabled: canDrives });
  const events = useQuery(q.comingUpEvents());
  const sessions = (bookings.data ?? []).filter((b) => b.status === 'scheduled').slice(0, 3);
  const deadlines = (drives.data ?? [])
    .filter((d) => openToMe(d) && Date.parse(d.registrationCloseAt) - now <= 7 * 24 * HOUR)
    .sort((a, b) => Date.parse(a.registrationCloseAt) - Date.parse(b.registrationCloseAt))
    .slice(0, 3);
  const upcoming = (events.data ?? []).slice(0, 3);
  const empty = !sessions.length && !deadlines.length && !upcoming.length;
  return (
    <aside aria-labelledby="coming-up" className="grid content-start gap-4">
      <h2 id="coming-up" className="text-headline font-semibold">
        {t('today.comingUp')}
      </h2>
      {empty && <p className="text-callout text-fg-2">{t('today.nothingComing')}</p>}
      {!!sessions.length && (
        <ListSection title={t('today.sessions')} level={3}>
          {sessions.map((b) => {
            const other = b.role === 'mentor' ? b.mentee : b.mentor;
            return (
              <ListRow
                key={b.id}
                to="/sessions"
                leading={<Clock className="size-4 text-fg-3" aria-hidden />}
                title={t('today.sessionWith', { type: t(`session.type.${b.sessionType}`), name: other.name })}
                meta={`${formatDay(b.start)}, ${formatTime(b.start)}`}
              />
            );
          })}
        </ListSection>
      )}
      {!!deadlines.length && (
        <ListSection title={t('today.deadlines')} level={3}>
          {deadlines.map((d) => (
            <ListRow
              key={d.id}
              to={`/placements/${d.id}`}
              leading={<CalendarClock className="size-4 text-fg-3" aria-hidden />}
              title={`${d.company.name}: ${d.title}`}
              meta={t('today.closesOn', { date: formatDay(d.registrationCloseAt) })}
            />
          ))}
        </ListSection>
      )}
      {!!upcoming.length && (
        <ListSection title={t('today.events')} level={3}>
          {upcoming.map((e) => (
            <ListRow
              key={e.id}
              to={`/events/${e.id}`}
              leading={<CalendarDays className="size-4 text-fg-3" aria-hidden />}
              title={e.title}
              meta={`${formatDay(e.startsAt)}, ${formatTime(e.startsAt)}`}
            />
          ))}
        </ListSection>
      )}
    </aside>
  );
}
