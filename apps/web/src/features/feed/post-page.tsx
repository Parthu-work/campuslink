import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, MessageCircle, Reply } from 'lucide-react';
import type { CommentView, PostView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/field';
import { Card, EmptyState } from '../../components/ui/misc';
import { RichText } from '../../components/ui/rich-text';
import { api, ApiError } from '../../lib/api';
import { findCached, hasId } from '../../lib/query-seed';
import { useCan } from '../../lib/me';
import { patchPost } from '../../lib/feed';
import { AuthorLine, PostCard } from './post-card';
import { PostSkeleton } from './feed-list';
import { ContentMenu, RemovalNotice } from './content-menu';

function CommentForm({
  postId,
  parentId,
  onDone,
  autoFocus,
}: {
  postId: string;
  parentId?: string;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api.post<CommentView>(`/posts/${postId}/comments`, {
        body: body.trim(),
        ...(parentId ? { parentId } : {}),
      }),
    onSuccess: (c) => {
      qc.setQueryData<CommentView[]>(['comments', postId], (cur) => [...(cur ?? []), c]);
      patchPost(qc, postId, (p) => ({ ...p, counts: { ...p.counts, comments: p.counts.comments + 1 } }));
      setBody('');
      onDone?.();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) send.mutate();
      }}
    >
      <label className="sr-only" htmlFor={`c-${postId}-${parentId ?? 'top'}`}>
        {parentId ? t('feed.replyLabel') : t('feed.commentLabel')}
      </label>
      <Textarea
        id={`c-${postId}-${parentId ?? 'top'}`}
        value={body}
        maxLength={1000}
        autoFocus={autoFocus}
        onChange={(e) => setBody(e.target.value)}
        placeholder={parentId ? t('feed.replyPlaceholder') : t('feed.commentPlaceholder')}
        className="min-h-[64px]"
      />
      <div className="flex justify-end gap-2">
        {onDone && (
          <Button size="sm" onClick={onDone}>
            {t('common.cancel')}
          </Button>
        )}
        <Button size="sm" type="submit" variant="primary" disabled={!body.trim()} loading={send.isPending}>
          {parentId ? t('feed.reply') : t('feed.comment')}
        </Button>
      </div>
    </form>
  );
}

function CommentItem({
  c,
  replies,
  postId,
  canReply,
}: {
  c: CommentView;
  replies: CommentView[];
  postId: string;
  canReply: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [replying, setReplying] = useState(false);
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/comments/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['comments', postId] });
      void qc.invalidateQueries({ queryKey: ['post', postId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const one = (x: CommentView) => (
    <div className="grid gap-1.5">
      <AuthorLine author={x.author} at={x.createdAt}>
        <ContentMenu
          targetType="comment"
          targetId={x.id}
          authorId={x.author.userId}
          authorName={x.author.name}
          isMine={x.isMine}
          onDelete={() => del.mutate(x.id)}
          deleting={del.isPending}
        />
      </AuthorLine>
      {x.removal && (
        <RemovalNotice targetType="comment" targetId={x.id} removal={x.removal} canAppeal={x.isMine} />
      )}
      <RichText text={x.body} className="pl-[52px] text-[15px]" />
    </div>
  );
  return (
    <li className="grid gap-2">
      {one(c)}
      {canReply && c.status === 'published' && (
        <div className="pl-[52px]">
          {replying ? (
            <CommentForm postId={postId} parentId={c.id} onDone={() => setReplying(false)} autoFocus />
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setReplying(true)}>
              <Reply className="size-4" aria-hidden /> {t('feed.reply')}
            </Button>
          )}
        </div>
      )}
      {replies.length > 0 && (
        <ul
          className="ml-[52px] grid gap-3 border-l-2 border-line pl-4"
          aria-label={t('feed.replies', { count: replies.length })}
        >
          {replies.map((r) => (
            <li key={r.id}>{one(r)}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function PostPage() {
  const { t } = useTranslation();
  const { postId = '' } = useParams();
  const canInteract = useCan('feed:interact');
  const qc = useQueryClient();
  const post = useQuery({
    queryKey: ['post', postId],
    queryFn: () => api.get<PostView>(`/posts/${postId}`),
    // The feed card the member tapped draws the post at once; comments load alongside.
    placeholderData: () =>
      findCached(
        qc,
        [['feed'], ['saved'], ['reels']],
        hasId<PostView>('id', postId, ['author', 'counts', 'status']),
      ),
  });
  const comments = useQuery({
    queryKey: ['comments', postId],
    queryFn: () => api.get<CommentView[]>(`/posts/${postId}/comments`),
    enabled: post.isSuccess,
  });
  const top = (comments.data ?? []).filter((c) => !c.parentId);
  const repliesOf = (id: string) => (comments.data ?? []).filter((c) => c.parentId === id);
  return (
    <div className="mx-auto grid w-full max-w-[680px] gap-4">
      <Link
        to="/home"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-ink hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> {t('feed.backToFeed')}
      </Link>
      <h1 className="sr-only">{t('feed.postTitle')}</h1>
      {post.isLoading && <PostSkeleton />}
      {post.isError && (
        <EmptyState icon={<MessageCircle className="size-6" />} title={t('feed.postGone')}>
          {t('feed.postGoneBody')}
        </EmptyState>
      )}
      {post.data && (
        <>
          <PostCard post={post.data} />
          <Card className="grid gap-4 p-4">
            <h2 className="font-semibold">{t('feed.commentsTitle', { count: post.data.counts.comments })}</h2>
            {canInteract && post.data.status === 'published' && <CommentForm postId={postId} />}
            {comments.data && !top.length && <p className="text-sm text-fg-2">{t('feed.noComments')}</p>}
            <ul className="grid gap-5">
              {top.map((c) => (
                <CommentItem
                  key={c.id}
                  c={c}
                  replies={repliesOf(c.id)}
                  postId={postId}
                  canReply={canInteract && post.data.status === 'published'}
                />
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
