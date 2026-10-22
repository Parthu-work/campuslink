import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type {
  BookingView,
  CommentView,
  ConversationView,
  EventView,
  FeedEntry,
  JobView,
  MentorCard,
  MentorMatch,
  MessageView,
  MyProgressView,
  NotificationView,
  OneUsefulThingView,
  PostView,
  RemovalView,
  RadarView,
  RoadmapSummaryView,
  RoadmapView,
  StoryView,
} from '@campuslink/shared';
import { api, apiRequest } from './api';

/**
 * One definition per server read: screens read through these and route loaders prefetch the same
 * keys, so code and data load in parallel (audit TR-2, PF-2) and invalidations keep matching.
 */

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
