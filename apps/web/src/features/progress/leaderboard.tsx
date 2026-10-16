import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Crown, Medal, Users } from 'lucide-react';
import type { LeaderboardRow, MyProgressView, WallOfMentorsView } from '@campuslink/shared';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { Segmented } from '../../components/ui/tab-nav';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

function OptInHint({ field }: { field: 'showOnLeaderboard' | 'showOnWall' }) {
  const { t } = useTranslation();
  const me = useQuery({ queryKey: ['progress'], queryFn: () => api.get<MyProgressView>('/me/progress') });
  if (!me.data || me.data.prefs[field]) return null;
  return (
    <p className="text-sm text-fg-2">
      {t(field === 'showOnLeaderboard' ? 'progress.notOnBoard' : 'progress.notOnWall')}{' '}
      <Link to="/progress" className="font-semibold text-brand-ink underline">
        {t('progress.changeInProgress')}
      </Link>
    </p>
  );
}

export function LeaderboardPage() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<'college' | 'branch'>('college');
  const q = useQuery({
    queryKey: ['leaderboard', scope],
    queryFn: () => api.get<LeaderboardRow[]>(`/leaderboard?scope=${scope}`),
  });
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="flex items-center gap-2 text-[clamp(26px,4vw,34px)] font-bold">
          <Medal className="size-7 text-accent-ink" aria-hidden /> {t('progress.leaderboard')}
        </h1>
        <p className="max-w-[60ch] text-fg-2">{t('progress.leaderboardIntro')}</p>
      </div>
      <Segmented
        label={t('progress.scope')}
        value={scope}
        onChange={setScope}
        className="max-w-sm"
        options={[
          ['college', t('progress.scopeCollege')],
          ['branch', t('progress.scopeBranch')],
        ]}
      />
      <OptInHint field="showOnLeaderboard" />
      {q.isLoading ? (
        <Skeleton className="h-48" />
      ) : !q.data?.length ? (
        <EmptyState icon={<Medal className="size-6" />} title={t('progress.boardEmpty')} />
      ) : (
        <ol className="grid gap-2">
          {q.data.map((r) => (
            <li key={r.person.userId}>
              <Card className={cn('flex items-center gap-3 p-3', r.isMe && 'border-brand')}>
                <span
                  className="w-8 text-center font-mono text-lg font-bold"
                  aria-label={t('progress.rank', { rank: r.rank })}
                >
                  {r.rank}
                </span>
                <PersonAvatar name={r.person.name} fileId={r.person.avatarFileId} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {r.person.name}
                    {r.isMe && <span className="text-fg-3"> · {t('progress.you')}</span>}
                  </span>
                  {r.branch && <span className="text-xs text-fg-3">{r.branch}</span>}
                </span>
                <Badge tone="brand">{t('progress.xpN', { xp: r.points })}</Badge>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function WallOfMentorsPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['wall'], queryFn: () => api.get<WallOfMentorsView>('/wall-of-mentors') });
  const motm = q.data?.mentorOfTheMonth;
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="flex items-center gap-2 text-[clamp(26px,4vw,34px)] font-bold">
          <Users className="size-7 text-brand-ink" aria-hidden /> {t('progress.wall')}
        </h1>
        <p className="max-w-[60ch] text-fg-2">{t('progress.wallIntro')}</p>
      </div>
      <OptInHint field="showOnWall" />
      {motm && (
        <Card className="flex flex-wrap items-center gap-4 border-[color-mix(in_srgb,var(--accent)_50%,transparent)] p-5">
          <Crown className="size-8 text-accent-ink" aria-hidden />
          <PersonAvatar name={motm.person.name} fileId={motm.person.avatarFileId} size={56} />
          <div>
            <p className="text-sm text-fg-2">{t('progress.motm', { month: motm.month })}</p>
            <p className="font-display text-2xl font-bold">{motm.person.name}</p>
            <p className="text-sm text-fg-3">{t('progress.impactN', { impact: motm.impact })}</p>
          </div>
        </Card>
      )}
      {q.isLoading ? (
        <Skeleton className="h-48" />
      ) : !q.data?.mentors.length ? (
        <EmptyState icon={<Users className="size-6" />} title={t('progress.wallEmpty')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.mentors.map((m) => (
            <li key={m.person.userId}>
              <Card className="flex items-center gap-3 p-3">
                <PersonAvatar name={m.person.name} fileId={m.person.avatarFileId} size={44} />
                <span className="min-w-0 flex-1">
                  <Link
                    to={`/people/${m.person.userId}`}
                    className="block truncate font-semibold hover:underline"
                  >
                    {m.person.name}
                  </Link>
                  <span className="text-xs text-fg-3">
                    {t('progress.menteesN', { count: m.menteesHelped })}
                  </span>
                </span>
                <Badge tone="accent">{t(`progress.level.${m.level}`)}</Badge>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
