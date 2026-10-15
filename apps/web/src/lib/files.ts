import { useQuery } from '@tanstack/react-query';
import { apiBlob } from './api';

/**
 * Files need the bearer token, so <img src> cannot fetch them directly. This hook downloads the
 * blob once (cached by React Query) and exposes an object URL. Signed short-lived URLs: Phase 8.
 */
export function useFileUrl(fileId: string | null | undefined): string | undefined {
  const { data } = useQuery({
    queryKey: ['file', fileId],
    queryFn: async () => URL.createObjectURL(await apiBlob(`/files/${fileId}`)),
    enabled: !!fileId,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
  return data;
}
