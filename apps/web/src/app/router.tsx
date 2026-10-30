import type { ComponentType } from 'react';
import {
  createBrowserRouter,
  createPath,
  type Path,
  Link,
  Navigate,
  type LoaderFunctionArgs,
  type Params,
  type RouteObject,
} from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { useTranslation } from '../i18n/react';
import { Compass } from 'lucide-react';
import {
  ADMIN_PERMISSIONS,
  currentGradYear,
  type Feature,
  type Permission,
  type PublicTenant,
} from '@campuslink/shared';
import { useTenant } from '../lib/tenant-context';
import { importWithRetry, setPendingTargetResolver } from '../lib/chunk-reload';
import { registerPreloadRoutes, registerRouteTables } from '../lib/preload';
import { registerRouterState } from '../lib/router-state';
import { animateScreens } from '../lib/transitions';
import { queryClient as qc } from '../lib/query-client';
import * as q from '../lib/queries';
import { AppShell } from '../components/layout/app-shell';
import { RouteError } from '../components/layout/route-error';
import { PageSkeleton } from '../components/layout/skeletons';
import { buttonVariants } from '../components/ui/button-variants';
import { EmptyState } from '../components/ui/misc';
import { PublicOnly, RequireAuth, RequirePermission, Splash } from './guards';

/**
 * Route-level code splitting through React Router's `lazy`: the router loads a screen's code
 * before it commits the navigation, so the current screen stays on screen (with the top progress
 * bar) instead of being replaced by a spinner. Only the public pages are on the first-load path.
 */
const load = {
  signIn: () => import('../features/auth/sign-in'),
  signUp: () => import('../features/auth/sign-up'),
  emailLinks: () => import('../features/auth/email-links'),
  join: () => import('../features/join/join'),
  home: () => import('../features/home/home'),
  settings: () => import('../features/settings/settings'),
  dataSettings: () => import('../features/settings/data-settings'),
  notificationSettings: () => import('../features/settings/notification-settings'),
  admin: () => import('../features/admin/admin'),
  adminOverview: () => import('../features/admin/admin-overview'),
  imports: () => import('../features/admin/imports'),
  onboardingAdmin: () => import('../features/admin/onboarding-admin'),
  listAdmin: () => import('../features/admin/list-admin'),
  mentorshipAdmin: () => import('../features/admin/mentorship-admin'),
  analyticsAdmin: () => import('../features/admin/analytics-admin'),
  jobSourcesAdmin: () => import('../features/admin/job-sources-admin'),
  moderationAdmin: () => import('../features/admin/moderation-admin'),
  sourcesAdmin: () => import('../features/admin/sources-admin'),
  aiAdmin: () => import('../features/admin/ai-admin'),
  study: () => import('../features/study/study'),
  subject: () => import('../features/study/subject-page'),
  material: () => import('../features/study/material-page'),
  chat: () => import('../features/study/chat/chat-page'),
  insights: () => import('../features/study/insights-page'),
  directory: () => import('../features/people/directory'),
  landing: () => import('../features/landing/landing'),
  profileView: () => import('../features/people/profile-view'),
  profileEdit: () => import('../features/profile/profile-edit'),
  verify: () => import('../features/verify/verify'),
  mentors: () => import('../features/mentors/mentors'),
  mentorPage: () => import('../features/mentors/mentor-page'),
  requests: () => import('../features/mentorship/requests'),
  sessions: () => import('../features/sessions/sessions'),
  messages: () => import('../features/messages/messages'),
  mentorDashboard: () => import('../features/mentor/mentor-dashboard'),
  notifications: () => import('../features/notifications/notifications'),
  postPage: () => import('../features/feed/post-page'),
  collections: () => import('../features/feed/collections'),
  questions: () => import('../features/qa/questions'),
  galaxy: () => import('../features/roadmaps/galaxy'),
  roadmap: () => import('../features/roadmaps/roadmap-page'),
  roadmapHistory: () => import('../features/roadmaps/history'),
  roadmapEditor: () => import('../features/roadmaps/editor'),
  roadmapReview: () => import('../features/roadmaps/review'),
  progress: () => import('../features/progress/progress-page'),
  leaderboard: () => import('../features/progress/leaderboard'),
  rewards: () => import('../features/progress/rewards'),
  events: () => import('../features/events/events'),
  eventPage: () => import('../features/events/event-page'),
  jobs: () => import('../features/jobs/radar'),
  jobPage: () => import('../features/jobs/job-page'),
  tracker: () => import('../features/jobs/tracker'),
  postJob: () => import('../features/jobs/post-job'),
  referrals: () => import('../features/referrals/referrals'),
  placements: () => import('../features/placements/placements'),
  drivePage: () => import('../features/placements/drive-page'),
  placementsAdmin: () => import('../features/admin/placements-admin'),
  driveEditor: () => import('../features/admin/drive-editor'),
  driveManage: () => import('../features/admin/drive-manage'),
  outcomes: () => import('../features/outcomes/outcomes'),
  reports: () => import('../features/reports/reports'),
  platform: () => import('../features/platform/platform'),
};

