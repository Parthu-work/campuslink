import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type {
  AdminOverviewView,
  AiUsageView,
  AnalyticsView,
  StudyInsightsView,
  BookingView,
  CommentView,
  ConversationView,
  EventView,
  FeedEntry,
  JobView,
  MeResponse,
  MentorCard,
  MentorMatch,
  MessageView,
  MyProgressView,
  NotificationView,
  OneUsefulThingView,
  PostView,
  PublicTenant,
  RemovalView,
  RadarView,
  RoadmapSummaryView,
  RoadmapView,
  StoryView,
  AiIndexView,
  ChatSessionDetail,
  ChatSessionView,
  FlashcardDeckView,
  AiSettingsView,
  AiStatusView,
  SubjectView,
  SyllabusView,
  MaterialDetailView,
  MaterialView,
  SignedFileView,
  StudySearchHit,
  InviteView,
  JoinCodeInfo,
  JoinCodeView,
  OnboardingRecordView,
  OnboardingProgressRow,
  MentorReviewView,
  MentorMatch as MentorMatchView,
} from '@campuslink/shared';
import { api, ApiError, apiRequest } from './api';

/**
 * One definition per server read: screens read through these and route loaders prefetch the same
 * keys, so code and data load in parallel (audit TR-2, PF-2) and invalidations keep matching.
 */

/** The college this host belongs to (public; read before anything else). */
export const tenant = () =>
  queryOptions({
    queryKey: ['tenant'],
    queryFn: ({ signal }) => api.get<PublicTenant>('/tenant', signal),
    staleTime: 5 * 60_000,
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  });

/** The signed-in member (roles, permissions, verification). */
export const me = () =>
  queryOptions({
    queryKey: ['me'],
    queryFn: ({ signal }) => api.get<MeResponse>('/me', signal),
    staleTime: 60_000,
  });

export type FeedRow = FeedEntry;
export interface FeedPage {
  rows: FeedRow[];
  next: string | null;
}

/** A feed-shaped list (`/feed`, saved posts, a profile's posts): one page per cursor. */
export const feedList = (queryKey: readonly unknown[], path: string, posts = false) =>
  infiniteQueryOptions({
    queryKey,
    initialPageParam: '',
    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      const sep = path.includes('?') ? '&' : '?';
      const r = await apiRequest<FeedEntry[] | PostView[]>(
        `${path}${pageParam ? `${sep}cursor=${encodeURIComponent(pageParam)}` : ''}`,
      );
      const rows: FeedRow[] = posts
        ? (r.data as PostView[]).map((post) => ({ type: 'post', post }))
        : (r.data as FeedEntry[]);
      return { rows, next: r.meta?.nextCursor ?? null };
    },
    getNextPageParam: (last) => last.next ?? undefined,
    // The feed refreshes when the member comes back to the app (audit PF-4).
    refetchOnWindowFocus: true,
  });

export type FeedTab = 'for_you' | 'following';
export const homeFeed = (tab: FeedTab) => feedList(['feed', tab], `/feed?tab=${tab}&limit=15`);

export const oneUsefulThing = () =>
  queryOptions({
    queryKey: ['out'],
    queryFn: () => api.get<OneUsefulThingView | null>('/feed/one-useful-thing'),
    staleTime: 10 * 60_000,
  });

export const stories = () =>
  queryOptions({
    queryKey: ['stories'],
    queryFn: () => api.get<StoryView[]>('/stories'),
    refetchInterval: 5 * 60_000,
  });

export const post = (id: string) =>
  queryOptions({ queryKey: ['post', id], queryFn: () => api.get<PostView>(`/posts/${id}`) });

export const comments = (postId: string) =>
  queryOptions({
    queryKey: ['comments', postId],
    queryFn: () => api.get<CommentView[]>(`/posts/${postId}/comments`),
  });

export const upcomingBookings = () =>
  queryOptions({
    queryKey: ['bookings', 'upcoming'],
    queryFn: () => api.get<BookingView[]>('/bookings?when=upcoming'),
    refetchOnWindowFocus: true,
  });

