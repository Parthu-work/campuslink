import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Crown, Medal, Users } from 'lucide-react';
import type { LeaderboardRow, MyProgressView, WallOfMentorsView } from '@campuslink/shared';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Illustration } from '../../components/ui/illustration';
import { IntentLink } from '../../components/ui/intent-link';
import { PageHeader } from '../../components/ui/page-header';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { Segmented } from '../../components/ui/tab-nav';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { SCREEN } from '../../lib/query-client';

function OptInHint({ field }: { field: 'showOnLeaderboard' | 'showOnWall' }) {
  const { t } = useTranslation();
  const me = useQuery({ queryKey: ['progress'], queryFn: () => api.get<MyProgressView>('/me/progress') });
  if (!me.data || me.data.prefs[field]) return null;
  return (
    <p className="text-meta text-fg-2">
      {t(field === 'showOnLeaderboard' ? 'progress.notOnBoard' : 'progress.notOnWall')}{' '}
      <Link to="/progress" className="font-semibold text-brand-ink underline">
        {t('progress.changeInProgress')}
      </Link>
    </p>
  );
}

/**
 * The top three on a podium (§8.10): first in the middle and tallest. In reading order the list is
 * still 1, 2, 3; only the layout moves second to the left.
 */
function Podium({ rows }: { rows: LeaderboardRow[] }) {
  const { t } = useTranslation();
  const place = ['order-2', 'order-1', 'order-3'];
  const height = ['h-28', 'h-20', 'h-14'];
  return (
    <ol aria-label={t('progress.podium')} className="grid grid-cols-3 items-end gap-2 sm:gap-4">
      {rows.map((r, i) => (
        <li key={r.person.userId} className={cn('grid justify-items-center gap-2 text-center', place[i])}>
          <span className={cn('rounded-full p-[3px]', i === 0 ? 'aurora-ring' : 'bg-line-strong')}>
            <span className="block rounded-full bg-bg p-[2px]">
              <PersonAvatar name={r.person.name} fileId={r.person.avatarFileId} size={i === 0 ? 72 : 56} />
            </span>
          </span>
          <span className="grid min-w-0 max-w-full">
            <b className="truncate text-meta">
              {r.person.name}
              {r.isMe && <span className="font-normal text-fg-3"> · {t('progress.you')}</span>}
            </b>
            <span className="text-caption text-fg-2 tabular-nums">{t('progress.xpN', { xp: r.points })}</span>
          </span>
          <span
            className={cn(
              'grid w-full place-items-center rounded-t-[var(--radius-md)] font-display text-headline font-bold',
              i === 0 ? 'bg-aurora text-on-aurora' : 'bg-surface-2 text-fg-2',
              height[i],
            )}
          >
            <span aria-hidden>{r.rank}</span>
            <span className="sr-only">{t('progress.rank', { rank: r.rank })}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function LeaderboardPage() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<'college' | 'branch'>('college');
  const q = useQuery({
    ...SCREEN,
    queryKey: ['leaderboard', scope],
    queryFn: () => api.get<LeaderboardRow[]>(`/leaderboard?scope=${scope}`),
  });
  return (
    <div className="grid gap-5">
      <PageHeader icon={<Medal />} title={t('progress.leaderboard')} intro={t('progress.leaderboardIntro')} />
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
        <>
          {q.data.length >= 3 && <Podium rows={q.data.slice(0, 3)} />}
          <ol className="grid gap-2" start={q.data.length >= 3 ? 4 : 1}>
            {(q.data.length >= 3 ? q.data.slice(3) : q.data).map((r) => (
              <li key={r.person.userId}>
                <Card
                  variant="raised"
                  className={cn('flex items-center gap-3 p-3', r.isMe && 'border-brand bg-brand-surface')}
                >
                  <span className="w-8 text-center font-display text-lead font-bold tabular-nums">
                    <span aria-hidden>{r.rank}</span>
                    <span className="sr-only">{t('progress.rank', { rank: r.rank })}</span>
                  </span>
                  <PersonAvatar name={r.person.name} fileId={r.person.avatarFileId} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {r.person.name}
                      {r.isMe && <span className="text-fg-3"> · {t('progress.you')}</span>}
                    </span>
                    {r.branch && <span className="text-caption text-fg-3">{r.branch}</span>}
                  </span>
                  <Badge tone="brand">{t('progress.xpN', { xp: r.points })}</Badge>
                </Card>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

export function WallOfMentorsPage() {
  const { t } = useTranslation();
  const q = useQuery({
    ...SCREEN,
    queryKey: ['wall'],
    queryFn: () => api.get<WallOfMentorsView>('/wall-of-mentors'),
  });
  const motm = q.data?.mentorOfTheMonth;
  return (
    <div className="grid gap-5">
      <PageHeader icon={<Users />} title={t('progress.wall')} intro={t('progress.wallIntro')} />
      <OptInHint field="showOnWall" />
      {motm && (
        <Card variant="featured" className="flex flex-wrap items-center gap-4 p-5">
          <span className="aurora-ring rounded-full p-[3px]">
            <span className="block rounded-full bg-surface-1 p-[2px]">
              <PersonAvatar name={motm.person.name} fileId={motm.person.avatarFileId} size={72} />
            </span>
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-meta font-semibold text-brand-ink">
              <Crown className="size-4" aria-hidden /> {t('progress.motm', { month: motm.month })}
            </p>
            <p className="text-headline font-bold">{motm.person.name}</p>
            <p className="text-meta text-fg-2">{t('progress.impactN', { impact: motm.impact })}</p>
          </div>
        </Card>
      )}
      {q.isLoading ? (
        <Skeleton className="h-48" />
      ) : !q.data?.mentors.length ? (
        <EmptyState art={<Illustration kind="people" />} title={t('progress.wallEmpty')} />
      ) : (
        // A mosaic of faces: people first (§3, §8.10).
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {q.data.mentors.map((m) => (
            <li key={m.person.userId}>
              <IntentLink
                to={`/people/${m.person.userId}`}
                className="block h-full rounded-[var(--radius-lg)]"
              >
                <Card
                  variant="interactive"
                  className="grid h-full justify-items-center gap-2 overflow-hidden p-4 text-center"
                >
                  <PersonAvatar name={m.person.name} fileId={m.person.avatarFileId} size={80} />
                  <b className="max-w-full truncate text-body">{m.person.name}</b>
                  <Badge tone="brand">{t(`progress.mentorLevels.${m.level}`)}</Badge>
                  <span className="text-caption text-fg-3">
                    {t('progress.menteesN', { count: m.menteesHelped })}
                  </span>
                </Card>
              </IntentLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