type Gate = Permission | readonly Permission[] | { permission: Permission; feature: Feature };
/** A screen of a feature the college can switch off (Admin › Features). */
const inFeature = (feature: Feature, permission: Permission): Gate => ({ permission, feature });
type Place = { path: string } | { index: true };

/** A screen's first data, started by the route loader in parallel with its code (audit TR-2). */
type Data = (params: Params, url: URL) => Promise<unknown>[];
/** Past this, the screen renders with its own loading state rather than holding the old one. */
const LOADER_WAIT_MS = 1500;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isId = (v: string | undefined): v is string => !!v && /^[a-f0-9]{24}$/.test(v);
/** Reports keep batch and programme in the URL; the loader asks for the same query the screen does. */
const reportQs = (url: URL) => {
  const g = Number(url.searchParams.get('gradYear')) || currentGradYear();
  const b = url.searchParams.get('branch');
  return new URLSearchParams({ gradYear: String(g), ...(b ? { branch: b } : {}) }).toString();
};

/**
 * Loaders never fail the navigation: a failed read shows the screen's own error state. They wait
 * for data (so the current screen stays put, with the progress bar) for at most LOADER_WAIT_MS.
 */
const loaderFor =
  (data: Data) =>
  async ({ params, request }: LoaderFunctionArgs) => {
    await Promise.race([Promise.allSettled(data(params, new URL(request.url))), wait(LOADER_WAIT_MS)]);
    return null;
  };

/**
 * Loads a screen's module (with stale-chunk recovery) and wraps it in its permission gate. A failed
 * load resolves to the error screen rather than rejecting: React Router keeps a rejected `lazy` and
 * would then render an empty content area instead of the error.
 */
function lazyScreen<M>(importer: () => Promise<M>, name: keyof M & string, gate?: Gate) {
  return async () => {
    let mod: M;
    try {
      mod = await importWithRetry(importer);
    } catch (error) {
      return { element: <RouteError error={error} /> };
    }
    const Screen = mod[name] as unknown as ComponentType;
    const feature = gate && typeof gate === 'object' && 'feature' in gate ? gate.feature : undefined;
    const permission = feature ? (gate as { permission: Permission }).permission : (gate as Permission);
    return {
      element: gate ? (
        <RequirePermission
          permission={typeof permission === 'string' ? permission : [...(permission as Permission[])]}
          feature={feature}
        >
          <Screen />
        </RequirePermission>
      ) : (
        <Screen />
      ),
    };
  };
}

/** A lazily loaded screen, optionally behind a permission (UX only; the API enforces it). */
function screen<M>(
  importer: () => Promise<M>,
  name: keyof M & string,
  gate: Gate | undefined,
  place: Place,
  data?: Data,
) {
  const route = {
    errorElement: <RouteError />,
    lazy: lazyScreen(importer, name, gate),
    // Intent prefetch (lib/preload.ts) warms the code and, through `prefetch`, the data too.
    handle: { preload: importer, ...(data ? { prefetch: data } : {}) },
    ...(data ? { loader: loaderFor(data) } : {}),
  };
  return ('index' in place ? { ...route, index: true } : { ...route, path: place.path }) as RouteObject;
}

