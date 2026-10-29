import { Role, type Permission } from './roles.js';
import type { Feature } from './features.js';

/**
 * One navigation model for every surface (bottom tabs, desktop rail, avatar menu, Create sheet,
 * command palette). Everything is derived from the member's roles and effective permissions; the
 * web app adds labels and icons. The API still enforces every permission: this is UX only.
 */
export type NavId =
  | 'home'
  | 'study'
  | 'assistant'
  | 'subjects'
  | 'create'
  | 'mentors'
  | 'jobs'
  | 'requests'
  | 'review'
  | 'roadmaps'
  | 'events'
  | 'questions'
  | 'progress'
  | 'sessions'
  | 'messages'
  | 'notifications'
  | 'people'
  | 'referrals'
  | 'mentoring'
  | 'reels'
  | 'following'
  | 'saved'
  | 'leaderboard'
  | 'rewards'
  | 'profile'
  | 'settings'
  | 'admin'
  | 'verify'
  | 'platform'
  | 'health';

export type NavGroup = 'main' | 'explore' | 'community' | 'you' | 'manage' | 'platform';

export interface NavDestination {
  id: NavId;
  path: string;
  /** Any one of these opens the destination. Empty means every signed-in member. */
  permissions: readonly Permission[];
  group: NavGroup;
}

/** Permissions that open the admin area (any one). */
export const ADMIN_PERMISSIONS: readonly Permission[] = [
  'users:read_admin',
  'mentorship:oversee',
  'moderation:act',
  'sources:manage',
  'jobs:sources',
  'analytics:cohort',
  'rewards:manage',
  'imports:manage',
  'onboarding:manage',
  'verification:review',
  'tenant:branding',
  'tenant:settings',
  'ai:settings',
  'audit:read',
];

/** The admin area's sections, grouped (desktop side menu, phone overview). Each needs one permission. */
export type AdminGroup = 'people' | 'community' | 'insights' | 'college';
export type AdminSectionId =
  | 'users'
  | 'verification'
  | 'imports'
  | 'list'
  | 'onboarding'
  | 'moderation'
  | 'mentorship'
  | 'sources'
  | 'jobSources'
  | 'rewards'
  | 'analytics'
  | 'branding'
  | 'features'
  | 'ai'
  | 'audit';
export interface AdminSection {
  id: AdminSectionId;
  path: string;
  permission: Permission;
  group: AdminGroup;
}
const section = (
  id: AdminSectionId,
  path: string,
  permission: Permission,
  group: AdminGroup,
): AdminSection => ({
  id,
  path,
  permission,
  group,
});
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  section('users', '/admin/users', 'users:read_admin', 'people'),
  section('verification', '/admin/verification', 'verification:review', 'people'),
  section('imports', '/admin/imports', 'imports:manage', 'people'),
  section('list', '/admin/list', 'imports:manage', 'people'),
  section('onboarding', '/admin/onboarding', 'onboarding:manage', 'people'),
  section('moderation', '/admin/moderation', 'moderation:act', 'community'),
  section('mentorship', '/admin/mentorship', 'mentorship:oversee', 'community'),
  section('sources', '/admin/sources', 'sources:manage', 'community'),
  section('jobSources', '/admin/job-sources', 'jobs:sources', 'community'),
  section('rewards', '/admin/rewards', 'rewards:manage', 'community'),
  section('analytics', '/admin/analytics', 'analytics:cohort', 'insights'),
  section('branding', '/admin/branding', 'tenant:branding', 'college'),
  section('features', '/admin/features', 'tenant:settings', 'college'),
  section('ai', '/admin/ai', 'ai:settings', 'college'),
  section('audit', '/admin/audit', 'audit:read', 'college'),
];
const ADMIN_GROUPS: readonly AdminGroup[] = ['people', 'community', 'insights', 'college'];

/** The settings area's sections: the same for every member (its tab row). */
export type SettingsSectionId = 'security' | 'privacy' | 'preferences' | 'notifications' | 'data';
export const SETTINGS_SECTIONS: readonly { id: SettingsSectionId; path: string }[] = [
  { id: 'security', path: '/settings' },
  { id: 'privacy', path: '/settings/privacy' },
  { id: 'preferences', path: '/settings/preferences' },
  { id: 'notifications', path: '/settings/notifications' },
  { id: 'data', path: '/settings/data' },
];

/** Permissions that open the staff review queue (any one). */
export const REVIEW_PERMISSIONS: readonly Permission[] = ['moderation:act', 'roadmaps:review'];

const d = (
  id: NavId,
  path: string,
  group: NavGroup,
  permissions: readonly Permission[] = [],
): NavDestination => ({ id, path, group, permissions });

