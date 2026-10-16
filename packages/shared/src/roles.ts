/**
 * Roles, capabilities and the permission catalogue. This file is the single source of truth:
 * the API enforces it, the web mirrors it for UX, and docs/permissions.md is generated from it.
 */
export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  COLLEGE_ADMIN: 'COLLEGE_ADMIN',
  TPO: 'TPO',
  FACULTY: 'FACULTY',
  ALUMNI: 'ALUMNI',
  STUDENT: 'STUDENT',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = Object.values(Role);
/** Roles that can exist inside a college tenant. SUPER_ADMIN lives only in the platform tenant. */
export const TENANT_ROLES = ROLES.filter((r) => r !== Role.SUPER_ADMIN);

export const Capability = { CERTIFIED_CONTRIBUTOR: 'CERTIFIED_CONTRIBUTOR' } as const;
export type Capability = (typeof Capability)[keyof typeof Capability];
export const CAPABILITIES = Object.values(Capability);

export const PERMISSIONS = {
  // Feed & content
  'feed:read': 'Browse the college feed',
  'feed:post': 'Publish posts, tips and stories',
  'feed:interact': 'React, comment, save and share',
  'qa:ask': 'Ask questions in moderated Q&A',
  'qa:answer': 'Answer questions in Q&A',
  'content:report': 'Report content or people',
  'sources:follow': 'Follow topics and content sources',
  'sources:manage': 'Add or remove content sources for the college',
  // People
  'directory:read': 'Browse the people directory',
  'profile:visibility': 'Control who can see profile fields',
  // Mentorship
  'mentorship:request': 'Send structured mentorship requests',
  'mentorship:mentor': 'Accept mentees, set availability and request caps',
  'sessions:book': 'Book mentoring sessions',
  'messages:send': 'Message accepted mentors or mentees',
  'ama:host': 'Host AMAs and office hours',
  'mentorship:oversee': 'See mentorship activity and private session feedback',
  // Jobs
  'jobs:read': 'Browse jobs and openings',
  'jobs:save': 'Save jobs and track applications',
  'jobs:post': 'Publish openings',
  'referrals:request': 'Request referrals from alumni',
  'referrals:offer': 'Offer referrals and set referral caps',
  // Roadmaps
  'roadmaps:read': 'View roadmaps',
  'roadmaps:progress': 'Track personal roadmap progress',
  'roadmaps:write': 'Draft and edit roadmaps',
  'roadmaps:review': 'Review and publish roadmaps',
  // Events & announcements
  'events:rsvp': 'RSVP to events',
  'events:create': 'Create events, drives and meetups',
  'announcements:post': 'Post official announcements',
  // Moderation & analytics
  'moderation:act': 'Act on reported content within scope',
  'analytics:cohort': 'View cohort analytics',
  'analytics:tenant': 'View college-wide analytics',
  'reports:export': 'Export reports and data',
  // Administration
  'users:invite': 'Invite users',
  'users:approve': 'Approve pending users',
  'users:read_admin': 'View the admin user list',
  'users:manage': 'Suspend or reactivate users',
  'roles:assign': 'Change user roles',
  'capabilities:grant': 'Grant contributor capabilities',
  'imports:manage': 'Run data imports',
  'verification:review': 'Review verification requests',
  'tenant:branding': 'Change college branding',
  'tenant:settings': 'Change features, limits and permission overrides',
  'audit:read': 'Read the audit log',
  'rewards:manage': 'Manage the rewards catalogue',
  // Platform (super admin only; never grantable through tenant overrides)
  'platform:tenants': 'Create, suspend and configure colleges',
  'platform:health': 'View platform health',
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
export const PLATFORM_PERMISSIONS: readonly Permission[] = ['platform:tenants', 'platform:health'];

const STUDENT: Permission[] = [
  'feed:read',
  'feed:interact',
  'qa:ask',
  'content:report',
  'sources:follow',
  'directory:read',
  'profile:visibility',
  'mentorship:request',
  'sessions:book',
  'messages:send',
  'jobs:read',
  'jobs:save',
  'referrals:request',
  'roadmaps:read',
  'roadmaps:progress',
  'events:rsvp',
];
const ALUMNI: Permission[] = [
  ...STUDENT,
  'feed:post',
  'qa:answer',
  'mentorship:mentor',
  'ama:host',
  'jobs:post',
  'referrals:offer',
  'roadmaps:write',
];
const STAFF: Permission[] = [
  ...STUDENT,
  'feed:post',
  'qa:answer',
  'announcements:post',
  'events:create',
  'jobs:post',
  'roadmaps:write',
  'roadmaps:review',
  'analytics:cohort',
  'moderation:act',
  'users:invite',
  'users:approve',
];
const COLLEGE_ADMIN: Permission[] = ALL_PERMISSIONS.filter((p) => !PLATFORM_PERMISSIONS.includes(p));

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ['platform:tenants', 'platform:health', 'audit:read'],
  COLLEGE_ADMIN,
  TPO: [...STAFF, 'ama:host', 'referrals:offer', 'analytics:tenant', 'reports:export', 'mentorship:oversee'],
  FACULTY: STAFF,
  ALUMNI,
  STUDENT,
};