/** A lazily loaded layout (settings, admin) whose children render in its outlet. */
function layout<M>(
  importer: () => Promise<M>,
  name: keyof M & string,
  gate: Gate | undefined,
  path: string,
  children: RouteObject[],
): RouteObject {
  return {
    path,
    errorElement: <RouteError />,
    lazy: lazyScreen(importer, name, gate),
    handle: { preload: importer },
    children,
  };
}

/** A public page; signed-in members are sent on (back to where sign-in was asked for, else home). */
function publicScreen<M>(importer: () => Promise<M>, name: keyof M & string, path: string, home?: string) {
  return {
    path,
    errorElement: <RouteError fullPage />,
    handle: { preload: importer },
    lazy: async () => {
      let mod: M;
      try {
        mod = await importWithRetry(importer);
      } catch (error) {
        return { element: <RouteError fullPage error={error} /> };
      }
      const Page = mod[name] as unknown as ComponentType;
      return {
        element: home ? (
          <PublicOnly home={home}>
            <Page />
          </PublicOnly>
        ) : (
          <Page />
        ),
      };
    },
  } satisfies RouteObject;
}

function NotFound() {
  const { t } = useTranslation();
  const tenant = useTenant();
  return (
    <EmptyState
      icon={<Compass className="size-6" />}
      title={t('errors.notFound')}
      action={
        <Link
          to={tenant.kind === 'platform' ? '/platform' : '/home'}
          className={buttonVariants({ variant: 'ghost' })}
        >
          {t('errors.goHome')}
        </Link>
      }
    />
  );
}

/** Forms and editors: no pull to refresh, so nothing refetches under someone typing. */
const still = (route: RouteObject): RouteObject => ({ ...route, handle: { ...route.handle, pull: false } });

const at = (path: string) => ({ path });
const index = { index: true } as const;

const settingsRoutes = still(
  layout(load.settings, 'SettingsLayout', undefined, 'settings', [
    screen(load.settings, 'SecuritySettings', undefined, index),
    screen(load.dataSettings, 'DataSettings', undefined, at('data')),
    screen(load.settings, 'PrivacySettings', undefined, at('privacy')),
    screen(load.settings, 'PreferenceSettings', undefined, at('preferences')),
    screen(load.notificationSettings, 'NotificationSettings', undefined, at('notifications')),
  ]),
);

const auth = (home: string): RouteObject[] => [
  publicScreen(load.signIn, 'SignInPage', '/sign-in', home),
  publicScreen(load.emailLinks, 'ForgotPasswordPage', '/forgot-password'),
  publicScreen(load.emailLinks, 'ResetPasswordPage', '/reset-password'),
  publicScreen(load.emailLinks, 'VerifyEmailPage', '/verify-email'),
];

/**
 * The signed-in layout: the shell never unmounts on navigation. Its children sit under one
 * pathless boundary, so a failing screen (or its first load) only ever fills the content area.
 */
const shell = (platform: boolean, children: RouteObject[]): RouteObject => ({
  element: (
    <RequireAuth>
      <AppShell platform={platform} />
    </RequireAuth>
  ),
  children: [
    {
      errorElement: <RouteError />,
      hydrateFallbackElement: <PageSkeleton />,
      children: [...children, { path: '*', element: <NotFound /> }],
    },
  ],
});

