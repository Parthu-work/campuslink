import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FollowState } from '@campuslink/shared';
import i18n from '../i18n/core';
import { api, ApiError } from './api';
import { toast } from './toast';

/**
 * Follow or unfollow a member, topic or source, optimistically (the follows list updates at once);
 * a failure puts it back and says why.
 */
export function useFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, on }: { type: 'user' | 'topic' | 'source'; id: string; on: boolean }) =>
      on
        ? api.post<FollowState>('/follows', { targetType: type, targetId: id })
        : api.delete<FollowState>(`/follows/${type}/${id}`),
    onMutate: ({ type, id, on }) => {
      const prev = qc.getQueryData<FollowState>(['follows']);
      if (prev) {
        const k = type === 'user' ? 'users' : type === 'topic' ? 'topics' : 'sources';
        const list = prev[k] as string[];
        qc.setQueryData(['follows'], { ...prev, [k]: on ? [...list, id] : list.filter((x) => x !== id) });
      }
      return { prev };
    },
    onError: (e, _v, c) => {
      if (c?.prev) qc.setQueryData(['follows'], c.prev);
      toast.error(e instanceof ApiError ? e.message : i18n.t('errors.generic'));
    },
    onSuccess: (state) => {
      qc.setQueryData(['follows'], state);
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

/**
 * Follow or stop following a person, saying so with Undo (prompt 3, U10). Topic and source chips
 * use `useFollow` alone: the chip is its own undo, and a toast per chip would be noise.
 */
export function followPerson(follow: ReturnType<typeof useFollow>, id: string, name: string, on: boolean) {
  follow.mutate(
    { type: 'user', id, on },
    {
      onSuccess: () =>
        toast.undo(
          i18n.t(on ? 'feed.followedToast' : 'feed.unfollowedToast', { name }),
          i18n.t('ui.undo'),
          () => follow.mutate({ type: 'user', id, on: !on }),
        ),
    },
  );
}
