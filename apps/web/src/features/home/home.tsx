import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Compass,
  HeartHandshake,
  Lock,
  MessageCircleQuestion,
  Rss,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import type { AuthorRef, FollowState, ImpactView, Topic } from '@campuslink/shared';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Segmented } from '../../components/ui/tab-nav';
import { Button } from '../../components/ui/button';
import { IntentLink } from '../../components/ui/intent-link';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { api } from '../../lib/api';
import { oneUsefulThing, upcomingBookings } from '../../lib/queries';
import { useCan, useMe } from '../../lib/me';
import { formatDay, formatRelative, formatTime } from '../../lib/format';
import { buttonVariants } from '../../components/ui/button-variants';
import { PageHeader } from '../../components/ui/page-header';
import { ItemCard, PostCard } from '../feed/post-card';
import { Composer } from '../feed/composer';
import { StoriesRow } from '../feed/stories';
import { FeedList } from '../feed/feed-list';

function NextSession() {
  const { t } = useTranslation();
  const q = useQuery(upcomingBookings());
  const b = q.data?.[0];
  if (q.isLoading) return <Skeleton className="h-24" />;
  return (
    <Card className="flex items-center gap-3 p-4">
      {b ? (
        <>
          <PersonAvatar
            name={(b.role === 'mentor' ? b.mentee : b.mentor).name}
            fileId={(b.role === 'mentor' ? b.mentee : b.mentor).avatarFileId}
          />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{t('home.nextSession')}</p>
            <b className="block truncate">
              {t(`session.type.${b.sessionType}`)} · {(b.role === 'mentor' ? b.mentee : b.mentor).name}
            </b>
            <p className="text-meta text-fg-2">
              {formatDay(b.start)}, {formatTime(b.start)}
            </p>
          </div>
        </>
      ) : (
        <>
          <CalendarClock className="size-6 flex-none text-accent-ink" aria-hidden />
          <p className="min-w-0 flex-1 text-meta text-fg-2">{t('home.noSession')}</p>
        </>
      )}
      <Link
        to="/sessions"
        className="inline-flex min-h-11 items-center rounded-full px-3 text-meta font-semibold text-brand-ink hover:bg-hover"
      >
        {t('nav.sessions')}
      </Link>
    </Card>
  );
}

/**
 * Phones: the next session, when there is one, right under the stories (IA-6). Wide screens show
 * it in the right column instead.
 */
function UpNext() {
  const { t } = useTranslation();
  const [now] = useState(() => Date.now());
  const q = useQuery(upcomingBookings());
  const b = q.data?.[0];
  if (!b) return null;
  const other = b.role === 'mentor' ? b.mentee : b.mentor;
  return (
    <IntentLink to="/sessions" className="block rounded-[var(--radius-lg)] xl:hidden">
      <Card variant="interactive" className="flex items-center gap-3 p-3.5">
        <PersonAvatar name={other.name} fileId={other.avatarFileId} size={44} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{t('home.nextSession')}</p>
          <b className="block truncate text-body">
            {t(`session.type.${b.sessionType}`)} · {other.name}
          </b>
          <p className="text-meta text-fg-2">
            {formatDay(b.start)}, {formatTime(b.start)} ·{' '}
            {Date.parse(b.start) <= now
              ? t('home.happeningNow')
              : t('home.startsIn', { when: formatRelative(b.start) })}
          </p>
        </div>
        <CalendarClock className="size-5 flex-none text-brand-ink" aria-hidden />
      </Card>
    </IntentLink>
  );
}

function ImpactTeaser() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['impact'], queryFn: () => api.get<ImpactView>('/me/mentor/impact') });
  if (!q.data) return null;
  return (
    <Link to="/mentor" className="block rounded-[var(--radius-md)]">
      <Card variant="interactive" className="flex items-center gap-3 p-4">
        <HeartHandshake className="size-6 flex-none text-accent-ink" aria-hidden />
        <div className="min-w-0 flex-1">
          <b className="block">{t('mentor.helped', { count: q.data.helpedThisMonth })}</b>
          {q.data.pendingRequests > 0 && (
            <p className="text-meta text-fg-2">{t('mentor.pending', { count: q.data.pendingRequests })}</p>
          )}
        </div>
      </Card>
    </Link>
  );
}

