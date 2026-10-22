import { useQuery } from '@tanstack/react-query';
import type { Permission } from '@campuslink/shared';
import { me as meQuery } from './queries';
import { useSession } from './session';

export function useMe() {
  const status = useSession((s) => s.status);
  return useQuery({ ...meQuery(), enabled: status === 'signed-in' });
}

/** UX-only mirror of server permissions. The API enforces every check. */
export function useCan(permission: Permission): boolean {
  const { data } = useMe();
  return !!data?.permissions.includes(permission);
}
