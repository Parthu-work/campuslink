import { queryOptions } from '@tanstack/react-query';
import type { CompaniesView, CompanyGraphView } from '@campuslink/shared';
import { api } from '../../lib/api';

/** Company pages (prompt 2, G10); lib/queries.ts re-exports them for the router's prefetch. */
export const companies = (search = '') =>
  queryOptions({
    queryKey: ['companies', search],
    queryFn: ({ signal }) =>
      api.get<CompaniesView>(`/companies${search ? `?q=${encodeURIComponent(search)}` : ''}`, signal),
  });

export const company = (key: string) =>
  queryOptions({
    queryKey: ['companies', 'page', key],
    queryFn: ({ signal }) => api.get<CompanyGraphView>(`/companies/${encodeURIComponent(key)}`, signal),
  });
