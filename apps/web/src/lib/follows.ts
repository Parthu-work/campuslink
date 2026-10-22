import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FollowState } from '@campuslink/shared';
import { api } from './api';

/** Follow or unfollow a member, topic or source, optimistically (the follows list updates at once). */
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
    onError: (_e, _v, c) => c?.prev && qc.setQueryData(['follows'], c.prev),
    onSuccess: (state) => {
      qc.setQueryData(['follows'], state);
      void qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
