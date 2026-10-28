import { useRef, type SyntheticEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SignedFileView } from '@campuslink/shared';
import { api, apiBlob } from './api';

/**
 * Files need the bearer token, so <img src> cannot fetch them directly. This hook downloads the
 * blob once (cached by React Query) and exposes an object URL. Videos stream instead (below).
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

/**
 * A video that streams (audit PW-6, owner decision Q9): the element reads a five-minute signed
 * link with range requests, so playback starts at once instead of after the whole file has
 * downloaded. When the link lapses mid-play the element errors; a fresh link is fetched and
 * playback resumes from the same moment (at most once every 30 s, so a missing file never loops).
 */
export function useStreamedFile(fileId: string) {
  const qc = useQueryClient();
  const key = ['file-signed', fileId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.get<SignedFileView>(`/files/${fileId}/signed`, signal),
    staleTime: 4 * 60_000,
    gcTime: 4 * 60_000,
  });
  const resume = useRef<{ at: number; play: boolean } | null>(null);
  const renewed = useRef(0);
  return {
    src: data?.url,
    onError: (e: SyntheticEvent<HTMLVideoElement>) => {
      if (Date.now() - renewed.current < 30_000) return;
      renewed.current = Date.now();
      resume.current = { at: e.currentTarget.currentTime, play: !e.currentTarget.paused };
      void qc.invalidateQueries({ queryKey: key });
    },
    onLoadedMetadata: (e: SyntheticEvent<HTMLVideoElement>) => {
      const r = resume.current;
      if (!r) return;
      resume.current = null;
      e.currentTarget.currentTime = r.at;
      if (r.play) void e.currentTarget.play().catch(() => undefined);
    },
  };
}
