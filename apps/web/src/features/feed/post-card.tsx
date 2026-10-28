import { useId, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import {
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  HandHeart,
  Lightbulb,
  Megaphone,
  MessageCircle,
  PartyPopper,
  Rss,
  Share2,
} from 'lucide-react';
import { REACTIONS, type AuthorRef, type ItemView, type PostView, type Reaction } from '@campuslink/shared';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Card } from '../../components/ui/misc';
import { ProgressBar } from '../../components/ui/progress';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { RichText } from '../../components/ui/rich-text';
import { api, ApiError } from '../../lib/api';
import { useFileUrl, useStreamedFile } from '../../lib/files';
import { formatDateTime, formatRelative } from '../../lib/format';
import { patchPost, usePostActions } from '../../lib/feed';
import { useCan } from '../../lib/me';
import { pop } from '../../lib/celebrate';
import { cn } from '../../lib/cn';
import { ContentMenu, RemovalNotice } from './content-menu';

const STAFF = ['TPO', 'FACULTY', 'COLLEGE_ADMIN'];
const REACTION_ICON: Record<Reaction, typeof Lightbulb> = {
  helpful: HandHeart,
  insightful: Lightbulb,
  celebrate: PartyPopper,
};

export function AuthorLine({
  author,
  at,
  children,
}: {
  author: AuthorRef;
  at: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const role = author.roles.includes('ALUMNI')
    ? t('feed.alumniOf', { year: author.gradYear ?? '' }).trim()
    : author.roles.some((r) => STAFF.includes(r))
      ? t('feed.staff')
      : author.roles.includes('STUDENT')
        ? t('role.STUDENT')
        : '';
  return (
    <div className="flex min-w-0 items-center gap-3">
      <PersonAvatar name={author.name || '?'} fileId={author.avatarFileId} size={40} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {author.name ? (
            <Link
              to={`/people/${author.userId}`}
              className="inline-flex min-h-6 max-w-full items-center truncate font-semibold hover:underline"
            >
              {author.name}
            </Link>
          ) : (
            <span className="text-fg-3">{t('feed.memberHidden')}</span>
          )}
          {role && <Badge tone={author.roles.includes('ALUMNI') ? 'accent' : 'neutral'}>{role}</Badge>}
        </p>
        <p className="truncate text-caption text-fg-3">
          {[author.headline, author.branch].filter(Boolean).join(' · ')}
          {(author.headline || author.branch) && ' · '}
          <time dateTime={at} title={formatDateTime(at)}>
            {formatRelative(at)}
          </time>
        </p>
      </div>
      {children}
    </div>
  );
}

function PostImage({
  fileId,
  alt,
  single,
  onDoubleTap,
}: {
  fileId: string;
  alt: string;
  single: boolean;
  onDoubleTap?: () => void;
}) {
  const url = useFileUrl(fileId);
  return (
    <div
      onDoubleClick={onDoubleTap}
      className={cn(
        'overflow-hidden rounded-[var(--radius-md)] bg-surface-2 [touch-action:manipulation]',
        single ? 'aspect-[4/3]' : 'aspect-square',
      )}
    >
      {url ? (
        <img src={url} alt={alt} loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <span
          role="img"
          aria-label={alt}
          className="block size-full animate-pulse motion-reduce:animate-none"
        />
      )}
    </div>
  );
}

export function ReelVideo({
  fileId,
  alt,
  autoPlay = false,
  className,
}: {
  fileId: string;
  alt: string;
  autoPlay?: boolean;
  className?: string;
}) {
  const stream = useStreamedFile(fileId);
  const descId = useId();
  return (
    <figure className={cn('grid gap-1.5', className)}>
      <div className="overflow-hidden rounded-[var(--radius-sm)] bg-black">
        {stream.src ? (
          <video
            {...stream}
            controls
            playsInline
            muted={autoPlay}
            autoPlay={autoPlay}
            loop={autoPlay}
            preload="metadata"
            aria-describedby={descId}
            className="mx-auto max-h-[70vh] w-full object-contain"
          />
        ) : (
          <div className="aspect-[9/16] max-h-[70vh] w-full animate-pulse bg-surface-2 motion-reduce:animate-none" />
        )}
      </div>
      <figcaption id={descId} className="text-caption text-fg-3">
        {alt}
      </figcaption>
    </figure>
  );
}

function Poll({ post }: { post: PostView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canVote = useCan('feed:interact');
  const poll = post.poll;
  const vote = useMutation({
    mutationFn: (option: number) => api.post<PostView>(`/posts/${post.id}/vote`, { option }),
    onSuccess: (fresh) => patchPost(qc, post.id, () => fresh),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  if (!poll) return null;
  const showResults = poll.closed || poll.myVote !== null || post.isMine;
  return (
    <fieldset className="grid gap-2">
      <legend className="sr-only">{t('feed.pollLegend')}</legend>
      {poll.options.map((o, i) => {
        const pct = poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
        return showResults ? (
          <div
            key={i}
            className="grid gap-1.5 rounded-[var(--radius-md)] border border-line px-3.5 py-2.5 text-meta"
          >
            <span className="flex justify-between gap-3">
              <span className={cn(poll.myVote === i && 'font-semibold')}>
                {o.text}
                {poll.myVote === i && <span className="sr-only"> ({t('feed.yourVote')})</span>}
              </span>
              <span className="font-mono tabular-nums">{pct}%</span>
            </span>
            <ProgressBar value={pct} max={100} size="sm" tone={poll.myVote === i ? 'brand' : 'neutral'} />
          </div>
        ) : (
          <button
            key={i}
            type="button"
            disabled={!canVote || vote.isPending}
            onClick={() => vote.mutate(i)}
            className="pressable min-h-11 rounded-[var(--radius-md)] border border-line-strong px-3.5 text-left text-meta font-medium transition-colors hover:border-brand hover:bg-brand-surface disabled:opacity-60"
          >
            {o.text}
          </button>
        );
      })}
      <p className="text-caption text-fg-3">
        {t('feed.votes', { count: showResults ? poll.total : 0 })}
        {showResults ? '' : ` · ${t('feed.voteToSee')}`} ·{' '}
        {poll.closed ? t('feed.pollClosed') : t('feed.pollCloses', { when: formatRelative(poll.closesAt) })}
      </p>
    </fieldset>
  );
}

function LinkPreview({ link }: { link: NonNullable<PostView['link']> }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      className="grid gap-0.5 rounded-[var(--radius-md)] border border-line p-3 transition-colors hover:border-line-strong hover:bg-hover"
    >
      <span className="flex items-center gap-1.5 text-caption text-fg-3">
        <ExternalLink className="size-3.5" aria-hidden /> {link.siteName || link.host}
      </span>
      <b className="line-clamp-2">{link.title || link.url}</b>
      {link.description && <span className="line-clamp-2 text-meta text-fg-2">{link.description}</span>}
    </a>
  );
}

function ActionBar({ post }: { post: PostView }) {
  const { t } = useTranslation();
  const canInteract = useCan('feed:interact');
  const { react, save, share } = usePostActions(post);
  const live = post.status === 'published';
  return (
    <div className="-mx-1.5 -mb-1.5 flex flex-wrap items-center gap-0.5 border-t border-line pt-1.5">
      <div role="group" aria-label={t('feed.reactions')} className="flex gap-1">
        {REACTIONS.map((r) => {
          const Icon = REACTION_ICON[r];
          const n = post.counts.reactions[r];
          const on = post.myReaction === r;
          return (
            <button
              key={r}
              type="button"
              aria-pressed={on}
              disabled={!canInteract || !live}
              onClick={(e) => {
                if (!on) pop(e.currentTarget);
                react.mutate(on ? null : r);
              }}
              aria-label={t('feed.reactLabel', { reaction: t(`feed.reaction.${r}`), count: n })}
              className="react-pop inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2.5 text-meta text-fg-2 transition-[scale,background-color,color] duration-[var(--dur-fast)] ease-snappy hover:bg-hover active:scale-90 disabled:opacity-60 aria-pressed:bg-brand-surface aria-pressed:text-brand-ink"
            >
              <Icon className="size-[18px]" aria-hidden />
              <span aria-hidden className="text-caption font-semibold tabular-nums">
                {n || ''}
              </span>
            </button>
          );
        })}
      </div>
      <IntentLink
        to={`/posts/${post.id}`}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2.5 text-meta text-fg-2 hover:bg-hover"
        aria-label={t('feed.commentsLabel', { count: post.counts.comments })}
      >
        <MessageCircle className="size-[18px]" aria-hidden />
        <span aria-hidden className="text-caption font-semibold tabular-nums">
          {post.counts.comments || ''}
        </span>
      </IntentLink>
      <span className="ml-auto flex gap-1">
        <button
          type="button"
          aria-pressed={post.saved}
          disabled={!canInteract || !live}
          onClick={(e) => {
            if (!post.saved) pop(e.currentTarget);
            save.mutate(!post.saved);
          }}
          aria-label={post.saved ? t('feed.unsave') : t('feed.save')}
          className="react-pop grid size-11 place-items-center rounded-full text-fg-2 transition-[scale] duration-[var(--dur-fast)] ease-snappy hover:bg-hover active:scale-90 disabled:opacity-60 aria-pressed:text-brand-ink"
        >
          {post.saved ? (
            <BookmarkCheck className="size-5 fill-current" aria-hidden />
          ) : (
            <Bookmark className="size-5" aria-hidden />
          )}
        </button>
        <button
          type="button"
          disabled={!canInteract || !live}
          onClick={() => share.mutate()}
          aria-label={t('feed.share')}
          className="grid size-11 place-items-center rounded-full text-fg-2 hover:bg-hover disabled:opacity-60"
        >
          <Share2 className="size-5" aria-hidden />
        </button>
      </span>
    </div>
  );
}

export function PostCard({
  post,
  headingLevel = 2,
  morph = false,
}: {
  post: PostView;
  headingLevel?: 2 | 3;
  /** Name the card for the feed → post page view transition (only where it is unique on screen). */
  morph?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canInteract = useCan('feed:interact');
  const { remove, react } = usePostActions(post);
  const H = headingLevel === 2 ? 'h2' : 'h3';
  // Tapping the text opens the post (IA-9); links, buttons and selecting text keep their own job.
  // Keyboard and screen-reader users have the comments link, which goes to the same place.
  const openFromBody = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button, input, video, summary')) return;
    if (window.getSelection()?.toString()) return;
    void navigate(`/posts/${post.id}`);
  };
  // Double-tapping a photo marks the post helpful, like the reaction button (§6).
  const doubleTap =
    canInteract && post.status === 'published' && !post.myReaction
      ? () => react.mutate('helpful')
      : undefined;
  const images = post.media.filter((m) => m.kind === 'image');
  const video = post.media.find((m) => m.kind === 'video');
  return (
    <Card
      variant="raised"
      className={cn(
        'grid gap-3 p-4',
        post.announcement && 'border-[color-mix(in_oklch,var(--brand)_45%,var(--line))]',
      )}
    >
      <article
        aria-labelledby={`post-${post.id}`}
        className="grid gap-3"
        style={morph ? { viewTransitionName: `post-${post.id}` } : undefined}
      >
        <H id={`post-${post.id}`} className="sr-only">
          {t('feed.postBy', { name: post.author.name || t('feed.memberHidden') })}
        </H>
        <AuthorLine author={post.author} at={post.createdAt}>
          <ContentMenu
            targetType="post"
            targetId={post.id}
            authorId={post.author.userId}
            authorName={post.author.name}
            isMine={post.isMine}
            onDelete={() => remove.mutate()}
            deleting={remove.isPending}
            featurable={post.status === 'published'}
          />
        </AuthorLine>
        {(post.announcement || post.kind === 'reel') && (
          <p className="flex gap-2">
            {post.announcement && (
              <Badge tone="brand">
                <Megaphone className="size-3" aria-hidden /> {t('feed.announcement')}
              </Badge>
            )}
            {post.kind === 'reel' && <Badge tone="accent">{t('feed.tipsReel')}</Badge>}
          </p>
        )}
        {post.removal && (
          <RemovalNotice
            targetType="post"
            targetId={post.id}
            removal={post.removal}
            canAppeal={post.isMine}
          />
        )}
        {post.body && (
          <div onClick={openFromBody} className="cursor-pointer">
            <RichText text={post.body} />
          </div>
        )}
        {images.length > 0 && (
          <div className={cn('grid gap-1.5', images.length > 1 && 'grid-cols-2')}>
            {images.map((m) => (
              <PostImage
                key={m.fileId}
                fileId={m.fileId}
                alt={m.alt}
                single={images.length === 1}
                {...(doubleTap ? { onDoubleTap: doubleTap } : {})}
              />
            ))}
          </div>
        )}
        {video && <ReelVideo fileId={video.fileId} alt={video.alt} />}
        {post.poll && <Poll post={post} />}
        {post.link && <LinkPreview link={post.link} />}
        {post.topics.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={t('feed.topics')}>
            {post.topics.map((tp) => (
              <li key={tp}>
                <Badge>{t(`topics.${tp}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
        <ActionBar post={post} />
      </article>
    </Card>
  );
}

/** An ingested news item: snippet, attribution and a link out. Never the full article. */
export function ItemCard({ item, headingLevel = 2 }: { item: ItemView; headingLevel?: 2 | 3 }) {
  const { t } = useTranslation();
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Card variant="raised" className="grid gap-2 p-4">
      <article className="grid gap-2">
        <p className="flex items-center gap-2 text-caption text-fg-3">
          <Rss className="size-3.5 text-accent-ink" aria-hidden />
          <span className="truncate">
            {t('feed.from', { source: item.source.name })} ·{' '}
            <time dateTime={item.publishedAt} title={formatDateTime(item.publishedAt)}>
              {formatRelative(item.publishedAt)}
            </time>
          </span>
        </p>
        <H className="text-lead leading-snug font-semibold">
          <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
            {item.title}
            <span className="sr-only"> ({t('feed.opensSite', { host: item.host })})</span>
          </a>
        </H>
        {item.snippet && <p className="line-clamp-3 text-meta text-fg-2">{item.snippet}</p>}
        <p className="flex flex-wrap items-center gap-1.5">
          {item.topics.slice(0, 3).map((tp) => (
            <Badge key={tp}>{t(`topics.${tp}`)}</Badge>
          ))}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-full px-2.5 text-meta font-semibold text-brand-ink hover:bg-hover"
            aria-hidden
            tabIndex={-1}
          >
            {item.host} <ExternalLink className="size-3.5" />
          </a>
        </p>
      </article>
    </Card>
  );
}
