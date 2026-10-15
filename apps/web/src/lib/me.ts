import { useQuery } from '@tanstack/react-query';
import type { MeResponse, Permission } from '@campuslink/shared';
import { api } from './api';
import { useSession } from './session';

export function useMe() {
  const status = useSession((s) => s.status);
  return useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => api.get<MeResponse>('/me', signal),
    enabled: status === 'signed-in',
    staleTime: 60_000,
  });
}

/** UX-only mirror of server permissions. The API enforces every check. */
export function useCan(permission: Permission): boolean {
  const { data } = useMe();
  return !!data?.permissions.includes(permission);
}
