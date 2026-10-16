import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import type { Permission } from '@campuslink/shared';
import { useTenant } from '../lib/tenant-context';
import { AppShell } from '../components/layout/app-shell';
import { EmptyState } from '../components/ui/misc';
import { PublicOnly, RequireAuth, RequirePermission, Splash } from './guards';
import { LandingPage } from '../features/landing/landing';
import { SignInPage } from '../features/auth/sign-in';
import { SignUpPage } from '../features/auth/sign-up';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from '../features/auth/email-links';

// Route-level code splitting: only the public pages are on the first-load path.
const HomePage = lazy(() => import('../features/home/home').then((m) => ({ default: m.HomePage })));
const Settings = lazy(() =>
  import('../features/settings/settings').then((m) => ({ default: m.SettingsLayout })),
);
const Security = lazy(() =>
  import('../features/settings/settings').then((m) => ({ default: m.SecuritySettings })),
);
const DataSettings = lazy(() =>
  import('../features/settings/data-settings').then((m) => ({ default: m.DataSettings })),
);
const Privacy = lazy(() =>
  import('../features/settings/settings').then((m) => ({ default: m.PrivacySettings })),
);
const Prefs = lazy(() =>
  import('../features/settings/settings').then((m) => ({ default: m.PreferenceSettings })),
);
const Admin = lazy(() => import('../features/admin/admin').then((m) => ({ default: m.AdminLayout })));
const Users = lazy(() => import('../features/admin/admin').then((m) => ({ default: m.UsersAdmin })));
const Branding = lazy(() => import('../features/admin/admin').then((m) => ({ default: m.BrandingAdmin })));
const Features = lazy(() => import('../features/admin/admin').then((m) => ({ default: m.FeaturesAdmin })));
const Imports = lazy(() => import('../features/admin/imports').then((m) => ({ default: m.ImportsAdmin })));
const ListAdmin = lazy(() => import('../features/admin/list-admin').then((m) => ({ default: m.ListAdmin })));
const VerificationAdmin = lazy(() =>
  import('../features/admin/list-admin').then((m) => ({ default: m.VerificationAdmin })),
);
const Directory = lazy(() =>
  import('../features/people/directory').then((m) => ({ default: m.DirectoryPage })),
);
const ProfileView = lazy(() =>
  import('../features/people/profile-view').then((m) => ({ default: m.ProfileView })),
);
const ProfileEdit = lazy(() =>
  import('../features/profile/profile-edit').then((m) => ({ default: m.ProfileEdit })),
);
const Verify = lazy(() => import('../features/verify/verify').then((m) => ({ default: m.VerifyPage })));
const Mentors = lazy(() => import('../features/mentors/mentors').then((m) => ({ default: m.MentorsPage })));
const MentorPage = lazy(() =>
  import('../features/mentors/mentor-page').then((m) => ({ default: m.MentorPage })),
);
const Requests = lazy(() =>
  import('../features/mentorship/requests').then((m) => ({ default: m.RequestsPage })),
);
const Sessions = lazy(() =>
  import('../features/sessions/sessions').then((m) => ({ default: m.SessionsPage })),
);
const Messages = lazy(() =>
  import('../features/messages/messages').then((m) => ({ default: m.MessagesPage })),
);
const Conversation = lazy(() =>
  import('../features/messages/messages').then((m) => ({ default: m.ConversationPage })),
);
const MentorDashboard = lazy(() =>
  import('../features/mentor/mentor-dashboard').then((m) => ({ default: m.MentorDashboard })),
);
const Notifications = lazy(() =>
  import('../features/notifications/notifications').then((m) => ({ default: m.NotificationsPage })),
);
const NotificationSettings = lazy(() =>
  import('../features/settings/notification-settings').then((m) => ({ default: m.NotificationSettings })),
);
const MentorshipAdmin = lazy(() =>
  import('../features/admin/mentorship-admin').then((m) => ({ default: m.MentorshipAdmin })),
);
const PostPage = lazy(() => import('../features/feed/post-page').then((m) => ({ default: m.PostPage })));
const Saved = lazy(() => import('../features/feed/collections').then((m) => ({ default: m.SavedPage })));
const Reels = lazy(() => import('../features/feed/collections').then((m) => ({ default: m.ReelsPage })));
const Following = lazy(() =>
  import('../features/feed/collections').then((m) => ({ default: m.FollowingPage })),
);
const Questions = lazy(() => import('../features/qa/questions').then((m) => ({ default: m.QuestionsPage })));
const Question = lazy(() => import('../features/qa/questions').then((m) => ({ default: m.QuestionPage })));
const Roadmaps = lazy(() => import('../features/roadmaps/galaxy').then((m) => ({ default: m.RoadmapsPage })));
const Roadmap = lazy(() =>
  import('../features/roadmaps/roadmap-page').then((m) => ({ default: m.RoadmapPage })),
);
const RoadmapHistory = lazy(() =>
  import('../features/roadmaps/history').then((m) => ({ default: m.RoadmapHistoryPage })),
);
const RoadmapEditor = lazy(() =>
  import('../features/roadmaps/editor').then((m) => ({ default: m.RoadmapEditorPage })),
);
const RoadmapReview = lazy(() =>
  import('../features/roadmaps/review').then((m) => ({ default: m.RoadmapReviewPage })),
);
const Progress = lazy(() =>
  import('../features/progress/progress-page').then((m) => ({ default: m.ProgressPage })),
);
const Leaderboard = lazy(() =>
  import('../features/progress/leaderboard').then((m) => ({ default: m.LeaderboardPage })),
);
const Wall = lazy(() =>
  import('../features/progress/leaderboard').then((m) => ({ default: m.WallOfMentorsPage })),
);
const Rewards = lazy(() => import('../features/progress/rewards').then((m) => ({ default: m.RewardsPage })));
const RewardsAdmin = lazy(() =>
  import('../features/progress/rewards').then((m) => ({ default: m.RewardsAdmin })),
);
const Events = lazy(() => import('../features/events/events').then((m) => ({ default: m.EventsPage })));
const EventForm = lazy(() => import('../features/events/events').then((m) => ({ default: m.EventFormPage })));
const EventPage = lazy(() => import('../features/events/event-page').then((m) => ({ default: m.EventPage })));
const AnalyticsAdmin = lazy(() =>
  import('../features/admin/analytics-admin').then((m) => ({ default: m.AnalyticsAdmin })),
);
const Jobs = lazy(() => import('../features/jobs/radar').then((m) => ({ default: m.JobsPage })));
const JobPage = lazy(() => import('../features/jobs/job-page').then((m) => ({ default: m.JobPage })));
const Tracker = lazy(() => import('../features/jobs/tracker').then((m) => ({ default: m.TrackerPage })));
const PostJob = lazy(() => import('../features/jobs/post-job').then((m) => ({ default: m.PostJobPage })));
const Referrals = lazy(() =>
  import('../features/referrals/referrals').then((m) => ({ default: m.ReferralsPage })),
);
const JobSourcesAdmin = lazy(() =>
  import('../features/admin/job-sources-admin').then((m) => ({ default: m.JobSourcesAdmin })),
);
const ModerationAdmin = lazy(() =>
  import('../features/admin/moderation-admin').then((m) => ({ default: m.ModerationAdmin })),
);
const SourcesAdmin = lazy(() =>
  import('../features/admin/sources-admin').then((m) => ({ default: m.SourcesAdmin })),
);
const Audit = lazy(() => import('../features/admin/admin').then((m) => ({ default: m.AuditAdmin })));
const Tenants = lazy(() =>
  import('../features/platform/platform').then((m) => ({ default: m.PlatformTenants })),
);
const Health = lazy(() =>
  import('../features/platform/platform').then((m) => ({ default: m.PlatformHealth })),
);

