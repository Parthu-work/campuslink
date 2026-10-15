import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useCan } from './me';

/** Navigation badges. Live updates invalidate these (see use-realtime-bridge). */
export function useUnreadNotifications(enabled = true) {
  return (
    useQuery({
      queryKey: ['notifications-unread'],
      queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
      enabled,
      refetchInterval: 120_000,
    }).data?.count ?? 0
  );
}
export function useUnreadMessages(enabled = true) {
  const can = useCan('messages:send');
  return (
    useQuery({
      queryKey: ['unread-messages'],
      queryFn: () => api.get<{ total: number }>('/conversations/unread'),
      enabled: enabled && can,
      refetchInterval: 120_000,
    }).data?.total ?? 0
  );
}
