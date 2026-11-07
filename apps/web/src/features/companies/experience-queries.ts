import { queryOptions } from '@tanstack/react-query';
import type { ExperienceView, MyExperiencesView } from '@campuslink/shared';
import { api } from '../../lib/api';

/** The Interview Experience Bank's reads (prompt 2, G10). */
export const myExperiences = () =>
  queryOptions({
    queryKey: ['experiences', 'mine'],
    queryFn: ({ signal }) => api.get<MyExperiencesView>('/me/experiences', signal),
  });

export const experienceQueue = (status: 'pending' | 'published' | 'rejected') =>
  queryOptions({
    queryKey: ['experiences', 'queue', status],
    queryFn: ({ signal }) => api.get<ExperienceView[]>(`/admin/experiences?status=${status}`, signal),
  });
