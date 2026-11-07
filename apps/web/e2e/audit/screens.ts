import type { Page } from '@playwright/test';

/**
 * The re-audit's screen set: every screen the audit captured (`docs/design/revamp/before/`, same
 * names), plus the screens built since (the admin overview, the AI assistant, Study) and every
 * Prompt 2 screen (G2 to G12, re-audited in G13 into `docs/build/after-2/`). A screen is a path, or a
 * list page whose first matching link is followed (detail pages have seeded ids). `finalyear` is a
 * demo final-year of the demo year (G13) with a résumé, a mock interview, a practice set, a circle
 * and Copilot history; `employer` is the demo employer's recruiter portal (G12).
 */
export type AuditRole =
  | 'public'
  | 'student'
  | 'finalyear'
  | 'alumni'
  | 'contributor'
  | 'faculty'
  | 'tpo'
  | 'admin'
  | 'unverified'
  | 'platform'
  | 'employer';

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
export const ACCOUNT: Record<Exclude<AuditRole, 'public' | 'platform' | 'employer'>, string> = {
  student: 'ananya',
  finalyear: 'demo.student.2703',
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
    // Prompt 2 (G2 to G12).
    { slug: 'placements', path: '/placements' },
    { slug: 'resume', path: '/resume' },
    { slug: 'interviews', path: '/interviews' },
    { slug: 'practice', path: '/practice' },
    { slug: 'readiness', path: '/readiness' },
    { slug: 'next-step', path: '/next-step' },
    { slug: 'peers', path: '/peers' },
    { slug: 'circles', path: '/circles' },
    { slug: 'study-groups', path: '/study-groups' },
    { slug: 'share', path: '/share' },
    { slug: 'companies', path: '/companies' },
    { slug: 'company', follow: { from: '/companies', link: 'main a[href^="/companies/"]', text: /Nimbus/ } },
    { slug: 'experiences', path: '/experiences' },
    { slug: 'experience-new', path: '/experiences/new' },
    { slug: 'copilot', path: '/copilot' },
    { slug: 'network', path: '/network' },
  ],
  finalyear: [
    { slug: 'resume', path: '/resume' },
    { slug: 'resume-editor', follow: { from: '/resume', link: 'main a[href^="/resume/"]' } },
    { slug: 'interviews', path: '/interviews' },
    { slug: 'interview', follow: { from: '/interviews', link: 'main a[href^="/interviews/"]' } },
    { slug: 'practice', path: '/practice' },
    { slug: 'readiness', path: '/readiness' },
    { slug: 'next-step', path: '/next-step' },
    { slug: 'circles', path: '/circles' },
    { slug: 'circle', follow: { from: '/circles', link: 'main a[href^="/circles/"]' } },
    { slug: 'placements', path: '/placements' },
    { slug: 'companies', path: '/companies' },
    { slug: 'company', follow: { from: '/companies', link: 'main a[href^="/companies/"]', text: /Kestrel/ } },
    { slug: 'copilot', path: '/copilot' },
    { slug: 'network', path: '/network' },
    { slug: 'mentors-match', path: '/mentors' },
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
    // Prompt 2 (G6, G10, G12).
    { slug: 'alumni', path: '/alumni' },
    { slug: 'batch', path: '/batch/2019/CSE' },
    { slug: 'experiences', path: '/experiences' },
    { slug: 'experience-new', path: '/experiences/new' },
    { slug: 'companies', path: '/companies' },
    { slug: 'network', path: '/network' },
    { slug: 'share', path: '/share' },
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
    // Prompt 2 (G3, G4, G5, G7, G10).
    { slug: 'admin-interview-questions', path: '/admin/interview-questions' },
    { slug: 'admin-practice', path: '/admin/practice' },
    { slug: 'admin-readiness', path: '/admin/readiness' },
    { slug: 'admin-experiences', path: '/admin/experiences' },
    { slug: 'admin-circles', path: '/admin/circles' },
    { slug: 'admin-peers', path: '/admin/peers' },
  ],
  tpo: [
    { slug: 'home', path: '/home' },
    { slug: 'admin-analytics', path: '/admin/analytics' },
    { slug: 'admin-job-sources', path: '/admin/job-sources' },
    // Prompt 2 (G5, G10) and the placement console they build on.
    { slug: 'admin-placements', path: '/admin/placements' },
    { slug: 'admin-offers', path: '/admin/offers' },
    { slug: 'admin-readiness', path: '/admin/readiness' },
    { slug: 'admin-experiences', path: '/admin/experiences' },
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
    // Prompt 2 (G6, G7, G8, G9, G12).
    { slug: 'admin-recognition', path: '/admin/recognition' },
    { slug: 'admin-giving', path: '/admin/giving' },
    { slug: 'admin-growth', path: '/admin/growth' },
    { slug: 'admin-onboarding', path: '/admin/onboarding' },
    { slug: 'admin-sign-in', path: '/admin/sign-in' },
    { slug: 'admin-network', path: '/admin/network' },
    { slug: 'admin-circles', path: '/admin/circles' },
    { slug: 'admin-peers', path: '/admin/peers' },
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
    // Prompt 2 (G12).
    { slug: 'employers', path: '/platform/employers' },
    { slug: 'traction', path: '/platform/traction' },
  ],
  employer: [
    { slug: 'recruiter', path: '/recruiter' },
    { slug: 'settings', path: '/settings' },
  ],
};

/** Telugu and Hindi captures (360 px, light, DPIT): the audit's screens plus the Prompt 2 ones. */
export const TELUGU: { slug: string; path: string }[] = [
  { slug: 'home', path: '/home' },
  { slug: 'jobs', path: '/jobs' },
  { slug: 'mentors', path: '/mentors' },
  { slug: 'roadmaps', path: '/roadmaps' },
  { slug: 'settings-preferences', path: '/settings/preferences' },
  { slug: 'study', path: '/study' },
  { slug: 'placements', path: '/placements' },
  { slug: 'resume', path: '/resume' },
  { slug: 'interviews', path: '/interviews' },
  { slug: 'practice', path: '/practice' },
  { slug: 'readiness', path: '/readiness' },
  { slug: 'next-step', path: '/next-step' },
  { slug: 'circles', path: '/circles' },
  { slug: 'share', path: '/share' },
  { slug: 'companies', path: '/companies' },
  { slug: 'experience-new', path: '/experiences/new' },
  { slug: 'copilot', path: '/copilot' },
  { slug: 'network', path: '/network' },
];
/** The languages captured besides English (`cl:lang`). */
export const OTHER_LANGS = ['te', 'hi'] as const;
