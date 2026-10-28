import type { Page } from '@playwright/test';

/**
 * The re-audit's screen set: every screen the audit captured (`docs/design/revamp/before/`, same
 * names), plus the screens built since (the admin overview, the AI assistant, Study). A screen is a
 * path, or a list page whose first matching link is followed (detail pages have seeded ids).
 */
export type AuditRole =
  'public' | 'student' | 'alumni' | 'contributor' | 'faculty' | 'tpo' | 'admin' | 'unverified' | 'platform';

export interface AuditScreen {
  slug: string;
  path?: string;
  /** Open `from`, then follow the first link matching `link` (a CSS selector), optionally with this text. */
  follow?: { from: string; link: string; text?: RegExp; then?: string };
  /** Runs after the screen loads (open a sheet or the palette). */
  open?: (page: Page) => Promise<void>;
  /** Wait for this selector too (content drawn after the data, like a PDF page). */
  ready?: string;
  /** Phones only (sheets that only exist there). */
  mobileOnly?: boolean;
}

/** Demo accounts (local part; the domain is the college's). */
export const ACCOUNT: Record<Exclude<AuditRole, 'public' | 'platform'>, string> = {
  student: 'ananya',
  alumni: 'rahul',
  contributor: 'vikram',
  faculty: 'faculty',
  tpo: 'tpo',
  admin: 'admin',
  unverified: 'newbie',
};

const openPalette = async (page: Page) => {
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').waitFor();
};
const openAccountMenu = async (page: Page) => {
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('dialog').waitFor();
};
const FLAT = { from: '/study', link: 'a[href^="/study/"]', text: /Formal Languages/ };

