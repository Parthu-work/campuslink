import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, HeartHandshake, Users } from 'lucide-react';
import {
  BUDDY_CHECKLIST,
  type BuddyPairView,
  type BuddyView,
  type PeerMentorStatusView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { ErrorState } from '../../components/ui/error-state';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ProgressBar } from '../../components/ui/progress';
import { Switch } from '../../components/ui/switch';
import { api, ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

function Pair({ pair }: { pair: BuddyPairView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const tick = useMutation({
    mutationFn: ({ item, done }: { item: string; done: boolean }) =>
      api.post<BuddyView>(`/buddies/${pair.id}/checklist`, { item, done }),
    onSuccess: (v) => qc.setQueryData(q.buddy().queryKey, v),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const done = pair.checklist.filter((c) => c.doneAt).length;
  return (
    <Card variant="raised" className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid">
          <span className="text-caption text-fg-3">
            {pair.role === 'junior' ? t('habits.buddy.yourSenior') : t('habits.buddy.yourJunior')}
          </span>
          <Link to={`/people/${pair.other.userId}`} className="font-semibold hover:underline">
            {pair.other.name}
          </Link>
          <span className="text-meta text-fg-2">
            {[
              pair.other.branch,
              pair.other.gradYear ? t('habits.buddy.batch', { year: pair.other.gradYear }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <Badge tone="brand">
          {pair.week > 4 ? t('habits.buddy.finished') : t('habits.buddy.week', { n: pair.week })}
        </Badge>
      </div>
      <ProgressBar
        value={done}
        max={BUDDY_CHECKLIST.length}
        label={t('habits.buddy.progress')}
        valueText={t('habits.buddy.done', { n: done, total: BUDDY_CHECKLIST.length })}
        size="sm"
      />
      <ol className="grid gap-1">
        {pair.checklist.map((c, i) => (
          <li key={c.item}>
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-2 text-left hover:bg-hover"
              aria-pressed={!!c.doneAt}
              disabled={tick.isPending}
              onClick={() => tick.mutate({ item: c.item, done: !c.doneAt })}
            >
              {c.doneAt ? (
                <CheckCircle2 className="size-5 flex-none text-success-ink" aria-hidden />
              ) : (
                <Circle className="size-5 flex-none text-fg-3" aria-hidden />
              )}
              <span className="grid">
                <span className="text-caption text-fg-3">{t('habits.buddy.week', { n: i + 1 })}</span>
                <span className={c.doneAt ? 'text-fg-2 line-through' : 'font-semibold'}>
                  {t(`habits.buddy.item.${c.item}`)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="text-caption text-fg-3">{t('habits.buddy.since', { date: formatDay(pair.matchedAt) })}</p>
    </Card>
  );
}

/** Peer mentoring and the Senior Buddy (prompt 2, G7). */
export function PeersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const status = useQuery({ ...SCREEN, ...q.peerStatus() });
  const buddy = useQuery({ ...SCREEN, ...q.buddy() });
  const saved = (v: PeerMentorStatusView) => {
    qc.setQueryData(q.peerStatus().queryKey, v);
    void qc.invalidateQueries({ queryKey: ['buddy'] });
    // Peer mentoring changes what the member may do (mentoring), so their permissions reload.
    void qc.invalidateQueries({ queryKey: ['me'] });
  };
  const failed = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const mentor = useMutation({
    mutationFn: (on: boolean) => api.put<PeerMentorStatusView>('/me/peer/mentor', { on }),
    onSuccess: saved,
    onError: failed,
  });
  const volunteer = useMutation({
    mutationFn: (on: boolean) => api.put<PeerMentorStatusView>('/me/peer/buddy', { on }),
    onSuccess: saved,
    onError: failed,
  });
  const s = status.data;
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-6">
      <PageHeader icon={<HeartHandshake />} title={t('nav.peers')} intro={t('habits.peers.intro')} />
      {(status.isLoading || buddy.isLoading) && <Skeleton className="h-64" />}
      {status.isError && <ErrorState error={status.error} onRetry={() => void status.refetch()} />}
      {buddy.data && (
        <section aria-labelledby="buddy-title" className="grid gap-3">
          <h2 id="buddy-title" className="text-title font-semibold">
            {t('habits.buddy.title')}
          </h2>
          {buddy.data.mine && <Pair pair={buddy.data.mine} />}
          {buddy.data.juniors.map((p) => (
            <Pair key={p.id} pair={p} />
          ))}
          {!buddy.data.mine && !buddy.data.juniors.length && (
            <EmptyState icon={<Users className="size-6" />} title={t('habits.buddy.noneTitle')}>
              {s?.buddy.canVolunteer ? t('habits.buddy.noneSenior') : t('habits.buddy.noneFirstYear')}
            </EmptyState>
          )}
        </section>
      )}
      {s && (
        <Card variant="raised" className="grid gap-5 p-4 sm:p-6">
          <div className="grid gap-2">
            <h2 className="text-title font-semibold">{t('habits.peers.mentorTitle')}</h2>
            <p className="text-meta text-fg-2">
              {s.eligible
                ? s.reason === 'offer'
                  ? t('habits.peers.eligibleOffer')
                  : t('habits.peers.eligibleNominated')
                : t('habits.peers.notEligible')}
            </p>
            <Switch
              checked={s.active}
              disabled={(!s.eligible && !s.active) || mentor.isPending}
              onChange={(on) => mentor.mutate(on)}
              label={t('habits.peers.mentorSwitch')}
              description={t('habits.peers.mentorSwitchBody')}
            />
            {s.active && (
              <Link to="/mentor" className="text-meta font-semibold text-brand-ink underline">
                {t('habits.peers.settings')}
              </Link>
            )}
          </div>
          <div className="grid gap-2">
            <h2 className="text-title font-semibold">{t('habits.buddy.volunteerTitle')}</h2>
            <Switch
              checked={s.buddy.volunteering}
              disabled={(!s.buddy.canVolunteer && !s.buddy.volunteering) || volunteer.isPending}
              onChange={(on) => volunteer.mutate(on)}
              label={t('habits.buddy.volunteerSwitch')}
              description={
                s.buddy.canVolunteer
                  ? t('habits.buddy.volunteerBody', { n: s.buddy.max })
                  : t('habits.buddy.volunteerNo')
              }
            />
            {s.buddy.volunteering && (
              <p className="text-caption text-fg-3">
                {t('habits.buddy.guiding', { n: s.buddy.juniors, max: s.buddy.max })}
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