export const bookings = (when: 'upcoming' | 'past') =>
  queryOptions({
    queryKey: ['bookings', when],
    queryFn: () => api.get<BookingView[]>(`/bookings?when=${when}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

export const JOB_FILTER_KEYS = [
  'q',
  'skills',
  'branch',
  'level',
  'mode',
  'type',
  'location',
  'fresher',
  'alumni',
] as const;

/** The API query string for the Jobs list, from the page's search params. */
export const jobFilterQuery = (params: URLSearchParams) =>
  new URLSearchParams(
    JOB_FILTER_KEYS.flatMap((k) => (params.get(k)?.trim() ? [[k, (params.get(k) as string).trim()]] : [])),
  ).toString();

export const jobsRadar = () =>
  queryOptions({ queryKey: ['jobs', 'radar'], queryFn: () => api.get<RadarView>('/jobs/radar') });

export const jobsList = (qs: string) =>
  infiniteQueryOptions({
    queryKey: ['jobs', 'list', qs],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<JobView[]>(`/jobs?${qs}${pageParam ? `${qs ? '&' : ''}cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });

export type JobDetail = JobView & { removal: RemovalView | null };
export const job = (id: string) =>
  queryOptions({ queryKey: ['job', id], queryFn: () => api.get<JobDetail>(`/jobs/${id}`) });

export const mentorMatch = () =>
  queryOptions({ queryKey: ['match'], queryFn: () => api.get<MentorMatch[]>('/mentors/match') });

export const mentor = (userId: string) =>
  queryOptions({
    queryKey: ['mentor', userId],
    queryFn: () => api.get<MentorCard & { timezone: string }>(`/mentors/${userId}`),
    enabled: /^[a-f0-9]{24}$/.test(userId),
    retry: false,
  });

/** The API query string for the Roadmaps list, from the page's search params. */
export const roadmapFilterQuery = (params: URLSearchParams) =>
  new URLSearchParams(
    ['q', 'category', 'branch'].flatMap((k) =>
      params.get(k)?.trim() ? [[k, (params.get(k) as string).trim()]] : [],
    ),
  ).toString();

export const roadmapsList = (qs: string) =>
  queryOptions({
    queryKey: ['roadmaps', 'list', qs],
    queryFn: () => api.get<RoadmapSummaryView[]>(`/roadmaps${qs ? `?${qs}` : ''}`),
  });

/** Roadmaps the member follows, shown above the list (members who can track progress). */
export const followedRoadmaps = () =>
  queryOptions({
    queryKey: ['roadmaps', 'following'],
    queryFn: () => api.get<RoadmapSummaryView[]>('/roadmaps?mine=following'),
  });

/** The member's own drafts, shown above the list (authors). */
export const roadmapDrafts = () =>
  queryOptions({
    queryKey: ['roadmaps', 'drafts'],
    queryFn: () => api.get<RoadmapSummaryView[]>('/roadmaps?status=draft'),
  });

export const roadmap = (slug: string) =>
  queryOptions({ queryKey: ['roadmap', slug], queryFn: () => api.get<RoadmapView>(`/roadmaps/${slug}`) });

export const events = (when: string, kind: string) =>
  queryOptions({
    queryKey: ['events', when, kind],
    queryFn: () => api.get<EventView[]>(`/events?when=${when}${kind ? `&kind=${kind}` : ''}`),
  });

export const event = (id: string) =>
  queryOptions({ queryKey: ['event', id], queryFn: () => api.get<EventView>(`/events/${id}`) });

export const notifications = () =>
  queryOptions({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationView[]>('/notifications'),
    refetchOnWindowFocus: true,
  });

export const conversations = () =>
  queryOptions({
    queryKey: ['conversations'],
    queryFn: () => api.get<ConversationView[]>('/conversations'),
    refetchOnWindowFocus: true,
  });

export type MessagePage = { data: MessageView[]; meta?: { nextCursor?: string | null } };

export const conversation = (id: string) =>
  queryOptions({
    queryKey: ['conversation', id],
    queryFn: () => api.get<ConversationView>(`/conversations/${id}`),
    enabled: /^[a-f0-9]{24}$/.test(id),
    retry: false,
  });

export const progress = () =>
  queryOptions({ queryKey: ['progress'], queryFn: () => api.get<MyProgressView>('/me/progress') });

// ── Study ─────────────────────────────
export type SubjectScope = 'mine' | 'all';
export const subjects = (scope: SubjectScope, q = '') =>
  queryOptions({
    queryKey: ['subjects', scope, q],
    queryFn: ({ signal }) =>
      api.get<SubjectView[]>(
        `/study/subjects?scope=${scope}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        signal,
      ),
  });

export const subject = (id: string) =>
  queryOptions({
    queryKey: ['subject', id],
    queryFn: ({ signal }) => api.get<SubjectView>(`/study/subjects/${id}`, signal),
    enabled: /^[a-f0-9]{24}$/.test(id),
    retry: false,
  });

export const syllabus = (id: string) =>
  queryOptions({
    queryKey: ['syllabus', id],
    queryFn: ({ signal }) => api.get<SyllabusView>(`/study/subjects/${id}/syllabus`, signal),
    enabled: /^[a-f0-9]{24}$/.test(id),
    retry: false,
  });

/** Whether AI answers are on for this college (members see the reason, never the settings). */
export const aiStatus = () =>
  queryOptions({
    queryKey: ['ai-status'],
    queryFn: ({ signal }) => api.get<AiStatusView>('/study/ai-status', signal),
    staleTime: 5 * 60_000,
  });

export const aiSettings = () =>
  queryOptions({
    queryKey: ['ai-settings'],
    queryFn: ({ signal }) => api.get<AiSettingsView>('/admin/ai', signal),
  });

/** My conversations with the study assistant (newest first). */
export const chatSessions = () =>
  queryOptions({
    queryKey: ['chat-sessions'],
    queryFn: ({ signal }) => api.get<ChatSessionView[]>('/study/chat/sessions', signal),
  });

export const chatSession = (id: string) =>
  queryOptions({
    queryKey: ['chat-session', id],
    queryFn: ({ signal }) => api.get<ChatSessionDetail>(`/study/chat/sessions/${id}`, signal),
    enabled: /^[a-f0-9]{24}$/.test(id),
    retry: false,
  });

export const studyDecks = () =>
  queryOptions({
    queryKey: ['study-decks'],
    queryFn: ({ signal }) => api.get<FlashcardDeckView[]>('/study/decks', signal),
  });

/** The semantic index's back-fill progress; polls while vectors are being filled in. */
export const aiIndex = () =>
  queryOptions({
    queryKey: ['ai-index'],
    queryFn: ({ signal }) => api.get<AiIndexView>('/admin/ai/index', signal),
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && (d.running || (d.semantic && d.pending > 0)) ? 3000 : false;
    },
  });