export const SCREENS: Record<AuditRole, AuditScreen[]> = {
  public: [
    { slug: 'landing', path: '/' },
    { slug: 'sign-in', path: '/sign-in' },
    { slug: 'sign-up', path: '/sign-up' },
    { slug: 'forgot-password', path: '/forgot-password' },
  ],
  student: [
    { slug: 'home', path: '/home' },
    { slug: 'mentors', path: '/mentors' },
    { slug: 'mentor-profile', follow: { from: '/mentors?view=browse', link: 'a[href^="/mentors/"]' } },
    { slug: 'mentorship-requests', path: '/mentorship' },
    { slug: 'sessions', path: '/sessions' },
    { slug: 'messages', path: '/messages' },
    { slug: 'conversation', follow: { from: '/messages', link: 'a[href^="/messages/"]' } },
    { slug: 'jobs', path: '/jobs' },
    {
      slug: 'job',
      follow: {
        from: '/jobs',
        link: 'a[href^="/jobs/"]:not([href="/jobs/new"]):not([href="/jobs/tracker"])',
      },
    },
    { slug: 'tracker', path: '/jobs/tracker' },
    { slug: 'referrals', path: '/referrals' },
    { slug: 'events', path: '/events' },
    { slug: 'event', follow: { from: '/events', link: 'a[href^="/events/"]:not([href="/events/new"])' } },
    { slug: 'roadmaps', path: '/roadmaps' },
    { slug: 'roadmap', path: '/roadmaps/sde-dsa' },
    { slug: 'progress', path: '/progress' },
    { slug: 'rewards', path: '/rewards' },
    { slug: 'leaderboard', path: '/leaderboard' },
    { slug: 'people', path: '/people' },
    { slug: 'profile-view', follow: { from: '/people', link: 'a[href^="/people/"]' } },
    { slug: 'profile-edit', path: '/profile' },
    { slug: 'post', follow: { from: '/home', link: 'a[href^="/posts/"]' } },
    { slug: 'questions', path: '/questions' },
    { slug: 'question', follow: { from: '/questions', link: 'a[href^="/questions/"]' } },
    { slug: 'reels', path: '/reels' },
    { slug: 'saved', path: '/saved' },
    { slug: 'notifications', path: '/notifications' },
    { slug: 'settings', path: '/settings' },
    { slug: 'settings-privacy', path: '/settings/privacy' },
    { slug: 'settings-preferences', path: '/settings/preferences' },
    { slug: 'settings-notifications', path: '/settings/notifications' },
    { slug: 'settings-data', path: '/settings/data' },
    { slug: 'palette', path: '/home', open: openPalette },
    { slug: 'more-sheet', path: '/home', open: openAccountMenu, mobileOnly: true },
    { slug: 'study', path: '/study' },
    { slug: 'study-subject', follow: FLAT },
    { slug: 'study-material', follow: { ...FLAT, then: 'a[href*="/m/"]' }, ready: 'main canvas' },
    { slug: 'study-chat', path: '/study/chat' },
  ],
  alumni: [
    { slug: 'home', path: '/home' },
    { slug: 'mentor-dashboard', path: '/mentor' },
    { slug: 'mentorship-requests', path: '/mentorship' },
    { slug: 'post-job', path: '/jobs/new' },
    { slug: 'event-form', path: '/events/new' },
    { slug: 'roadmap-editor', path: '/roadmaps/new' },
    { slug: 'progress', path: '/progress' },
    { slug: 'referrals', path: '/referrals' },
    { slug: 'wall-of-mentors', path: '/wall-of-mentors' },
    { slug: 'more-sheet', path: '/home', open: openAccountMenu, mobileOnly: true },
  ],
  contributor: [
    { slug: 'home', path: '/home' },
    { slug: 'events', path: '/events' },
  ],
  faculty: [
    { slug: 'home', path: '/home' },
    { slug: 'admin-overview', path: '/admin' },
    { slug: 'admin-moderation', path: '/admin/moderation' },
    { slug: 'admin-mentorship', path: '/admin/mentorship' },
    { slug: 'roadmap-review', path: '/roadmaps/review' },
    { slug: 'study-subjects', path: '/study' },
    { slug: 'study-insights', follow: { ...FLAT, then: 'a[href$="/insights"]' } },
  ],
  tpo: [
    { slug: 'home', path: '/home' },
    { slug: 'admin-analytics', path: '/admin/analytics' },
    { slug: 'admin-job-sources', path: '/admin/job-sources' },
  ],
  admin: [
    { slug: 'home', path: '/home' },
    { slug: 'admin-overview', path: '/admin' },
    { slug: 'admin-users', path: '/admin/users' },
    { slug: 'admin-verification', path: '/admin/verification' },
    { slug: 'admin-imports', path: '/admin/imports' },
    { slug: 'admin-list', path: '/admin/list' },
    { slug: 'admin-moderation', path: '/admin/moderation' },
    { slug: 'admin-rewards', path: '/admin/rewards' },
    { slug: 'admin-sources', path: '/admin/sources' },
    { slug: 'admin-analytics', path: '/admin/analytics' },
    { slug: 'admin-branding', path: '/admin/branding' },
    { slug: 'admin-features', path: '/admin/features' },
    { slug: 'admin-ai', path: '/admin/ai' },
    { slug: 'admin-audit', path: '/admin/audit' },
  ],
  unverified: [
    { slug: 'home', path: '/home' },
    { slug: 'mentors', path: '/mentors' },
    { slug: 'verify', path: '/verify' },
  ],
  platform: [
    { slug: 'tenants', path: '/platform' },
    { slug: 'health', path: '/platform/health' },
    { slug: 'settings', path: '/settings' },
  ],
};

/** Telugu captures (360 px, light, DPIT), as in the audit. */
export const TELUGU: { slug: string; path: string }[] = [
  { slug: 'home', path: '/home' },
  { slug: 'jobs', path: '/jobs' },
  { slug: 'mentors', path: '/mentors' },
  { slug: 'roadmaps', path: '/roadmaps' },
  { slug: 'settings-preferences', path: '/settings/preferences' },
  { slug: 'study', path: '/study' },
];