function collegeRoutes(): RouteObject[] {
  return [
    {
      errorElement: <RouteError fullPage />,
      hydrateFallbackElement: <Splash />,
      children: [
        // Lazy like every screen: signed-in members never download it (bundle budget).
        publicScreen(load.landing, 'LandingPage', '/', '/home'),
        publicScreen(load.signUp, 'SignUpPage', '/sign-up', '/home'),
        // One-tap invites and class codes (B4): signed-in members are already in.
        publicScreen(load.join, 'InvitePage', '/invite/:token', '/home'),
        publicScreen(load.join, 'JoinPage', '/join/:code', '/home'),
        ...auth('/home'),
        // The living style guide (revamp phase 6): development builds only; production leaves it out.
        ...(import.meta.env.DEV
          ? [publicScreen(() => import('../features/design/style-guide'), 'StyleGuidePage', '/design')]
          : []),
        shell(false, [
          screen(load.home, 'HomePage', undefined, at('/home'), (_, url) => [
            qc.ensureInfiniteQueryData(
              q.homeFeed(url.searchParams.get('tab') === 'following' ? 'following' : 'for_you'),
            ),
            qc.ensureQueryData(q.oneUsefulThing()),
            // Stories only when the college has them on (Admin › Features).
            ...(qc.getQueryData<PublicTenant>(q.tenant().queryKey)?.features.stories === false
              ? []
              : [qc.ensureQueryData(q.stories())]),
          ]),
          still(screen(load.verify, 'VerifyPage', undefined, at('/verify'))),
          screen(load.study, 'StudyPage', inFeature('study', 'study:read'), at('/study'), () => [
            qc
              .ensureQueryData(q.me())
              .then((me) =>
                qc.ensureQueryData(q.subjects(me.roles.every((r) => r === 'STUDENT') ? 'all' : 'mine')),
              ),
            qc.ensureQueryData(q.aiStatus()),
          ]),
          screen(load.subject, 'SubjectPage', inFeature('study', 'study:read'), at('/study/:id'), ({ id }) =>
            isId(id)
              ? [
                  qc.ensureQueryData(q.subject(id)),
                  qc.ensureQueryData(q.syllabus(id)),
                  qc.ensureQueryData(q.materials(id, { unitId: '', topicId: '' })),
                ]
              : [],
          ),
          screen(
            load.insights,
            'InsightsPage',
            inFeature('study', 'study:analytics'),
            at('/study/:id/insights'),
            ({ id }) =>
              isId(id)
                ? [qc.ensureQueryData(q.subject(id)), qc.ensureQueryData(q.studyInsights(id, 30))]
                : [],
          ),
          // Conversations with a composer (and a streaming answer) never refetch under a pull.
          still(
            screen(load.chat, 'ChatPage', inFeature('study', 'study:read'), at('/study/chat'), () => [
              qc.ensureQueryData(q.chatSessions()),
              qc.ensureQueryData(q.aiStatus()),
            ]),
          ),
          still(
            screen(
              load.chat,
              'ChatPage',
              inFeature('study', 'study:read'),
              at('/study/chat/:sessionId'),
              ({ sessionId }) => [
                qc.ensureQueryData(q.chatSessions()),
                ...(isId(sessionId) ? [qc.ensureQueryData(q.chatSession(sessionId))] : []),
              ],
            ),
          ),
          screen(
            load.material,
            'MaterialPage',
            inFeature('study', 'study:read'),
            at('/study/:id/m/:materialId'),
            ({ id, materialId }) =>
              isId(id) && isId(materialId)
                ? [qc.ensureQueryData(q.material(materialId)), qc.ensureQueryData(q.subject(id))]
                : [],
          ),
          still(screen(load.profileEdit, 'ProfileEdit', undefined, at('/profile'))),
          screen(load.directory, 'DirectoryPage', 'directory:read', at('/people')),
          screen(load.profileView, 'ProfileView', 'directory:read', at('/people/:userId')),
          screen(load.postPage, 'PostPage', 'feed:read', at('/posts/:postId'), ({ postId }) =>
            isId(postId) ? [qc.ensureQueryData(q.post(postId)), qc.ensureQueryData(q.comments(postId))] : [],
          ),
          screen(load.collections, 'SavedPage', 'feed:interact', at('/saved')),
          screen(load.collections, 'ReelsPage', inFeature('reels', 'feed:read'), at('/reels')),
          screen(
            load.collections,
            'FollowingPage',
            inFeature('contentSources', 'sources:follow'),
            at('/following'),
          ),
          screen(load.questions, 'QuestionsPage', 'feed:read', at('/questions')),
          screen(load.questions, 'QuestionPage', 'feed:read', at('/questions/:questionId')),
          screen(load.galaxy, 'RoadmapsPage', 'roadmaps:read', at('/roadmaps'), (_, url) => [
            qc.ensureQueryData(q.roadmapsList(q.roadmapFilterQuery(url.searchParams))),
            // The sections above the list, for members who have them (no layout shift, audit).
            qc
              .ensureQueryData(q.me())
              .then((me) =>
                Promise.all([
                  me.permissions.includes('roadmaps:progress') && qc.ensureQueryData(q.followedRoadmaps()),
                  me.permissions.includes('roadmaps:write') && qc.ensureQueryData(q.roadmapDrafts()),
                ]),
              ),
          ]),
          screen(load.roadmapReview, 'RoadmapReviewPage', 'roadmaps:review', at('/roadmaps/review')),
          still(screen(load.roadmapEditor, 'RoadmapEditorPage', 'roadmaps:write', at('/roadmaps/new'))),
          screen(load.roadmap, 'RoadmapPage', 'roadmaps:read', at('/roadmaps/:slug'), ({ slug }) =>
            slug ? [qc.ensureQueryData(q.roadmap(slug))] : [],
          ),
          screen(load.roadmapHistory, 'RoadmapHistoryPage', 'roadmaps:read', at('/roadmaps/:slug/history')),
          still(
            screen(load.roadmapEditor, 'RoadmapEditorPage', 'roadmaps:write', at('/roadmaps/:slug/edit')),
          ),
          screen(load.progress, 'ProgressPage', undefined, at('/progress'), () => [
            qc.ensureQueryData(q.progress()),
          ]),
          screen(
            load.leaderboard,
            'LeaderboardPage',
            inFeature('leaderboards', 'directory:read'),
            at('/leaderboard'),
          ),
          screen(load.leaderboard, 'WallOfMentorsPage', 'directory:read', at('/wall-of-mentors')),
          screen(load.rewards, 'RewardsPage', 'rewards:redeem', at('/rewards')),
          screen(load.events, 'EventsPage', 'events:rsvp', at('/events'), () => [
            qc.ensureQueryData(q.events('upcoming', '')),
          ]),
          still(screen(load.events, 'EventFormPage', ['events:create', 'ama:host'], at('/events/new'))),
          screen(load.eventPage, 'EventPage', 'events:rsvp', at('/events/:id'), ({ id }) =>
            isId(id) ? [qc.ensureQueryData(q.event(id))] : [],
          ),
          still(screen(load.events, 'EventFormPage', ['events:create', 'ama:host'], at('/events/:id/edit'))),
          screen(load.jobs, 'JobsPage', 'jobs:read', at('/jobs'), (_, url) => [
            qc.ensureQueryData(q.jobsRadar()),
            qc.ensureInfiniteQueryData(q.jobsList(q.jobFilterQuery(url.searchParams))),
          ]),
          screen(load.tracker, 'TrackerPage', 'jobs:save', at('/jobs/tracker')),
          still(screen(load.postJob, 'PostJobPage', 'jobs:post', at('/jobs/new'))),
          screen(load.jobPage, 'JobPage', 'jobs:read', at('/jobs/:jobId'), ({ jobId }) =>
            isId(jobId) ? [qc.ensureQueryData(q.job(jobId))] : [],
          ),
          screen(load.referrals, 'ReferralsPage', ['referrals:request', 'referrals:offer'], at('/referrals')),
          screen(
            load.placements,
            'PlacementsPage',
            inFeature('placements', 'placements:view'),
            at('/placements'),
            (_, url) => {
              const tab = url.searchParams.get('tab');
              return [
                qc.ensureQueryData(q.myAcademics()),
                tab === 'offers'
                  ? qc.ensureQueryData(q.myOffers())
                  : qc.ensureQueryData(
                      q.placementDrives(tab === 'all' || tab === 'registered' ? tab : 'eligible'),
                    ),
              ];
            },
          ),
          screen(
            load.outcomes,
            'OutcomesPage',
            inFeature('placements', 'outcomes:report'),
            at('/outcomes'),
            () => [qc.ensureQueryData(q.myOffers()), qc.ensureQueryData(q.myOutcomes())],
          ),
          screen(
            load.drivePage,
            'DrivePage',
            inFeature('placements', 'placements:view'),
            at('/placements/:id'),
            ({ id }) => (isId(id) ? [qc.ensureQueryData(q.placementDrive(id))] : []),
          ),
          screen(load.mentors, 'MentorsPage', 'mentorship:request', at('/mentors'), (_, url) =>
            url.searchParams.get('view') === 'browse' ? [] : [qc.ensureQueryData(q.mentorMatch())],
          ),
          screen(load.mentorPage, 'MentorPage', 'mentorship:request', at('/mentors/:userId'), ({ userId }) =>
            isId(userId) ? [qc.ensureQueryData(q.mentor(userId))] : [],
          ),
          screen(load.requests, 'RequestsPage', 'mentorship:request', at('/mentorship')),
          screen(load.sessions, 'SessionsPage', 'sessions:book', at('/sessions'), (_, url) => [
            qc.ensureQueryData(q.bookings(url.searchParams.get('when') === 'past' ? 'past' : 'upcoming')),
          ]),
          screen(load.messages, 'MessagesPage', 'messages:send', at('/messages'), () => [
            qc.ensureQueryData(q.conversations()),
          ]),
          still(
            screen(
              load.messages,
              'ConversationPage',
              'messages:send',
              at('/messages/:conversationId'),
              ({ conversationId }) =>
                isId(conversationId) ? [qc.ensureQueryData(q.conversation(conversationId))] : [],
            ),
          ),
          screen(load.mentorDashboard, 'MentorDashboard', 'mentorship:mentor', at('/mentor')),
          screen(load.notifications, 'NotificationsPage', undefined, at('/notifications'), () => [
            qc.ensureQueryData(q.notifications()),
          ]),
          settingsRoutes,
          layout(load.admin, 'AdminLayout', ADMIN_PERMISSIONS, 'admin', [
            screen(load.adminOverview, 'AdminOverview', undefined, index, () => [
              qc.ensureQueryData(q.adminOverview()),
            ]),
            screen(load.admin, 'UsersAdmin', 'users:read_admin', at('users')),
            screen(load.mentorshipAdmin, 'MentorshipAdmin', 'mentorship:oversee', at('mentorship')),
            screen(load.moderationAdmin, 'ModerationAdmin', 'moderation:act', at('moderation')),
            screen(
              load.sourcesAdmin,
              'SourcesAdmin',
              inFeature('contentSources', 'sources:manage'),
              at('sources'),
            ),
            screen(
              load.jobSourcesAdmin,
              'JobSourcesAdmin',
              inFeature('jobsAggregation', 'jobs:sources'),
              at('job-sources'),
            ),
            screen(load.analyticsAdmin, 'AnalyticsAdmin', 'analytics:cohort', at('analytics'), () => [
              qc.ensureQueryData(q.analytics(q.ANALYTICS_DEFAULTS)),
            ]),
            screen(load.rewards, 'RewardsAdmin', 'rewards:manage', at('rewards')),
            screen(load.imports, 'ImportsAdmin', 'imports:manage', at('imports')),
            screen(load.onboardingAdmin, 'OnboardingAdmin', 'onboarding:manage', at('onboarding'), () => [
              qc.ensureQueryData(q.onboardingProgress()),
              qc.ensureInfiniteQueryData(q.onboardingRecords('')),
              qc.ensureQueryData(q.joinCodes()),
            ]),
            screen(
              load.onboardingAdmin,
              'JoinPosterPage',
              'onboarding:manage',
              at('onboarding/poster/:id'),
              ({ id }) => (isId(id) ? [qc.ensureQueryData(q.joinCodePoster(id))] : []),
            ),
            screen(
              load.placementsAdmin,
              'DrivesAdmin',
              inFeature('placements', 'placements:manage'),
              at('placements'),
              () => [qc.ensureInfiniteQueryData(q.adminDrives(''))],
            ),
            still(
              screen(
                load.driveEditor,
                'DriveEditor',
                inFeature('placements', 'placements:manage'),
                at('placements/new'),
              ),
            ),
            screen(
              load.driveManage,
              'DriveManage',
              inFeature('placements', 'placements:manage'),
              at('placements/:id'),
              ({ id }) =>
                isId(id)
                  ? [qc.ensureQueryData(q.placementDrive(id)), qc.ensureQueryData(q.driveRegistrants(id))]
                  : [],
            ),
            still(
              screen(
                load.driveEditor,
                'DriveEditPage',
                inFeature('placements', 'placements:manage'),
                at('placements/:id/edit'),
                ({ id }) => (isId(id) ? [qc.ensureQueryData(q.placementDrive(id))] : []),
              ),
            ),
            screen(
              load.placementsAdmin,
              'OffersAdmin',
              inFeature('placements', 'outcomes:verify'),
              at('offers'),
              () => [qc.ensureInfiniteQueryData(q.offersQueue('reported'))],
            ),
            screen(
              load.reports,
              'ReportsDashboard',
              inFeature('placements', 'analytics:tenant'),
              at('reports'),
              (_, url) => [
                qc.ensureQueryData(q.reportsDashboard(reportQs(url))),
                qc.ensureQueryData(q.reportDefinitions()),
              ],
            ),
            screen(
              load.reports,
              'ReportPage',
              inFeature('placements', 'analytics:tenant'),
              at('reports/:id'),
              ({ id }, url) => (id ? [qc.ensureQueryData(q.outcomeReport(id, reportQs(url)))] : []),
            ),
            screen(load.listAdmin, 'ListAdmin', 'imports:manage', at('list')),
            screen(load.listAdmin, 'VerificationAdmin', 'verification:review', at('verification')),
            still(screen(load.admin, 'BrandingAdmin', 'tenant:branding', at('branding'))),
            still(screen(load.admin, 'FeaturesAdmin', 'tenant:settings', at('features'))),
            still(screen(load.aiAdmin, 'AiAdmin', inFeature('study', 'ai:settings'), at('ai'))),
            screen(load.admin, 'AuditAdmin', 'audit:read', at('audit')),
          ]),
        ]),
      ],
    },
  ];
}

