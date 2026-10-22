import type { ComponentType } from 'react';
import { createBrowserRouter, Link, Navigate, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import { ADMIN_PERMISSIONS, type Permission } from '@campuslink/shared';
import { useTenant } from '../lib/tenant-context';
import { importWithRetry, setPendingTargetResolver } from '../lib/chunk-reload';
import { registerPreloadRoutes } from '../lib/preload';
import { AppShell } from '../components/layout/app-shell';
import { RouteError } from '../components/layout/route-error';
import { PageSkeleton } from '../components/layout/skeletons';
import { buttonVariants } from '../components/ui/button-variants';
import { EmptyState } from '../components/ui/misc';
import { PublicOnly, RequireAuth, RequirePermission, Splash } from './guards';
import { LandingPage } from '../features/landing/landing';

/**
 * Route-level code splitting through React Router's `lazy`: the router loads a screen's code
 * before it commits the navigation, so the current screen stays on screen (with the top progress
 * bar) instead of being replaced by a spinner. Only the public pages are on the first-load path.
 */
const load = {
  signIn: () => import('../features/auth/sign-in'),
  signUp: () => import('../features/auth/sign-up'),
  emailLinks: () => import('../features/auth/email-links'),
  home: () => import('../features/home/home'),
  settings: () => import('../features/settings/settings'),
  dataSettings: () => import('../features/settings/data-settings'),
  notificationSettings: () => import('../features/settings/notification-settings'),
  admin: () => import('../features/admin/admin'),
  imports: () => import('../features/admin/imports'),
  listAdmin: () => import('../features/admin/list-admin'),
  mentorshipAdmin: () => import('../features/admin/mentorship-admin'),
  analyticsAdmin: () => import('../features/admin/analytics-admin'),
  jobSourcesAdmin: () => import('../features/admin/job-sources-admin'),
  moderationAdmin: () => import('../features/admin/moderation-admin'),
  sourcesAdmin: () => import('../features/admin/sources-admin'),
  directory: () => import('../features/people/directory'),
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
  platform: () => import('../features/platform/platform'),
};

type Gate = Permission | readonly Permission[];
type Place = { path: string } | { index: true };

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
    return {
      element: gate ? (
        <RequirePermission permission={typeof gate === 'string' ? gate : [...gate]}>
          <Screen />
        </RequirePermission>
      ) : (
        <Screen />
      ),
    };
  };
}