export const NAV_DESTINATIONS: Record<NavId, NavDestination> = {
  home: d('home', '/home', 'main'),
  study: d('study', '/study', 'explore', ['study:read']),
  assistant: d('assistant', '/study/chat', 'explore', ['study:read']),
  // Staff see the same library as "Subjects" (they manage it).
  subjects: d('subjects', '/study', 'explore', ['study:manage']),
  create: d('create', '', 'main'),
  mentors: d('mentors', '/mentors', 'main', ['mentorship:request']),
  jobs: d('jobs', '/jobs', 'main', ['jobs:read']),
  requests: d('requests', '/mentorship', 'explore', ['mentorship:request', 'mentorship:mentor']),
  review: d('review', '/review', 'manage', REVIEW_PERMISSIONS),
  roadmaps: d('roadmaps', '/roadmaps', 'explore', ['roadmaps:read']),
  events: d('events', '/events', 'explore', ['events:rsvp']),
  questions: d('questions', '/questions', 'explore', ['feed:read']),
  sessions: d('sessions', '/sessions', 'explore', ['sessions:book']),
  referrals: d('referrals', '/referrals', 'explore', ['referrals:request', 'referrals:offer']),
  people: d('people', '/people', 'community', ['directory:read']),
  reels: d('reels', '/reels', 'community', ['feed:read']),
  following: d('following', '/following', 'community', ['sources:follow']),
  leaderboard: d('leaderboard', '/leaderboard', 'community', ['directory:read']),
  messages: d('messages', '/messages', 'you', ['messages:send']),
  notifications: d('notifications', '/notifications', 'you'),
  mentoring: d('mentoring', '/mentor', 'you', ['mentorship:mentor']),
  progress: d('progress', '/progress', 'you'),
  rewards: d('rewards', '/rewards', 'you', ['rewards:redeem']),
  saved: d('saved', '/saved', 'you', ['feed:interact']),
  profile: d('profile', '/profile', 'you'),
  settings: d('settings', '/settings', 'you'),
  verify: d('verify', '/verify', 'you'),
  admin: d('admin', '/admin', 'manage', ADMIN_PERMISSIONS),
  platform: d('platform', '/platform', 'platform', ['platform:tenants']),
  health: d('health', '/platform/health', 'platform', ['platform:health']),
};

/** Destinations that belong to a feature switch: hidden while the college has it off. */
export const NAV_FEATURE: Partial<Record<NavId, Feature>> = {
  study: 'study',
  assistant: 'study',
  subjects: 'study',
  reels: 'reels',
  following: 'contentSources',
  leaderboard: 'leaderboards',
};

/** Admin sections that belong to a feature switch. */
export const ADMIN_SECTION_FEATURE: Partial<Record<AdminSectionId, Feature>> = {
  sources: 'contentSources',
  jobSources: 'jobsAggregation',
  ai: 'study',
};

/** The shipped destinations minus those whose feature the college has switched off. */
export function featureShipped(
  shipped: ReadonlySet<NavId>,
  features: Partial<Record<Feature, boolean>> | undefined,
): ReadonlySet<NavId> {
  if (!features) return shipped;
  return new Set(
    [...shipped].filter((id) => {
      const f = NAV_FEATURE[id];
      return !f || features[f] !== false;
    }),
  );
}

/** Which bottom-tab set a member gets. Picked by their most senior role. */
export type NavPersona = 'student' | 'alumni' | 'staff' | 'admin' | 'platform';

export function navPersona(roles: readonly Role[]): NavPersona {
  if (roles.includes(Role.SUPER_ADMIN)) return 'platform';
  if (roles.includes(Role.COLLEGE_ADMIN)) return 'admin';
  if (roles.includes(Role.TPO) || roles.includes(Role.FACULTY)) return 'staff';
  if (roles.includes(Role.ALUMNI)) return 'alumni';
  return 'student';
}

/**
 * Bottom tabs per persona. Each slot lists alternatives in order: the first one the member may open
 * (and the app has shipped) fills the slot, so an unverified member or a missing feature never
 * leaves a dead tab.
 */
export const PERSONA_TABS: Record<NavPersona, readonly (readonly NavId[])[]> = {
  student: [['home'], ['study', 'roadmaps'], ['create'], ['mentors', 'verify'], ['jobs']],
  alumni: [['home'], ['requests', 'mentoring'], ['create'], ['mentors'], ['jobs']],
  staff: [['home'], ['subjects', 'roadmaps'], ['create'], ['review', 'admin'], ['jobs']],
  admin: [['home'], ['subjects', 'roadmaps'], ['create'], ['review', 'admin'], ['jobs']],
  platform: [['platform'], ['health'], ['settings']],
};