function platformRoutes(): RouteObject[] {
  return [
    {
      errorElement: <RouteError fullPage />,
      hydrateFallbackElement: <Splash />,
      children: [
        { path: '/', element: <Navigate to="/platform" replace /> },
        ...auth('/platform'),
        shell(true, [
          screen(load.platform, 'PlatformTenants', 'platform:tenants', at('/platform')),
          screen(load.platform, 'PlatformHealth', 'platform:health', at('/platform/health')),
          settingsRoutes,
        ]),
      ],
    },
  ];
}

// Lets `warmLanding` (lib/preload.ts) match the opened URL before the router exists.
registerRouteTables((kind) => (kind === 'platform' ? platformRoutes() : collegeRoutes()));

let collegeInstance: ReturnType<typeof createBrowserRouter> | null = null;
let platformInstance: ReturnType<typeof createBrowserRouter> | null = null;

type AppRouterInstance = ReturnType<typeof createBrowserRouter>;
const animated = new WeakSet<AppRouterInstance>();

/**
 * Every navigation to another screen runs as a view transition (master prompt §7b); React Router
 * replays it in reverse on Back. Same-screen updates (overlays, filters) never animate, and nor does
 * anything on a device too slow to animate smoothly (`animateScreens()`). Browsers without the View
 * Transitions API simply switch screens.
 */