/** Admin › Overview: what is waiting for this member (only the queues they may act on). */
export const adminOverview = () =>
  queryOptions({
    queryKey: ['admin-overview'],
    queryFn: ({ signal }) => api.get<AdminOverviewView>('/admin/overview', signal),
  });

/** The analytics screen's first view (also what its route prefetches). */
export const ANALYTICS_DEFAULTS = { months: 6, branch: '', gradYear: '' };

/** Admin › Analytics: aggregate counts for a period and an optional branch and batch. */
export const analytics = (f: { months: number; branch: string; gradYear: string }) => {
  const qs = new URLSearchParams({
    months: String(f.months),
    ...(f.branch ? { branch: f.branch } : {}),
    ...(f.gradYear ? { gradYear: f.gradYear } : {}),
  }).toString();
  return queryOptions({
    queryKey: ['analytics', qs],
    queryFn: ({ signal }) => api.get<AnalyticsView>(`/admin/analytics?${qs}`, signal),
    placeholderData: (prev) => prev,
  });
};

/** Admin › AI assistant › Usage: college totals for the last `days` days. */
export const aiUsage = (days: number) =>
  queryOptions({
    queryKey: ['ai-usage', days],
    queryFn: ({ signal }) => api.get<AiUsageView>(`/admin/ai/usage?days=${days}`, signal),
    placeholderData: (prev) => prev,
  });