function OneUsefulThing() {
  const { t } = useTranslation();
  const q = useQuery(oneUsefulThing());
  if (q.isLoading) return <Skeleton className="h-40" />;
  const v = q.data;
  if (!v || (!v.post && !v.item)) return null;
  return (
    // The day's hero: the aurora hairline and a soft wash, the one featured surface on Home (§8.3).
    <section
      aria-labelledby="out-title"
      className="aurora-border grid gap-2 rounded-[var(--radius-xl)] bg-[linear-gradient(160deg,color-mix(in_oklch,var(--aurora-1)_16%,var(--surface-1)),var(--surface-1)_60%)] p-2 pt-3 shadow-elev-2"
    >
      <h2 id="out-title" className="flex items-center gap-2 px-2.5 text-title font-semibold">
        <Sparkles className="size-5 text-brand-ink" aria-hidden /> {t('feed.out')}
        {v.curated && <Badge tone="accent">{t('feed.outCurated')}</Badge>}
      </h2>
      {v.post && <PostCard post={v.post} headingLevel={3} />}
      {v.item && <ItemCard item={v.item} headingLevel={3} />}
    </section>
  );
}

function FollowButton({ type, id, following }: { type: 'user' | 'source'; id: string; following: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () =>
      following
        ? api.delete<FollowState>(`/follows/${type}/${id}`)
        : api.post<FollowState>('/follows', { targetType: type, targetId: id }),
    onSuccess: (state) => {
      qc.setQueryData(['follows'], state);
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
  return (
    <Button
      size="sm"
      variant={following ? 'secondary' : 'primary'}
      loading={m.isPending}
      onClick={() => m.mutate()}
    >
      {following ? t('feed.following') : t('feed.follow')}
    </Button>
  );
}

function Suggestions() {
  const { t } = useTranslation();
  const canFollow = useCan('sources:follow');
  const q = useQuery({
    queryKey: ['suggestions'],
    queryFn: () =>
      api.get<{
        people: AuthorRef[];
        sources: { id: string; name: string; host: string; topics: Topic[] }[];
      }>('/feed/suggestions'),
    enabled: canFollow,
    staleTime: 5 * 60_000,
  });
  const follows = useQuery({
    queryKey: ['follows'],
    queryFn: () => api.get<FollowState>('/me/follows'),
    enabled: canFollow,
  });
  if (!q.data || (!q.data.people.length && !q.data.sources.length)) return null;
  const f = follows.data;
  return (
    <Card className="grid gap-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <UserPlus className="size-5 text-brand-ink" aria-hidden /> {t('feed.suggestions')}
      </h2>
      <ul className="grid gap-3">
        {q.data.people.slice(0, 4).map((p) => (
          <li key={p.userId} className="flex items-center gap-2.5">
            <PersonAvatar name={p.name} fileId={p.avatarFileId} size={36} />
            <Link to={`/people/${p.userId}`} className="min-w-0 flex-1 text-meta hover:underline">
              <b className="block truncate">{p.name}</b>
              <span className="block truncate text-caption text-fg-3">{p.headline || p.branch}</span>
            </Link>
            <FollowButton type="user" id={p.userId} following={!!f?.users.includes(p.userId)} />
          </li>
        ))}
        {q.data.sources.slice(0, 3).map((s) => (
          <li key={s.id} className="flex items-center gap-2.5">
            <span
              className="grid size-9 flex-none place-items-center rounded-full bg-surface-2 text-accent-ink"
              aria-hidden
            >
              <Rss className="size-4" />
            </span>
            <span className="min-w-0 flex-1 text-meta">
              <b className="block truncate">{s.name}</b>
              <span className="block truncate text-caption text-fg-3">{s.host}</span>
            </span>
            <FollowButton type="source" id={s.id} following={!!f?.sources.includes(s.id)} />
          </li>
        ))}
      </ul>
      <Link to="/following" className="text-meta font-semibold text-brand-ink hover:underline">
        {t('feed.manageFollows')}
      </Link>
    </Card>
  );
}

function RightRail() {
  const { t } = useTranslation();
  const canRequest = useCan('mentorship:request');
  const canMentor = useCan('mentorship:mentor');
  return (
    <aside aria-label={t('home.rail')} className="grid content-start gap-3">
      {canRequest && (
        <>
          <NextSession />
          {canMentor && <ImpactTeaser />}
          <Link to="/mentors" className="block rounded-[var(--radius-md)]">
            <Card variant="interactive" className="flex items-center gap-3 p-4">
              <Compass className="size-6 flex-none text-brand-ink" aria-hidden />
              <div className="min-w-0 flex-1">
                <b className="block">{t('home.findMentor')}</b>
                <p className="text-meta text-fg-2">{t('home.findMentorBody')}</p>
              </div>
            </Card>
          </Link>
        </>
      )}
      <Link to="/questions" className="block rounded-[var(--radius-md)]">
        <Card variant="interactive" className="flex items-center gap-3 p-4">
          <MessageCircleQuestion className="size-6 flex-none text-accent-ink" aria-hidden />
          <div className="min-w-0 flex-1">
            <b className="block">{t('qa.teaser')}</b>
            <p className="text-meta text-fg-2">{t('qa.teaserBody')}</p>
          </div>
        </Card>
      </Link>
      <Suggestions />
    </aside>
  );
}

/** Home: stories, today's One Useful Thing, the composer and the For You / Following feed. */
export function HomePage() {
  const { t } = useTranslation();
  const { data: me, isLoading } = useMe();
  const canPost = useCan('feed:post');
  const canRequest = useCan('mentorship:request');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'following' ? 'following' : 'for_you';
  // Today's One Useful Thing sits above the feed, so the feed leaves it out (IA-12).
  const out = useQuery(oneUsefulThing());
  const shown = out.data?.post?.id ?? out.data?.item?.id;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid min-w-0 content-start gap-4">
        <PageHeader
          eyebrow={formatDay(new Date())}
          title={
            isLoading || !me ? (
              <Skeleton className="h-9 w-56" />
            ) : (
              t('home.greeting', { name: me.name.split(' ')[0] })
            )
          }
        />
        {me && !me.verified && (
          <Card className="flex gap-3 border-warning-border bg-warning-surface p-4" role="status">
            <Lock className="mt-0.5 size-5 flex-none text-warning" aria-hidden />
            <div>
              <h2 className="text-body font-semibold">{t('home.unverifiedTitle')}</h2>
              <p className="text-meta text-fg-2">{t('home.unverifiedBody')}</p>
              <Link
                to="/verify"
                className={buttonVariants({ variant: 'primary', size: 'sm', className: 'mt-3' })}
              >
                {t('home.verifyCta')}
              </Link>
            </div>
          </Card>
        )}
        <StoriesRow />
        {canRequest && <UpNext />}
        <OneUsefulThing />
        {canPost && <Composer />}
        <Segmented
          label={t('feed.tabs')}
          value={tab}
          options={[
            ['for_you', t('feed.forYou')],
            ['following', t('feed.followingTab')],
          ]}
          onChange={(v) => setParams(v === 'following' ? { tab: v } : {}, { replace: true })}
        />
        <FeedList
          key={tab}
          queryKey={['feed', tab]}
          path={`/feed?tab=${tab}&limit=15`}
          label={tab === 'following' ? t('feed.followingTab') : t('feed.forYou')}
          exclude={shown}
          empty={
            <EmptyState
              icon={<Rss className="size-6" />}
              title={tab === 'following' ? t('feed.emptyFollowing') : t('feed.emptyForYou')}
              action={
                <Link to="/following" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                  {t('feed.findThingsToFollow')}
                </Link>
              }
            >
              {tab === 'following' ? t('feed.emptyFollowingBody') : t('feed.emptyForYouBody')}
            </EmptyState>
          }
        />
      </div>
      <div className="hidden xl:block">
        <div className="sticky top-5">
          <RightRail />
        </div>
      </div>
    </div>
  );
}