function withViewTransitions(router: AppRouterInstance) {
  if (animated.has(router)) return router;
  animated.add(router);
  const navigate = router.navigate.bind(router);
  router.navigate = ((to: unknown, opts?: Record<string, unknown>) => {
    if (typeof to === 'number' || to == null || opts?.viewTransition !== undefined)
      return navigate(to as never, opts as never);
    const target = typeof to === 'string' ? to : createPath(to as Partial<Path>);
    const next = new URL(target, window.location.href).pathname;
    const crossScreen = next !== router.state.location.pathname && animateScreens();
    return navigate(to as never, { ...opts, viewTransition: crossScreen } as never);
  }) as AppRouterInstance['navigate'];
  return router;
}

export function AppRouter() {
  const tenant = useTenant();
  const router = withViewTransitions(
    tenant.kind === 'platform'
      ? (platformInstance ??= createBrowserRouter(platformRoutes()))
      : (collegeInstance ??= createBrowserRouter(collegeRoutes())),
  );
  registerPreloadRoutes(router.routes);
  registerRouterState(() => ({ navigating: router.state.navigation.state !== 'idle' }));
  setPendingTargetResolver(() => {
    const next = router.state.navigation.location;
    return next ? `${next.pathname}${next.search}${next.hash}` : null;
  });
  return <RouterProvider router={router} />;
}
