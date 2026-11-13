import { Role, ROLE_PERMISSIONS, type Permission } from './roles.js';
import type { Feature } from './features.js';
import { inFinalYears, inFirstYear } from './constants/placements.js';

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
  | 'placements'
  | 'outcomes'
  | 'resume'
  | 'interviews'
  | 'readiness'
  | 'practice'
  | 'peers'
  | 'circles'
  | 'share'
  | 'captain'
  | 'companies'
  | 'copilot'
  | 'network'
  | 'recruiter'
  | 'employers'
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
  | 'alumni'
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
  | 'traction'
  | 'billing'
  | 'health'
  | 'help'
  | 'platformSupport';

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
  'alumni:recognise',
  'giving:manage',
  'imports:manage',
  'onboarding:manage',
  'verification:review',
  'tenant:branding',
  'tenant:settings',
  'ai:settings',
  'audit:read',
  'placements:manage',
  'outcomes:verify',
  'support:manage',
  'readiness:board',
];

/** The admin area's sections, grouped (desktop side menu, phone overview). Each needs one permission. */
export type AdminGroup = 'people' | 'placements' | 'community' | 'insights' | 'college';
export type AdminSectionId =
  | 'users'
  | 'verification'
  | 'imports'
  | 'list'
  | 'onboarding'
  | 'placements'
  | 'offers'
  | 'interviewQuestions'
  | 'readiness'
  | 'practiceBank'
  | 'peers'
  | 'circles'
  | 'growth'
  | 'signIn'
  | 'experiences'
  | 'network'
  | 'reports'
  | 'moderation'
  | 'mentorship'
  | 'sources'
  | 'jobSources'
  | 'rewards'
  | 'recognition'
  | 'giving'
  | 'analytics'
  | 'branding'
  | 'features'
  | 'ai'
  | 'billing'
  | 'support'
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
  section('placements', '/admin/placements', 'placements:manage', 'placements'),
  section('offers', '/admin/offers', 'outcomes:verify', 'placements'),
  // The mock interview question bank and its review queue (prompt 2, G3).
  section('interviewQuestions', '/admin/interview-questions', 'interviews:review', 'placements'),
  // The readiness board (prompt 2, G5): distribution, students who need help, nudges.
  section('readiness', '/admin/readiness', 'readiness:board', 'placements'),
  // The practice bank, its review queue and topic mastery by batch (prompt 2, G4).
  section('practiceBank', '/admin/practice', 'practice:review', 'placements'),
  section('moderation', '/admin/moderation', 'moderation:act', 'community'),
  section('mentorship', '/admin/mentorship', 'mentorship:oversee', 'community'),
  section('sources', '/admin/sources', 'sources:manage', 'community'),
  section('jobSources', '/admin/job-sources', 'jobs:sources', 'community'),
  section('rewards', '/admin/rewards', 'rewards:manage', 'community'),
  // Alumni of the month and certificates; funds and pledges (prompt 2, G6).
  section('recognition', '/admin/recognition', 'alumni:recognise', 'community'),
  section('giving', '/admin/giving', 'giving:manage', 'community'),
  // Peer mentor nominations and buddy matching; circles awaiting approval (prompt 2, G7).
  section('peers', '/admin/peers', 'peers:manage', 'people'),
  section('circles', '/admin/circles', 'circles:manage', 'community'),
  // Member invites and the public outcomes page (prompt 2, G8).
  section('growth', '/admin/growth', 'onboarding:manage', 'people'),
  // Sign-in with the college's Google Workspace or Microsoft Entra ID accounts (prompt 2, G9).
  section('signIn', '/admin/sign-in', 'tenant:settings', 'college'),
  // Interview write-ups waiting for review (prompt 2, G10).
  section('experiences', '/admin/experiences', 'experiences:review', 'placements'),
  // Cross-college network: switches, postings offered to the college, blocks, credentials (G12).
  section('network', '/admin/network', 'network:manage', 'placements'),
  section('analytics', '/admin/analytics', 'analytics:cohort', 'insights'),
  section('reports', '/admin/reports', 'analytics:tenant', 'insights'),
  section('branding', '/admin/branding', 'tenant:branding', 'college'),
  section('features', '/admin/features', 'tenant:settings', 'college'),
  section('ai', '/admin/ai', 'ai:settings', 'college'),
  // Plan, seats, usage against allowances and invoices (B10).
  section('billing', '/admin/billing', 'tenant:settings', 'college'),
  // Problem reports members sent to the college (B14).
  section('support', '/admin/support', 'support:manage', 'college'),
  section('audit', '/admin/audit', 'audit:read', 'college'),
];
const ADMIN_GROUPS: readonly AdminGroup[] = ['people', 'placements', 'community', 'insights', 'college'];

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
  placements: d('placements', '/placements', 'explore', ['placements:view', 'placements:manage']),
  // Offers, higher studies, exams and ventures (B8): students and alumni report their own.
  outcomes: d('outcomes', '/outcomes', 'you', ['outcomes:report']),
  // Résumé builder, ATS check and alumni review (prompt 2, G2).
  resume: d('resume', '/resume', 'you', ['resumes:manage']),
  // AI mock interviews with human follow-up (prompt 2, G3).
  interviews: d('interviews', '/interviews', 'you', ['interviews:practice']),
  // Placement readiness: the score and its next steps (prompt 2, G5).
  readiness: d('readiness', '/readiness', 'you', ['readiness:view']),
  // Aptitude and coding practice (prompt 2, G4).
  practice: d('practice', '/practice', 'you', ['practice:use']),
  // Peer mentoring and the Senior Buddy (prompt 2, G7).
  peers: d('peers', '/peers', 'you', ['peers:enroll']),
  // Circles: batch, branch, club and interest communities (prompt 2, G7).
  circles: d('circles', '/circles', 'community', ['circles:join']),
  // Opt-in public pages and inviting the batch (prompt 2, G8).
  share: d('share', '/share', 'you', ['share:pages', 'invites:batchmates']),
  // Campus Captains: their class joining, and invites (prompt 2, G8).
  captain: d('captain', '/captain', 'you', ['captains:class']),
  // Company pages from the Placement Graph and the Interview Experience Bank (prompt 2, G10).
  companies: d('companies', '/companies', 'explore', ['companies:view']),
  // The Career Copilot (prompt 2, G11).
  copilot: d('copilot', '/copilot', 'explore', ['copilot:use']),
  // The network (prompt 2, G12): alumni across colleges, intros, credentials.
  network: d('network', '/network', 'you', ['network:discover']),
  // The recruiter portal (employer tenants only).
  recruiter: d('recruiter', '/recruiter', 'main', ['employer:post']),
  // Employer approvals and college clusters (platform).
  employers: d('employers', '/platform/employers', 'platform', ['platform:employers']),
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
  // Micro-asks, certificates, giving and your batch (prompt 2, G6).
  alumni: d('alumni', '/alumni', 'you', ['alumni:help', 'alumni:ask']),
  progress: d('progress', '/progress', 'you'),
  rewards: d('rewards', '/rewards', 'you', ['rewards:redeem']),
  saved: d('saved', '/saved', 'you', ['feed:interact']),
  profile: d('profile', '/profile', 'you'),
  settings: d('settings', '/settings', 'you'),
  verify: d('verify', '/verify', 'you'),
  admin: d('admin', '/admin', 'manage', ADMIN_PERMISSIONS),
  platform: d('platform', '/platform', 'platform', ['platform:tenants']),
  // The cross-college traction view (B9): per-college aggregates only.
  traction: d('traction', '/platform/traction', 'platform', ['platform:tenants']),
  // Plans, subscriptions, invoices and payments (B10).
  billing: d('billing', '/platform/billing', 'platform', ['platform:billing']),
  health: d('health', '/platform/health', 'platform', ['platform:health']),
  // Help centre and problem reports (B14): every member, verified or not.
  help: d('help', '/help', 'you'),
  // Bug reports members sent to the platform (B14).
  platformSupport: d('platformSupport', '/platform/support', 'platform', ['platform:support']),
};