/** A lazily loaded screen, optionally behind a permission (UX only; the API enforces it). */
function screen<M>(importer: () => Promise<M>, name: keyof M & string, gate: Gate | undefined, place: Place) {
  const route = {
    errorElement: <RouteError />,
    lazy: lazyScreen(importer, name, gate),
    handle: { preload: importer },
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

const at = (path: string) => ({ path });
const index = { index: true } as const;

const settingsRoutes = layout(load.settings, 'SettingsLayout', undefined, 'settings', [
  screen(load.settings, 'SecuritySettings', undefined, index),
  screen(load.dataSettings, 'DataSettings', undefined, at('data')),
  screen(load.settings, 'PrivacySettings', undefined, at('privacy')),
  screen(load.settings, 'PreferenceSettings', undefined, at('preferences')),
  screen(load.notificationSettings, 'NotificationSettings', undefined, at('notifications')),
]);

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

function collegeRouter() {
  return createBrowserRouter([
    {
      errorElement: <RouteError fullPage />,
      hydrateFallbackElement: <Splash />,
      children: [
        {
          path: '/',
          element: (
            <PublicOnly home="/home">
              <LandingPage />
            </PublicOnly>
          ),
        },
        publicScreen(load.signUp, 'SignUpPage', '/sign-up', '/home'),
        ...auth('/home'),
        shell(false, [
          screen(load.home, 'HomePage', undefined, at('/home')),
          screen(load.verify, 'VerifyPage', undefined, at('/verify')),
          screen(load.profileEdit, 'ProfileEdit', undefined, at('/profile')),
          screen(load.directory, 'DirectoryPage', 'directory:read', at('/people')),
          screen(load.profileView, 'ProfileView', 'directory:read', at('/people/:userId')),
          screen(load.postPage, 'PostPage', 'feed:read', at('/posts/:postId')),
          screen(load.collections, 'SavedPage', 'feed:interact', at('/saved')),
          screen(load.collections, 'ReelsPage', 'feed:read', at('/reels')),
          screen(load.collections, 'FollowingPage', 'sources:follow', at('/following')),
          screen(load.questions, 'QuestionsPage', 'feed:read', at('/questions')),
          screen(load.questions, 'QuestionPage', 'feed:read', at('/questions/:questionId')),
          screen(load.galaxy, 'RoadmapsPage', 'roadmaps:read', at('/roadmaps')),
          screen(load.roadmapReview, 'RoadmapReviewPage', 'roadmaps:review', at('/roadmaps/review')),
          screen(load.roadmapEditor, 'RoadmapEditorPage', 'roadmaps:write', at('/roadmaps/new')),
          screen(load.roadmap, 'RoadmapPage', 'roadmaps:read', at('/roadmaps/:slug')),
          screen(load.roadmapHistory, 'RoadmapHistoryPage', 'roadmaps:read', at('/roadmaps/:slug/history')),
          screen(load.roadmapEditor, 'RoadmapEditorPage', 'roadmaps:write', at('/roadmaps/:slug/edit')),
          screen(load.progress, 'ProgressPage', undefined, at('/progress')),
          screen(load.leaderboard, 'LeaderboardPage', 'directory:read', at('/leaderboard')),
          screen(load.leaderboard, 'WallOfMentorsPage', 'directory:read', at('/wall-of-mentors')),
          screen(load.rewards, 'RewardsPage', 'rewards:redeem', at('/rewards')),
          screen(load.events, 'EventsPage', 'events:rsvp', at('/events')),
          screen(load.events, 'EventFormPage', ['events:create', 'ama:host'], at('/events/new')),
          screen(load.eventPage, 'EventPage', 'events:rsvp', at('/events/:id')),
          screen(load.events, 'EventFormPage', ['events:create', 'ama:host'], at('/events/:id/edit')),
          screen(load.jobs, 'JobsPage', 'jobs:read', at('/jobs')),
          screen(load.tracker, 'TrackerPage', 'jobs:save', at('/jobs/tracker')),
          screen(load.postJob, 'PostJobPage', 'jobs:post', at('/jobs/new')),
          screen(load.jobPage, 'JobPage', 'jobs:read', at('/jobs/:jobId')),
          screen(load.referrals, 'ReferralsPage', ['referrals:request', 'referrals:offer'], at('/referrals')),
          screen(load.mentors, 'MentorsPage', 'mentorship:request', at('/mentors')),
          screen(load.mentorPage, 'MentorPage', 'mentorship:request', at('/mentors/:userId')),
          screen(load.requests, 'RequestsPage', 'mentorship:request', at('/mentorship')),
          screen(load.sessions, 'SessionsPage', 'sessions:book', at('/sessions')),
          screen(load.messages, 'MessagesPage', 'messages:send', at('/messages')),
          screen(load.messages, 'ConversationPage', 'messages:send', at('/messages/:conversationId')),
          screen(load.mentorDashboard, 'MentorDashboard', 'mentorship:mentor', at('/mentor')),
          screen(load.notifications, 'NotificationsPage', undefined, at('/notifications')),
          settingsRoutes,
          layout(load.admin, 'AdminLayout', ADMIN_PERMISSIONS, 'admin', [
            screen(load.admin, 'UsersAdmin', 'users:read_admin', index),
            screen(load.mentorshipAdmin, 'MentorshipAdmin', 'mentorship:oversee', at('mentorship')),
            screen(load.moderationAdmin, 'ModerationAdmin', 'moderation:act', at('moderation')),
            screen(load.sourcesAdmin, 'SourcesAdmin', 'sources:manage', at('sources')),
            screen(load.jobSourcesAdmin, 'JobSourcesAdmin', 'jobs:sources', at('job-sources')),
            screen(load.analyticsAdmin, 'AnalyticsAdmin', 'analytics:cohort', at('analytics')),
            screen(load.rewards, 'RewardsAdmin', 'rewards:manage', at('rewards')),
            screen(load.imports, 'ImportsAdmin', 'imports:manage', at('imports')),
            screen(load.listAdmin, 'ListAdmin', 'imports:manage', at('list')),
            screen(load.listAdmin, 'VerificationAdmin', 'verification:review', at('verification')),
            screen(load.admin, 'BrandingAdmin', 'tenant:branding', at('branding')),
            screen(load.admin, 'FeaturesAdmin', 'tenant:settings', at('features')),
            screen(load.admin, 'AuditAdmin', 'audit:read', at('audit')),
          ]),
        ]),
      ],
    },
  ]);
}

function platformRouter() {
  return createBrowserRouter([
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
  ]);
}

let collegeInstance: ReturnType<typeof createBrowserRouter> | null = null;
let platformInstance: ReturnType<typeof createBrowserRouter> | null = null;

export function AppRouter() {
  const tenant = useTenant();
  const router =
    tenant.kind === 'platform'
      ? (platformInstance ??= platformRouter())
      : (collegeInstance ??= collegeRouter());
  registerPreloadRoutes(router.routes);
  setPendingTargetResolver(() => {
    const next = router.state.navigation.location;
    return next ? `${next.pathname}${next.search}${next.hash}` : null;
  });
  return <RouterProvider router={router} />;
}
