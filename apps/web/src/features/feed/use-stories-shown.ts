import { useQuery } from '@tanstack/react-query';
import { stories } from '../../lib/queries';
import { useTenant } from '../../lib/tenant-context';

/** At least `min` active stories (Home: three), or nothing. */
export function useStoriesShown(min: number) {
  const tenant = useTenant();
  const enabled = tenant.features?.stories !== false;
  const q = useQuery({ ...stories(), enabled });
  return enabled && (q.data?.length ?? 0) >= min;
}
