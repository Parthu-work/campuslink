import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { PostView, Reaction } from '@campuslink/shared';
import { api, ApiError } from './api';

/** Query keys that can hold posts (feed pages, lists, single posts, One Useful Thing, search). */
const POST_KEYS = [['feed'], ['posts'], ['post'], ['out'], ['search']] as const;

const isPost = (v: unknown, id: string): v is PostView =>
  !!v && typeof v === 'object' && (v as PostView).id === id && 'myReaction' in v && 'counts' in v;

/** Returns a copy of `value` with every copy of post `id` replaced by `fn(post)`. */
function mapPosts(value: unknown, id: string, fn: (p: PostView) => PostView): unknown {
  if (isPost(value, id)) return fn(value);
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((v) => {
      const n = mapPosts(v, id, fn);
      if (n !== v) changed = true;
      return n;
    });
    return changed ? next : value;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const n = mapPosts(v, id, fn);
      if (n !== v) changed = true;
      next[k] = n;
    }
    return changed ? next : value;
  }
  return value;
}

/** Optimistically patches a post everywhere it is cached; returns a rollback. */
export function patchPost(qc: QueryClient, id: string, fn: (p: PostView) => PostView) {
  const snapshots = POST_KEYS.flatMap((key) => qc.getQueriesData({ queryKey: key }));
  for (const key of POST_KEYS) qc.setQueriesData({ queryKey: key }, (old: unknown) => mapPosts(old, id, fn));
  return () => {
    for (const [key, data] of snapshots) qc.setQueryData(key, data);
  };
}

export function withReaction(p: PostView, reaction: Reaction | null): PostView {
  const counts = { ...p.counts.reactions };
  if (p.myReaction) counts[p.myReaction] = Math.max(0, counts[p.myReaction] - 1);
  if (reaction) counts[reaction] += 1;
  return { ...p, myReaction: reaction, counts: { ...p.counts, reactions: counts } };
}

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Reactions and saves update instantly and roll back if the API refuses. */
export function usePostActions(post: PostView) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const react = useMutation({
    mutationFn: (reaction: Reaction | null) =>
      api.post<PostView>(`/posts/${post.id}/reactions`, { reaction }),
    onMutate: (reaction) => ({ rollback: patchPost(qc, post.id, (p) => withReaction(p, reaction)) }),
    onError: (e, _v, c) => {
      c?.rollback();
      toast.error(errorText(e, t('errors.generic')));
    },
    onSuccess: (fresh) => patchPost(qc, post.id, () => fresh),
  });
  const save = useMutation({
    mutationFn: (on: boolean) =>
      on ? api.post(`/posts/${post.id}/save`, {}) : api.delete(`/posts/${post.id}/save`),
    onMutate: (on) => ({
      rollback: patchPost(qc, post.id, (p) => ({
        ...p,
        saved: on,
        counts: { ...p.counts, saves: Math.max(0, p.counts.saves + (on ? 1 : -1)) },
      })),
    }),
    onError: (e, _v, c) => {
      c?.rollback();
      toast.error(errorText(e, t('errors.generic')));
    },
    onSuccess: (_d, on) => {
      toast.success(on ? t('feed.savedToast') : t('feed.unsavedToast'));
      void qc.invalidateQueries({ queryKey: ['posts', 'saved'] });
    },
  });
  const share = useMutation({
    mutationFn: async () => {
      const url = `${location.origin}/posts/${post.id}`;
      const shareData = { title: post.author.name, url };
      if (navigator.share && navigator.canShare?.(shareData)) await navigator.share(shareData);
      else await navigator.clipboard.writeText(url);
      await api.post(`/posts/${post.id}/share`, {});
      return !!navigator.share;
    },
    onSuccess: (native) => {
      if (!native) toast.success(t('feed.linkCopied'));
      patchPost(qc, post.id, (p) => ({ ...p, counts: { ...p.counts, shares: p.counts.shares + 1 } }));
    },
    onError: (e) => {
      if ((e as Error).name !== 'AbortError') toast.error(errorText(e, t('errors.generic')));
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/posts/${post.id}`),
    onSuccess: () => {
      toast.success(t('feed.deleted'));
      void qc.invalidateQueries({ queryKey: ['feed'] });
      void qc.invalidateQueries({ queryKey: ['posts'] });
      qc.removeQueries({ queryKey: ['post', post.id] });
    },
    onError: (e) => toast.error(errorText(e, t('errors.generic'))),
  });
  return { react, save, share, remove };
}

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