const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<Splash />}>{children}</Suspense>;

function NotFound() {
  const { t } = useTranslation();
  return <EmptyState icon={<Compass className="size-6" />} title={t('errors.notFound')} />;
}

const settingsRoutes = {
  path: 'settings',
  element: (
    <S>
      <Settings />
    </S>
  ),
  children: [
    {
      index: true,
      element: (
        <S>
          <Security />
        </S>
      ),
    },
    {
      path: 'data',
      element: (
        <S>
          <DataSettings />
        </S>
      ),
    },
    {
      path: 'privacy',
      element: (
        <S>
          <Privacy />
        </S>
      ),
    },
    {
      path: 'preferences',
      element: (
        <S>
          <Prefs />
        </S>
      ),
    },
    {
      path: 'notifications',
      element: (
        <S>
          <NotificationSettings />
        </S>
      ),
    },
  ],
};

/** A lazily loaded page behind a permission (UX only; the API enforces it). */
const gated = (permission: Permission | Permission[], el: ReactNode) => (
  <RequirePermission permission={permission}>
    <S>{el}</S>
  </RequirePermission>
);

const auth = (home: string) => [
  {
    path: '/sign-in',
    element: (
      <PublicOnly home={home}>
        <SignInPage />
      </PublicOnly>
    ),
  },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
];

