import type {
  CandidateView,
  ClusterView,
  CredentialsAdminView,
  EmployerReviewView,
  EmployerView,
  IntrosView,
  MyCandidacyView,
  MyCredentialsView,
  NetworkAdminView,
  NetworkCollegeView,
  NetworkSearchView,
  NetworkSettingsView,
  PoolView,
  PostingView,
} from '@campuslink/shared';
import { api } from '../../lib/api';

/** Typed query options without `queryOptions` (keeps it out of a chunk shared with the boot path). */
const q = <T, K extends readonly unknown[]>(o: {
  queryKey: K;
  queryFn: (c: { signal: AbortSignal }) => Promise<T>;
}) => o;

/** The network's reads (prompt 2, G12), kept in the feature (the router does not prefetch them). */
export const networkMe = () =>
  q({
    queryKey: ['network', 'me'],
    queryFn: ({ signal }) => api.get<NetworkSettingsView>('/network/me', signal),
  });

export const networkSearch = (qs: string) =>
  q({
    queryKey: ['network', 'alumni', qs],
    queryFn: ({ signal }) => api.get<NetworkSearchView>(`/network/alumni${qs ? `?${qs}` : ''}`, signal),
  });

export const networkIntros = () =>
  q({
    queryKey: ['network', 'intros'],
    queryFn: ({ signal }) => api.get<IntrosView>('/network/intros', signal),
  });

export const myCandidacies = () =>
  q({
    queryKey: ['network', 'candidacies'],
    queryFn: ({ signal }) =>
      api.get<{ eligible: MyCandidacyView[]; shared: MyCandidacyView[] }>('/network/candidacies', signal),
  });

export const myCredentials = () =>
  q({
    queryKey: ['credentials'],
    queryFn: ({ signal }) => api.get<MyCredentialsView>('/credentials', signal),
  });

export type NetworkAdmin = NetworkAdminView & { paused: { userId: string; name: string }[] };
export const adminNetwork = () =>
  q({
    queryKey: ['admin-network'],
    queryFn: ({ signal }) => api.get<NetworkAdmin>('/admin/network', signal),
  });

export const adminCredentials = () =>
  q({
    queryKey: ['admin-credentials'],
    queryFn: ({ signal }) => api.get<CredentialsAdminView>('/admin/credentials', signal),
  });

// ── Employers ─────────────────────────────

export const employerAccount = () =>
  q({
    queryKey: ['employer'],
    queryFn: ({ signal }) => api.get<EmployerView>('/employer', signal),
  });

export const employerPostings = () =>
  q({
    queryKey: ['employer', 'postings'],
    queryFn: ({ signal }) => api.get<PostingView[]>('/employer/postings', signal),
  });

export const employerColleges = () =>
  q({
    queryKey: ['employer', 'colleges'],
    queryFn: ({ signal }) =>
      api.get<{ colleges: NetworkCollegeView[]; clusters: ClusterView[] }>('/employer/colleges', signal),
  });

export const employerPool = (qs: string) =>
  q({
    queryKey: ['employer', 'pool', qs],
    queryFn: ({ signal }) => api.get<PoolView>(`/employer/pool${qs ? `?${qs}` : ''}`, signal),
  });

export const employerCandidates = (postingId: string) =>
  q({
    queryKey: ['employer', 'candidates', postingId],
    queryFn: ({ signal }) =>
      api.get<{ items: CandidateView[]; withdrawn: number }>(
        `/employer/postings/${postingId}/candidates`,
        signal,
      ),
  });

export const platformEmployers = (status: string) =>
  q({
    queryKey: ['platform', 'employers', status],
    queryFn: ({ signal }) =>
      api.get<EmployerReviewView[]>(`/platform/employers${status ? `?status=${status}` : ''}`, signal),
  });

export const platformClusters = () =>
  q({
    queryKey: ['platform', 'clusters'],
    queryFn: ({ signal }) => api.get<ClusterView[]>('/platform/network/clusters', signal),
  });