/** A subject's aggregate insights (owners and admins). */
export const studyInsights = (subjectId: string, days: number) =>
  queryOptions({
    queryKey: ['study-insights', subjectId, days],
    queryFn: ({ signal }) =>
      api.get<StudyInsightsView>(`/study/subjects/${subjectId}/insights?days=${days}`, signal),
    enabled: /^[a-f0-9]{24}$/.test(subjectId),
    placeholderData: (prev) => prev,
    retry: false,
  });

export interface MaterialFilter {
  category?: string;
  unitId?: string;
  topicId?: string;
  status?: 'published' | 'in_review' | 'all';
}
export const materials = (subjectId: string, f: MaterialFilter = {}) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => !!v) as [string, string][]).toString();
  return queryOptions({
    queryKey: ['materials', subjectId, f],
    queryFn: ({ signal }) =>
      api.get<MaterialView[]>(`/study/subjects/${subjectId}/materials${qs ? `?${qs}` : ''}`, signal),
    enabled: /^[a-f0-9]{24}$/.test(subjectId),
  });
};

export const material = (id: string) =>
  queryOptions({
    queryKey: ['material', id],
    queryFn: ({ signal }) => api.get<MaterialDetailView>(`/study/materials/${id}`, signal),
    enabled: /^[a-f0-9]{24}$/.test(id),
    retry: false,
  });

/** A signed link to a material's file; refreshed before its five minutes run out. */
export const materialFile = (id: string) =>
  queryOptions({
    queryKey: ['material-file', id],
    queryFn: ({ signal }) => api.get<SignedFileView>(`/study/materials/${id}/file`, signal),
    staleTime: 4 * 60_000,
    gcTime: 4 * 60_000,
  });

export const studySearch = (q: string, subjectId?: string) =>
  queryOptions({
    queryKey: ['study-search', q, subjectId ?? ''],
    queryFn: ({ signal }) =>
      api.get<StudySearchHit[]>(
        `/study/search?q=${encodeURIComponent(q)}${subjectId ? `&subjectId=${subjectId}` : ''}`,
        signal,
      ),
    enabled: q.trim().length >= 2,
  });

// ── Onboarding (B4) ─────────────────────────────
/** A personal invite link; a 404 (used or expired) is an answer, not a failure to retry. */
export const invite = (token: string) =>
  queryOptions({
    queryKey: ['invite', token],
    queryFn: ({ signal }) => api.get<InviteView>(`/invite/${token}`, signal),
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  });

export const joinCode = (code: string) =>
  queryOptions({
    queryKey: ['join-code', code],
    queryFn: ({ signal }) => api.get<JoinCodeInfo>(`/join/${encodeURIComponent(code)}`, signal),
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  });

export const onboardingRecords = (qs: string) =>
  infiniteQueryOptions({
    queryKey: ['onboarding-records', qs],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<OnboardingRecordView[]>(
        `/admin/onboarding/records?${qs}${pageParam ? `${qs ? '&' : ''}cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });

export const onboardingProgress = () =>
  queryOptions({
    queryKey: ['onboarding-progress'],
    queryFn: ({ signal }) => api.get<OnboardingProgressRow[]>('/admin/onboarding', signal),
  });

export const joinCodes = () =>
  queryOptions({
    queryKey: ['join-codes'],
    queryFn: ({ signal }) => api.get<JoinCodeView[]>('/admin/join-codes', signal),
  });

export type JoinCodePoster = JoinCodeView & { college: string; url: string; qrSvg: string; app: string };
export const joinCodePoster = (id: string) =>
  queryOptions({
    queryKey: ['join-code-poster', id],
    queryFn: ({ signal }) => api.get<JoinCodePoster>(`/admin/join-codes/${id}/poster`, signal),
  });

// ── Mentorship loop (B5) ─────────────────────────────
export const mentorReviews = (mentorId: string) =>
  infiniteQueryOptions({
    queryKey: ['mentor-reviews', mentorId],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<MentorReviewView[]>(
        `/mentors/${mentorId}/reviews${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });

/** Three mentors likely to reply, for a request waiting two days. */
export const requestAlternatives = (requestId: string) =>
  queryOptions({
    queryKey: ['request-alternatives', requestId],
    queryFn: ({ signal }) =>
      api.get<MentorMatchView[]>(`/mentorship/requests/${requestId}/alternatives`, signal),
  });