function collegeRouter() {
  return createBrowserRouter([
    {
      path: '/',
      element: (
        <PublicOnly home="/home">
          <LandingPage />
        </PublicOnly>
      ),
    },
    {
      path: '/sign-up',
      element: (
        <PublicOnly home="/home">
          <SignUpPage />
        </PublicOnly>
      ),
    },
    ...auth('/home'),
    {
      element: (
        <RequireAuth>
          <AppShell />
        </RequireAuth>
      ),
      children: [
        {
          path: '/home',
          element: (
            <S>
              <HomePage />
            </S>
          ),
        },
        {
          path: '/verify',
          element: (
            <S>
              <Verify />
            </S>
          ),
        },
        {
          path: '/profile',
          element: (
            <S>
              <ProfileEdit />
            </S>
          ),
        },
        {
          path: '/people',
          element: (
            <RequirePermission permission="directory:read">
              <S>
                <Directory />
              </S>
            </RequirePermission>
          ),
        },
        {
          path: '/people/:userId',
          element: (
            <RequirePermission permission="directory:read">
              <S>
                <ProfileView />
              </S>
            </RequirePermission>
          ),
        },
        { path: '/posts/:postId', element: gated('feed:read', <PostPage />) },
        { path: '/saved', element: gated('feed:interact', <Saved />) },
        { path: '/reels', element: gated('feed:read', <Reels />) },
        { path: '/following', element: gated('sources:follow', <Following />) },
        { path: '/questions', element: gated('feed:read', <Questions />) },
        { path: '/questions/:questionId', element: gated('feed:read', <Question />) },
        { path: '/roadmaps', element: gated('roadmaps:read', <Roadmaps />) },
        { path: '/roadmaps/review', element: gated('roadmaps:review', <RoadmapReview />) },
        { path: '/roadmaps/new', element: gated('roadmaps:write', <RoadmapEditor />) },
        { path: '/roadmaps/:slug', element: gated('roadmaps:read', <Roadmap />) },
        { path: '/roadmaps/:slug/history', element: gated('roadmaps:read', <RoadmapHistory />) },
        { path: '/roadmaps/:slug/edit', element: gated('roadmaps:write', <RoadmapEditor />) },
        {
          path: '/progress',
          element: (
            <S>
              <Progress />
            </S>
          ),
        },
        { path: '/leaderboard', element: gated('directory:read', <Leaderboard />) },
        { path: '/wall-of-mentors', element: gated('directory:read', <Wall />) },
        { path: '/rewards', element: gated('rewards:redeem', <Rewards />) },
        { path: '/events', element: gated('events:rsvp', <Events />) },
        { path: '/events/new', element: gated(['events:create', 'ama:host'], <EventForm />) },
        { path: '/events/:id', element: gated('events:rsvp', <EventPage />) },
        { path: '/events/:id/edit', element: gated(['events:create', 'ama:host'], <EventForm />) },
        { path: '/jobs', element: gated('jobs:read', <Jobs />) },
        { path: '/jobs/tracker', element: gated('jobs:save', <Tracker />) },
        { path: '/jobs/new', element: gated('jobs:post', <PostJob />) },
        { path: '/jobs/:jobId', element: gated('jobs:read', <JobPage />) },
        { path: '/referrals', element: gated(['referrals:request', 'referrals:offer'], <Referrals />) },
        { path: '/mentors', element: gated('mentorship:request', <Mentors />) },
        { path: '/mentors/:userId', element: gated('mentorship:request', <MentorPage />) },
        { path: '/mentorship', element: gated('mentorship:request', <Requests />) },
        { path: '/sessions', element: gated('sessions:book', <Sessions />) },
        { path: '/messages', element: gated('messages:send', <Messages />) },
        { path: '/messages/:conversationId', element: gated('messages:send', <Conversation />) },
        { path: '/mentor', element: gated('mentorship:mentor', <MentorDashboard />) },
        {
          path: '/notifications',
          element: (
            <S>
              <Notifications />
            </S>
          ),
        },
        settingsRoutes,
        {
          path: 'admin',
          element: (
            <RequirePermission
              permission={[
                'users:read_admin',
                'mentorship:oversee',
                'moderation:act',
                'sources:manage',
                'jobs:sources',
                'analytics:cohort',
                'rewards:manage',
              ]}
            >
              <S>
                <Admin />
              </S>
            </RequirePermission>
          ),
          children: [
            { index: true, element: gated('users:read_admin', <Users />) },
            { path: 'mentorship', element: gated('mentorship:oversee', <MentorshipAdmin />) },
            { path: 'moderation', element: gated('moderation:act', <ModerationAdmin />) },
            { path: 'sources', element: gated('sources:manage', <SourcesAdmin />) },
            { path: 'job-sources', element: gated('jobs:sources', <JobSourcesAdmin />) },
            { path: 'analytics', element: gated('analytics:cohort', <AnalyticsAdmin />) },
            { path: 'rewards', element: gated('rewards:manage', <RewardsAdmin />) },
            {
              path: 'imports',
              element: (
                <RequirePermission permission="imports:manage">
                  <S>
                    <Imports />
                  </S>
                </RequirePermission>
              ),
            },
            {
              path: 'list',
              element: (
                <RequirePermission permission="imports:manage">
                  <S>
                    <ListAdmin />
                  </S>
                </RequirePermission>
              ),
            },
            {
              path: 'verification',
              element: (
                <RequirePermission permission="verification:review">
                  <S>
                    <VerificationAdmin />
                  </S>
                </RequirePermission>
              ),
            },
            {
              path: 'branding',
              element: (
                <RequirePermission permission="tenant:branding">
                  <S>
                    <Branding />
                  </S>
                </RequirePermission>
              ),
            },
            {
              path: 'features',
              element: (
                <RequirePermission permission="tenant:settings">
                  <S>
                    <Features />
                  </S>
                </RequirePermission>
              ),
            },
            {
              path: 'audit',
              element: (
                <RequirePermission permission="audit:read">
                  <S>
                    <Audit />
                  </S>
                </RequirePermission>
              ),
            },
          ],
        },
        { path: '*', element: <NotFound /> },
      ],
    },
  ]);
}

function platformRouter() {
  return createBrowserRouter([
    { path: '/', element: <Navigate to="/platform" replace /> },
    ...auth('/platform'),
    {
      element: (
        <RequireAuth>
          <AppShell platform />
        </RequireAuth>
      ),
      children: [
        {
          path: '/platform',
          element: (
            <RequirePermission permission="platform:tenants">
              <S>
                <Tenants />
              </S>
            </RequirePermission>
          ),
        },
        {
          path: '/platform/health',
          element: (
            <RequirePermission permission="platform:health">
              <S>
                <Health />
              </S>
            </RequirePermission>
          ),
        },
        settingsRoutes,
        { path: '*', element: <NotFound /> },
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
  return <RouterProvider router={router} />;
}
