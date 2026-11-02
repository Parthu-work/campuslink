import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { Bookmark, Film, MessageCircle, Rss } from 'lucide-react';
import { TOPICS, type FollowState, type PostView, type PublicProfile, type Topic } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Card, Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { RichText } from '../../components/ui/rich-text';
import { api, apiRequest } from '../../lib/api';
import { useFollow } from '../../lib/follows';
import { prefersReducedMotion } from '../../lib/preferences';
import { AuthorLine, ReelVideo } from './post-card';
import { FeedList } from './feed-list';
import { SCREEN } from '../../lib/query-client';

export function SavedPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto grid w-full max-w-[680px] gap-4">
      <PageHeader title={t('feed.savedTitle')} intro={t('feed.savedIntro')} />
      <FeedList
        queryKey={['posts', 'saved']}
        path="/posts?saved=true"
        posts
        label={t('feed.savedTitle')}
        empty={
          <EmptyState icon={<Bookmark className="size-6" />} title={t('feed.savedEmpty')}>
            {t('feed.savedEmptyBody')}
          </EmptyState>
        }
      />
    </div>
  );
}

/** One reel: plays muted while on screen (never with reduced motion), always with controls. */
function Reel({ post }: { post: PostView }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setVisible(!!e?.isIntersecting && e.intersectionRatio > 0.6),
      {
        threshold: [0, 0.6, 1],
      },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const v = ref.current?.querySelector('video');
    if (!v) return;
    if (visible && !prefersReducedMotion()) void v.play().catch(() => undefined);
    else v.pause();
  }, [visible]);
  const video = post.media.find((m) => m.kind === 'video');
  return (
    <Card className="grid snap-start gap-3 p-3">
      <article ref={ref} className="grid gap-3" aria-label={post.author.name}>
        <AuthorLine author={post.author} at={post.createdAt}>
          <Link
            to={`/posts/${post.id}`}
            className={buttonVariants({ size: 'sm', variant: 'ghost' })}
            aria-label={t('feed.commentsLabel', { count: post.counts.comments })}
          >
            <MessageCircle className="size-4" aria-hidden />
            <span aria-hidden className="font-mono text-caption">
              {post.counts.comments || ''}
            </span>
          </Link>
        </AuthorLine>
        {video && <ReelVideo fileId={video.fileId} alt={video.alt} />}
        {post.body && <RichText text={post.body} className="text-body" />}
      </article>
    </Card>
  );
}

export function ReelsPage() {
  const { t } = useTranslation();
  const q = useInfiniteQuery({
    ...SCREEN,
    queryKey: ['posts', 'reels'],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<PostView[]>(`/posts?kind=reel${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });
  const reels = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="mx-auto grid w-full max-w-[520px] gap-4">
      <PageHeader title={t('feed.reelsTitle')} intro={t('feed.reelsIntro')} />
      {q.isLoading && <Skeleton className="aspect-[9/16] w-full" />}
      {q.isSuccess && !reels.length && (
        <EmptyState icon={<Film className="size-6" />} title={t('feed.reelsEmpty')}>
          {t('feed.reelsEmptyBody')}
        </EmptyState>
      )}
      <div className="grid snap-y gap-4">
        {reels.map((p) => (
          <Reel key={p.id} post={p} />
        ))}
      </div>
      {q.hasNextPage && (
        <Button loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          {t('common.loadMore')}
        </Button>
      )}
    </div>
  );
}

export function FollowingPage() {
  const { t } = useTranslation();
  const follows = useQuery({ queryKey: ['follows'], queryFn: () => api.get<FollowState>('/me/follows') });
  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<{ id: string; name: string; host: string; topics: Topic[] }[]>('/sources'),
  });
  const people = useQueries({
    queries: (follows.data?.users ?? []).slice(0, 50).map((id) => ({
      queryKey: ['profile', id],
      queryFn: () => api.get<PublicProfile>(`/profiles/${id}`),
      retry: false,
    })),
  });
  const follow = useFollow();
  const f = follows.data;
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-5">
      <PageHeader title={t('feed.followingTitle')} intro={t('feed.followingIntro')} />
      <Card className="grid gap-3 p-4">
        <h2 className="font-semibold">{t('feed.topics')}</h2>
        <div role="group" aria-label={t('feed.topics')} className="flex flex-wrap gap-1.5">
          {TOPICS.map((tp) => {
            const on = !!f?.topics.includes(tp);
            return (
              <Chip
                key={tp}
                pressed={on}
                disabled={!f}
                onClick={() => follow.mutate({ type: 'topic', id: tp, on: !on })}
              >
                {t(`topics.${tp}`)}
              </Chip>
            );
          })}
        </div>
      </Card>
      <Card className="grid gap-3 p-4">
        <h2 className="font-semibold">{t('feed.sourcesTitle')}</h2>
        <p className="text-meta text-fg-2">{t('feed.sourcesIntro')}</p>
        {sources.data && !sources.data.length && <p className="text-meta text-fg-3">{t('feed.noSources')}</p>}
        <ul className="grid gap-2">
          {sources.data?.map((s) => {
            const on = !!f?.sources.includes(s.id);
            return (
              <li key={s.id} className="flex items-center gap-3">
                <span
                  className="grid size-9 flex-none place-items-center rounded-full bg-surface-2 text-accent-ink"
                  aria-hidden
                >
                  <Rss className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-meta">{s.name}</b>
                  <span className="block truncate text-caption text-fg-3">
                    {s.host}
                    {s.topics.length > 0 && ` · ${s.topics.map((x) => t(`topics.${x}`)).join(', ')}`}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant={on ? 'secondary' : 'primary'}
                  aria-pressed={on}
                  onClick={() => follow.mutate({ type: 'source', id: s.id, on: !on })}
                >
                  {on ? t('feed.following') : t('feed.follow')}
                  <span className="sr-only"> {s.name}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card className="grid gap-3 p-4">
        <h2 className="font-semibold">{t('feed.peopleTitle')}</h2>
        {f && !f.users.length && (
          <p className="text-meta text-fg-2">
            {t('feed.noPeople')}{' '}
            <Link to="/people" className="font-semibold text-brand-ink hover:underline">
              {t('nav.people')}
            </Link>
          </p>
        )}
        <ul className="grid gap-2">
          {people.map((p, i) => {
            const id = f?.users[i] ?? '';
            const d = p.data;
            return (
              <li key={id} className="flex items-center gap-3">
                <PersonAvatar name={d?.name ?? '?'} fileId={d?.avatarFileId ?? null} size={36} />
                <Link
                  to={`/people/${id}`}
                  className="min-w-0 flex-1 truncate text-meta font-semibold hover:underline"
                >
                  {d?.name ?? t('feed.memberHidden')}
                </Link>
                <Button size="sm" onClick={() => follow.mutate({ type: 'user', id, on: false })}>
                  {t('feed.unfollow')}
                  <span className="sr-only"> {d?.name}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