/** Destinations that belong to a feature switch: hidden while the college has it off. */
export const NAV_FEATURE: Partial<Record<NavId, Feature>> = {
  study: 'study',
  assistant: 'study',
  subjects: 'study',
  reels: 'reels',
  following: 'contentSources',
  leaderboard: 'leaderboards',
  placements: 'placements',
  outcomes: 'placements',
  readiness: 'placements',
  peers: 'peerMentors',
  companies: 'placements',
  copilot: 'placements',
};

/** Admin sections that belong to a feature switch. */
export const ADMIN_SECTION_FEATURE: Partial<Record<AdminSectionId, Feature>> = {
  sources: 'contentSources',
  jobSources: 'jobsAggregation',
  ai: 'study',
  placements: 'placements',
  offers: 'placements',
  reports: 'placements',
  readiness: 'placements',
  peers: 'peerMentors',
  experiences: 'placements',
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
export type NavPersona = 'student' | 'alumni' | 'staff' | 'admin' | 'platform' | 'employer';

export function navPersona(roles: readonly Role[]): NavPersona {
  if (roles.includes(Role.SUPER_ADMIN)) return 'platform';
  // Prompt 2, G12: recruiters of an employer tenant (ADR 0014).
  if (roles.includes(Role.EMPLOYER_ADMIN) || roles.includes(Role.RECRUITER)) return 'employer';
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
  // Placements takes the last tab for students in their final two years (then Jobs is in the menu).
  student: [['home'], ['study', 'roadmaps'], ['create'], ['mentors', 'verify'], ['placements', 'jobs']],
  alumni: [['home'], ['requests', 'mentoring'], ['create'], ['mentors'], ['jobs']],
  staff: [['home'], ['subjects', 'roadmaps'], ['create'], ['review', 'admin'], ['jobs']],
  admin: [['home'], ['subjects', 'roadmaps'], ['create'], ['review', 'admin'], ['jobs']],
  platform: [['platform'], ['billing'], ['traction'], ['health'], ['settings']],
  employer: [['recruiter'], ['settings']],
};

/** The avatar menu: everything that is not a tab, grouped, in this order. */
const MENU_ORDER: readonly NavId[] = [
  'verify',
  'placements',
  'jobs',
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
  'alumni',
  'requests',
  'people',
  'reels',
  'following',
  'leaderboard',
  'outcomes',
  'resume',
  'interviews',
  'readiness',
  'practice',
  'peers',
  'circles',
  'share',
  'captain',
  'companies',
  'copilot',
  'network',
  'progress',
  'rewards',
  'saved',
  'messages',
  'notifications',
  'admin',
  'profile',
  'help',
  'platformSupport',
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
  /** Students in their final two years get Placements as a main tab (B7). */
  gradYear?: number | null;
  /** The platform's `NETWORK_ENABLED` switch (ADR 0014): `false` hides every network destination. */
  networkEnabled?: boolean;
}

/** Destinations and admin sections that exist only for the network (ADR 0014). */
export const NETWORK_NAV: readonly NavId[] = ['network', 'recruiter', 'employers'];
export const NETWORK_ADMIN_SECTIONS: readonly AdminSectionId[] = ['network'];

/**
 * Spaces (prompt 3, U2): every persona's navigation is at most five spaces, and every destination
 * and admin section is a section of exactly one of them. The phone's bottom tabs and the desktop
 * sidebar are the spaces; the tab that is lit is the space that owns the current URL.
 */
export type SpaceId =
  | 'home'
  | 'learn'
  | 'mentors'
  | 'career'
  | 'you'
  | 'mentoring'
  | 'jobs'
  | 'community'
  | 'today'
  | 'students'
  | 'placements'
  | 'content'
  | 'college'
  | 'colleges'
  | 'billing'
  | 'traction'
  | 'health'
  | 'settings'
  | 'postings';

/** A section of a space: a destination, or (`admin:`) one of the admin area's sections. */
export type SectionRef = NavId | `admin:${AdminSectionId}`;

interface SpaceSpec {
  id: SpaceId;
  /** A hub space opens on its own screen, which lists its sections; others open on their first one. */
  hub?: string;
  sections: readonly SectionRef[];
}

const COLLEGE_STAFF_SPACES: readonly SpaceSpec[] = [
  { id: 'today', sections: ['admin', 'review', 'home', 'events', 'messages', 'notifications'] },
  {
    id: 'students',
    hub: '/students',
    sections: [
      'admin:onboarding',
      'admin:verification',
      'admin:users',
      'admin:list',
      'admin:imports',
      'admin:growth',
      'admin:readiness',
      'admin:peers',
      'people',
      'mentors',
      'leaderboard',
    ],
  },
  {
    id: 'placements',
    sections: [
      'admin:placements',
      'admin:offers',
      'admin:reports',
      'admin:interviewQuestions',
      'admin:practiceBank',
      'admin:experiences',
      'admin:network',
      'placements',
      'companies',
      'jobs',
      'referrals',
      'outcomes',
      'network',
    ],
  },
  {
    id: 'content',
    hub: '/content',
    sections: [
      'subjects',
      'study',
      'assistant',
      'roadmaps',
      'questions',
      'admin:moderation',
      'admin:mentorship',
      'admin:sources',
      'admin:jobSources',
      'admin:circles',
      'admin:recognition',
      'admin:giving',
      'admin:rewards',
      'circles',
      'reels',
      'following',
      'requests',
      'sessions',
      'mentoring',
      'alumni',
      'peers',
    ],
  },
  {
    id: 'college',
    hub: '/college',
    sections: [
      'admin:analytics',
      'admin:branding',
      'admin:features',
      'admin:signIn',
      'admin:ai',
      'admin:billing',
      'admin:support',
      'admin:audit',
      'verify',
      'profile',
      'progress',
      'rewards',
      'saved',
      'resume',
      'interviews',
      'practice',
      'readiness',
      'copilot',
      'share',
      'captain',
      'settings',
      'help',
    ],
  },
];

/** The spaces of each persona, in tab order, with their sections in the order they are listed. */
export const PERSONA_SPACES: Record<NavPersona, readonly SpaceSpec[]> = {
  student: [
    {
      id: 'home',
      sections: [
        'home',
        'events',
        'questions',
        'circles',
        'people',
        'reels',
        'following',
        'saved',
        'leaderboard',
      ],
    },
    { id: 'learn', sections: ['roadmaps', 'study', 'subjects', 'practice', 'assistant', 'copilot'] },
    {
      id: 'mentors',
      sections: ['mentors', 'requests', 'sessions', 'messages', 'alumni', 'peers', 'mentoring'],
    },
    {
      id: 'career',
      sections: [
        'placements',
        'jobs',
        'resume',
        'interviews',
        'readiness',
        'companies',
        'referrals',
        'outcomes',
        'network',
      ],
    },
    {
      id: 'you',
      hub: '/you',
      sections: [
        'verify',
        'profile',
        'progress',
        'rewards',
        'share',
        'captain',
        'notifications',
        'settings',
        'help',
        'review',
        'admin',
      ],
    },
  ],
  alumni: [
    { id: 'home', sections: ['home', 'events', 'reels', 'following', 'saved', 'leaderboard'] },
    {
      id: 'mentoring',
      sections: ['mentoring', 'requests', 'sessions', 'messages', 'alumni', 'mentors', 'peers'],
    },
    { id: 'jobs', sections: ['jobs', 'referrals', 'companies', 'placements', 'network'] },
    {
      id: 'community',
      sections: ['questions', 'circles', 'people', 'roadmaps', 'study', 'subjects', 'assistant'],
    },
    {
      id: 'you',
      hub: '/you',
      sections: [
        'verify',
        'profile',
        'progress',
        'rewards',
        'outcomes',
        'resume',
        'interviews',
        'practice',
        'readiness',
        'copilot',
        'share',
        'captain',
        'notifications',
        'settings',
        'help',
        'review',
        'admin',
      ],
    },
  ],
  staff: COLLEGE_STAFF_SPACES,
  admin: COLLEGE_STAFF_SPACES,
  platform: [
    { id: 'colleges', sections: ['platform', 'employers', 'platformSupport'] },
    { id: 'billing', sections: ['billing'] },
    { id: 'traction', sections: ['traction'] },
    { id: 'health', sections: ['health'] },
    { id: 'settings', sections: ['settings'] },
  ],
  employer: [
    { id: 'postings', sections: ['recruiter'] },
    { id: 'settings', sections: ['settings'] },
  ],
};

/** Screens without a destination of their own, and the destination whose space owns them. */
export const NAV_ALSO: Readonly<Record<string, NavId>> = {
  '/posts': 'home',
  '/experiences': 'companies',
  '/study-groups': 'study',
  '/next-step': 'readiness',
  '/batch': 'alumni',
};

export interface NavSection {
  /** `NavId`, or `admin:` and an admin section's id. Unique within a model. */
  key: SectionRef;
  path: string;
  /**
   * An unverified member's role opens it, but not yet: it is listed so the app keeps its shape, and
   * the screen says "verify first" (audit IA-7).
   */
  locked: boolean;
}

export interface NavSpace {
  id: SpaceId;
  /** Where the space's tab goes: its hub, or its first section. */
  path: string;
  hub: boolean;
  /** The screen that lists every section: the hub, or `/space/<id>` for a space that opens on content. */
  browse: string;
  sections: NavSection[];
}

export interface NavModel {
  persona: NavPersona;
  /** At most five, in tab order; a space with no section left is not listed. */
  spaces: NavSpace[];
  /** The space a member starts in: Career in the final two years, Learn in the first, else the first. */
  landing: SpaceId;
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
    // NETWORK_ENABLED=false (prompt 4, P0): the network is hidden whatever the permissions say.
    if (subject.networkEnabled === false && NETWORK_NAV.includes(id)) return false;
    const dest = NAV_DESTINATIONS[id];
    return shipped.has(id) && may(subject.permissions, dest.permissions);
  };
  // Placements is a tab only for students close to graduating; others find it in the menu.
  const tabUsable = (id: NavId) =>
    usable(id) && (id !== 'placements' || (persona === 'student' && inFinalYears(subject.gradYear)));
  const tabIds: NavId[] = [];
  for (const slot of PERSONA_TABS[persona]) {
    const pick = slot.find((id) => tabUsable(id) && !tabIds.includes(id));
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
      // Main destinations that are not a tab (Jobs for final-year students) sit under Explore.
      items: deduped
        .map((id) => NAV_DESTINATIONS[id])
        .filter((x) => x.group === group || (x.group === 'main' && group === 'explore')),
    }))
    .filter((g) => g.items.length > 0);
  const admin = ADMIN_GROUPS.map((group) => ({
    group,
    items: ADMIN_SECTIONS.filter(
      (x) =>
        x.group === group &&
        subject.permissions.includes(x.permission) &&
        !(subject.networkEnabled === false && NETWORK_ADMIN_SECTIONS.includes(x.id)) &&
        !(
          ADMIN_SECTION_FEATURE[x.id] && subject.features?.[ADMIN_SECTION_FEATURE[x.id] as Feature] === false
        ),
    ),
  })).filter((g) => g.items.length > 0);
  // Spaces. A section is listed when the member may open it, or (not yet verified) when their role
  // will: the screen then says "verify first".
  const roleGrants = subject.verified
    ? []
    : subject.roles.flatMap((r) => (ROLE_PERMISSIONS[r] ?? []) as readonly Permission[]);
  const adminOpen = new Set(admin.flatMap((g) => g.items.map((x) => x.id)));
  const sectionOf = (ref: SectionRef): NavSection | null => {
    if (ref.startsWith('admin:')) {
      const id = ref.slice(6) as AdminSectionId;
      const x = ADMIN_SECTIONS.find((a) => a.id === id);
      return x && adminOpen.has(id) ? { key: ref, path: x.path, locked: false } : null;
    }
    const id = ref as NavId;
    const dest = NAV_DESTINATIONS[id];
    if (usable(id)) return { key: ref, path: dest.path, locked: false };
    const hidden =
      id === 'create' ||
      id === 'verify' ||
      !shipped.has(id) ||
      (subject.networkEnabled === false && NETWORK_NAV.includes(id));
    return !hidden && dest.permissions.length > 0 && may(roleGrants, dest.permissions)
      ? { key: ref, path: dest.path, locked: true }
      : null;
  };
  const spaces: NavSpace[] = [];
  for (const spec of PERSONA_SPACES[persona]) {
    const seen = new Set<string>();
    const sections = spec.sections
      .map(sectionOf)
      .filter((x): x is NavSection => !!x)
      // Study and Subjects open the same library: one entry (the staff one when both are open).
      .filter((x, _i, all) => !(x.key === 'study' && all.some((y) => y.key === 'subjects')))
      .filter((x) => (seen.has(x.path) ? false : (seen.add(x.path), true)));
    const first = sections.find((x) => !x.locked) ?? sections[0];
    if (!first) continue;
    spaces.push({
      id: spec.id,
      path: spec.hub ?? first.path,
      hub: !!spec.hub,
      browse: spec.hub ?? `/space/${spec.id}`,
      sections,
    });
  }
  const has = (id: SpaceId) => spaces.some((x) => x.id === id);
  const landing: SpaceId =
    persona === 'student' && inFinalYears(subject.gradYear) && has('career')
      ? 'career'
      : persona === 'student' && inFirstYear(subject.gradYear) && has('learn')
        ? 'learn'
        : (spaces[0]?.id ?? 'home');
  return { persona, spaces, landing, tabs, menu, create, admin, settings: SETTINGS_SECTIONS };
}

