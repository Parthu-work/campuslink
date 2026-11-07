import { queryOptions } from '@tanstack/react-query';
import type { CopilotHomeView, CopilotSessionDetail } from '@campuslink/shared';
import { api } from '../../lib/api';

/** The Career Copilot's reads (prompt 2, G11). */
export const copilotHome = () =>
  queryOptions({
    queryKey: ['copilot'],
    queryFn: ({ signal }) => api.get<CopilotHomeView>('/copilot', signal),
  });

export const copilotSession = (id: string) =>
  queryOptions({
    queryKey: ['copilot', 'session', id],
    queryFn: ({ signal }) => api.get<CopilotSessionDetail>(`/copilot/sessions/${id}`, signal),
  });