/** The avatar menu: everything that is not a tab, grouped, in this order. */
const MENU_ORDER: readonly NavId[] = [
  'verify',
  'roadmaps',
  'events',
  'questions',
  'sessions',
  'referrals',
  'study',
  'subjects',
  'assistant',
  'review',
  'mentoring',
  'requests',
  'people',
  'reels',
  'following',
  'leaderboard',
  'progress',
  'rewards',
  'saved',
  'messages',
  'notifications',
  'admin',
  'profile',
  'settings',
];

export const CREATE_ACTIONS = [
  { id: 'post', path: '/home?compose=text', permissions: ['feed:post'] },
  { id: 'question', path: '/questions?ask=1', permissions: ['qa:ask'] },
  { id: 'event', path: '/events/new', permissions: ['events:create', 'ama:host'] },
  { id: 'job', path: '/jobs/new', permissions: ['jobs:post'] },
  { id: 'roadmap', path: '/roadmaps/new', permissions: ['roadmaps:write'] },
] as const satisfies readonly { id: string; path: string; permissions: readonly Permission[] }[];
export type CreateActionId = (typeof CREATE_ACTIONS)[number]['id'];

export interface NavSubject {
  roles: readonly Role[];
  permissions: readonly Permission[];
  /** Verified members never see the "Verify" entry. */
  verified: boolean;
  /** The college's feature switches: admin sections of a switched-off feature are hidden. */
  features?: Partial<Record<Feature, boolean>>;
}

export interface NavModel {
  persona: NavPersona;
  tabs: NavDestination[];
  /** Grouped destinations for the avatar menu and the desktop rail (tabs excluded). */
  menu: { group: NavGroup; items: NavDestination[] }[];
  create: CreateActionId[];
  /** The admin sections this member may open, grouped (empty without admin access). */
  admin: { group: AdminGroup; items: AdminSection[] }[];
  settings: typeof SETTINGS_SECTIONS;
}

const may = (perms: readonly Permission[], wanted: readonly Permission[]) =>
  wanted.length === 0 || wanted.some((p) => perms.includes(p));

/**
 * @param shipped destinations whose screens exist in this build (lets a tab fall back while a
 *   feature such as Study is still being built).
 */
export function buildNav(subject: NavSubject, shipped: ReadonlySet<NavId>): NavModel {
  const persona = navPersona(subject.roles);
  const create = CREATE_ACTIONS.filter((a) => may(subject.permissions, a.permissions)).map((a) => a.id);
  const usable = (id: NavId) => {
    if (id === 'create') return create.length > 0;
    if (id === 'verify') return !subject.verified;
    const dest = NAV_DESTINATIONS[id];
    return shipped.has(id) && may(subject.permissions, dest.permissions);
  };
  const tabIds: NavId[] = [];
  for (const slot of PERSONA_TABS[persona]) {
    const pick = slot.find((id) => usable(id) && !tabIds.includes(id));
    if (pick) tabIds.push(pick);
  }
  const tabs = tabIds.map((id) => NAV_DESTINATIONS[id]);
  const groups: NavGroup[] = ['explore', 'community', 'you', 'manage', 'platform'];
  const menuIds = MENU_ORDER.filter((id) => usable(id) && !tabIds.includes(id));
  // The study tab and the subjects entry open the same library: show only one of them.
  const deduped = menuIds.filter(
    (id) => !(id === 'study' && (tabIds.includes('subjects') || menuIds.includes('subjects'))),
  );
  const menu = groups
    .map((group) => ({
      group,
      items: deduped.map((id) => NAV_DESTINATIONS[id]).filter((x) => x.group === group),
    }))
    .filter((g) => g.items.length > 0);
  const admin = ADMIN_GROUPS.map((group) => ({
    group,
    items: ADMIN_SECTIONS.filter(
      (x) =>
        x.group === group &&
        subject.permissions.includes(x.permission) &&
        !(
          ADMIN_SECTION_FEATURE[x.id] && subject.features?.[ADMIN_SECTION_FEATURE[x.id] as Feature] === false
        ),
    ),
  })).filter((g) => g.items.length > 0);
  return { persona, tabs, menu, create, admin, settings: SETTINGS_SECTIONS };
}

/** Where a member lands after signing in (and the target of the first tab). */
export function homePath(roles: readonly Role[]): string {
  return navPersona(roles) === 'platform' ? '/platform' : '/home';
}

/** A post-sign-in redirect target is only honoured if it is a same-origin app path. */
export function safeReturnPath(from: unknown): string | null {
  if (typeof from !== 'string' || from.length > 512) return null;
  if (!from.startsWith('/') || from.startsWith('//') || from.startsWith('/\\')) return null;
  if ([...from].some((c) => c.charCodeAt(0) < 0x20)) return null;
  const path = from.split(/[?#]/)[0] ?? '';
  if (['/', '/sign-in', '/sign-up', '/forgot-password', '/reset-password', '/verify-email'].includes(path))
    return null;
  return from;
}
