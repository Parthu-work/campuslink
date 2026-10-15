import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import { useTenant } from '../lib/tenant-context';
import { AppShell } from '../components/layout/app-shell';
import { EmptyState } from '../components/ui/misc';
import { PublicOnly, RequireAuth, RequirePermission, Splash } from './guards';
import { LandingPage } from '../features/landing/landing';
import { SignInPage } from '../features/auth/sign-in';
import { SignUpPage } from '../features/auth/sign-up';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from '../features/auth/email-links';
import { HomePage } from '../features/home/home';

// Route-level code splitting: settings, admin and platform are not on the first-load path.
const Settings = lazy(() =>
  import('../features/settings/settings').then((m) => ({ default: m.SettingsLayout })),
);
const Security = lazy(() =>
  import('../features/settings/settings').then((m) => ({ default: m.SecuritySettings })),
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
  ],
};

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
        { path: '/home', element: <HomePage /> },
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
        settingsRoutes,
        {
          path: 'admin',
          element: (
            <RequirePermission permission="users:read_admin">
              <S>
                <Admin />
              </S>
            </RequirePermission>
          ),
          children: [
            {
              index: true,
              element: (
                <S>
                  <Users />
                </S>
              ),
            },
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