const under = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

/**
 * The space that owns a URL, and the section inside it: the longest section path the URL sits
 * under wins (`/study/chat` is Ask, not Study), then a hub's own path, then the screens in
 * `NAV_ALSO`. Null for a URL no space owns (the caller keeps the last one lit).
 */
export function spaceOf(
  spaces: readonly NavSpace[],
  pathname: string,
): { space: NavSpace; section: NavSection | null } | null {
  let best: { space: NavSpace; section: NavSection | null; length: number } | null = null;
  for (const space of spaces) {
    for (const section of space.sections)
      if (under(pathname, section.path) && section.path.length > (best?.length ?? 0))
        best = { space, section, length: section.path.length };
    if (under(pathname, space.browse) && space.browse.length > (best?.length ?? 0))
      best = { space, section: null, length: space.browse.length };
  }
  if (best) return { space: best.space, section: best.section };
  for (const [root, id] of Object.entries(NAV_ALSO))
    if (under(pathname, root))
      for (const space of spaces) {
        const section = space.sections.find((x) => x.key === id);
        if (section) return { space, section };
      }
  return null;
}

/** Where a member starts: their landing space (after sign-in, and the app's own start URL). */
export function landingPath(model: Pick<NavModel, 'spaces' | 'landing'>, fallback: string): string {
  return model.spaces.find((x) => x.id === model.landing)?.path ?? fallback;
}

/** The desktop sidebar's top level: Create, Search and the spaces. Never more than seven. */
export const SIDEBAR_LIMIT = 7;
export function sidebarEntries(model: Pick<NavModel, 'spaces' | 'create'>, search: boolean): string[] {
  return [
    ...(model.create.length ? ['create'] : []),
    ...(search ? ['search'] : []),
    ...model.spaces.map((x) => x.id),
  ];
}

/** Where a member lands after signing in (and the target of the first tab). */
export function homePath(roles: readonly Role[]): string {
  const persona = navPersona(roles);
  return persona === 'platform' ? '/platform' : persona === 'employer' ? '/recruiter' : '/home';
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