export const CAPABILITY_PERMISSIONS: Record<Capability, readonly Permission[]> = {
  CERTIFIED_CONTRIBUTOR: ['roadmaps:write'],
};

/** What a user who has not completed college verification may do: read-only, limited. */
export const UNVERIFIED_PERMISSIONS: readonly Permission[] = [
  'feed:read',
  'roadmaps:read',
  'jobs:read',
  'content:report',
];

/** Roles that must have TOTP enabled before any permission is effective. */
export const MFA_REQUIRED_ROLES: readonly Role[] = [Role.SUPER_ADMIN, Role.COLLEGE_ADMIN];

/** Who may assign which roles. Nobody can assign SUPER_ADMIN through the tenant API. */
export const ASSIGNABLE_ROLES: Partial<Record<Role, readonly Role[]>> = {
  COLLEGE_ADMIN: [Role.COLLEGE_ADMIN, Role.TPO, Role.FACULTY, Role.ALUMNI, Role.STUDENT],
};

export interface PermissionOverrides {
  grant?: Partial<Record<Role, Permission[]>>;
  revoke?: Partial<Record<Role, Permission[]>>;
}

export interface PermissionSubject {
  roles: readonly Role[];
  capabilities?: readonly Capability[];
  verified: boolean;
  mfaEnabled: boolean;
}

export function requiresMfa(roles: readonly Role[]): boolean {
  return roles.some((r) => MFA_REQUIRED_ROLES.includes(r));
}

/** Effective permissions = role defaults ± tenant overrides + capabilities, then gated by verification and MFA. */
export function resolvePermissions(
  subject: PermissionSubject,
  overrides: PermissionOverrides = {},
): Set<Permission> {
  if (requiresMfa(subject.roles) && !subject.mfaEnabled) return new Set();
  const out = new Set<Permission>();
  for (const role of subject.roles) {
    const revoked = new Set(overrides.revoke?.[role] ?? []);
    for (const p of ROLE_PERMISSIONS[role]) if (!revoked.has(p)) out.add(p);
    for (const p of overrides.grant?.[role] ?? []) if (!PLATFORM_PERMISSIONS.includes(p)) out.add(p);
  }
  for (const c of subject.capabilities ?? []) for (const p of CAPABILITY_PERMISSIONS[c]) out.add(p);
  if (!subject.verified) for (const p of [...out]) if (!UNVERIFIED_PERMISSIONS.includes(p)) out.delete(p);
  return out;
}

/**
 * Tenant feature toggles that widen role permissions, folded into the overrides:
 * `studentPosting` lets students publish posts and stories (the spec's "students only if admin enables it").
 */
export function effectiveOverrides(
  features: Partial<Record<string, boolean>> | undefined,
  overrides: PermissionOverrides = {},
): PermissionOverrides {
  if (!features?.studentPosting) return overrides;
  const grant = { ...(overrides.grant ?? {}) };
  grant.STUDENT = [...new Set([...(grant.STUDENT ?? []), 'feed:post' as Permission])];
  return { ...overrides, grant };
}
