import { describe, expect, it } from 'vitest';
import {
  buildNav,
  featureShipped,
  homePath,
  NAV_DESTINATIONS,
  NAV_FEATURE,
  safeReturnPath,
  type NavId,
} from './navigation.js';
import {
  FEATURE_KEYS,
  LEGACY_FEATURES,
  NEW_TENANT_FEATURES,
  resolveFeatures,
  type Feature,
} from './features.js';
import { resolvePermissions, Role, UNVERIFIED_PERMISSIONS, type Permission } from './roles.js';

const today = new Set<NavId>(
  (Object.keys(NAV_DESTINATIONS) as NavId[]).filter((id) => !['study', 'subjects', 'review'].includes(id)),
);
const withStudy = new Set<NavId>([...today, 'study', 'subjects', 'review']);

const perms = (roles: Role[], verified = true): Permission[] => [
  ...resolvePermissions({ roles, verified, mfaEnabled: true }),
];
const tabs = (roles: Role[], shipped = today, verified = true) =>
  buildNav({ roles, permissions: perms(roles, verified), verified }, shipped).tabs.map((t) => t.id);

describe('role-aware navigation', () => {
  it('gives each persona its own tabs, with Create in the middle', () => {
    expect(tabs([Role.STUDENT], withStudy)).toEqual(['home', 'study', 'create', 'mentors', 'jobs']);
    expect(tabs([Role.ALUMNI])).toEqual(['home', 'requests', 'create', 'mentors', 'jobs']);
    expect(tabs([Role.FACULTY], withStudy)).toEqual(['home', 'subjects', 'create', 'review', 'jobs']);
    expect(tabs([Role.TPO], withStudy)).toEqual(['home', 'subjects', 'create', 'review', 'jobs']);
    expect(tabs([Role.COLLEGE_ADMIN], withStudy)).toEqual(['home', 'subjects', 'create', 'review', 'jobs']);
    expect(tabs([Role.SUPER_ADMIN])).toEqual(['platform', 'billing', 'traction', 'health', 'settings']);
  });

  it('groups the admin sections a member may open (none for students)', () => {
    const admin = (roles: Role[]) =>
      buildNav({ roles, permissions: perms(roles), verified: true }, today).admin.map((g) => [
        g.group,
        g.items.map((i) => i.id),
      ]);
    expect(admin([Role.COLLEGE_ADMIN])).toEqual([
      ['people', ['users', 'verification', 'imports', 'list', 'onboarding']],
      ['placements', ['placements', 'offers']],
      ['community', ['moderation', 'mentorship', 'sources', 'jobSources', 'rewards']],
      ['insights', ['analytics', 'reports']],
      ['college', ['branding', 'features', 'ai', 'billing', 'audit']],
    ]);
    expect(admin([Role.FACULTY])).toEqual([
      ['community', ['moderation']],
      ['insights', ['analytics']],
    ]);
    expect(admin([Role.STUDENT])).toEqual([]);
  });

  it('gives students in their final two years a Placements tab; others find it in the menu (B7)', () => {
    const now = new Date();
    const nav = (roles: Role[], gradYear: number | null) =>
      buildNav(
        { roles, permissions: perms(roles), verified: true, gradYear },
        new Set([...today, 'placements', 'jobs']),
      );
    const final = nav([Role.STUDENT], now.getUTCFullYear() + 1);
    expect(final.tabs.map((t) => t.id)).toContain('placements');
    expect(final.menu.flatMap((g) => g.items.map((i) => i.id))).toContain('jobs');
    const first = nav([Role.STUDENT], now.getUTCFullYear() + 4);
    expect(first.tabs.map((t) => t.id)).toContain('jobs');
    expect(first.menu.flatMap((g) => g.items.map((i) => i.id))).toContain('placements');
    const staff = nav([Role.TPO], null);
    expect(staff.tabs.map((t) => t.id)).not.toContain('placements');
    expect(staff.menu.flatMap((g) => g.items.map((i) => i.id))).toContain('placements');
    // Alumni neither register nor see drives.
    expect(nav([Role.ALUMNI], 2015).menu.flatMap((g) => g.items.map((i) => i.id))).not.toContain(
      'placements',
    );
  });

  it('gives every member the same settings sections', () => {
    for (const r of [Role.STUDENT, Role.FACULTY, Role.COLLEGE_ADMIN, Role.SUPER_ADMIN])
      expect(
        buildNav({ roles: [r], permissions: perms([r]), verified: true }, today).settings.map((s) => s.path),
      ).toEqual([
        '/settings',
        '/settings/privacy',
        '/settings/preferences',
        '/settings/notifications',
        '/settings/data',
      ]);
  });

  it('falls back while a destination has not shipped', () => {
    expect(tabs([Role.STUDENT])).toEqual(['home', 'roadmaps', 'create', 'mentors', 'jobs']);
    expect(tabs([Role.FACULTY])).toEqual(['home', 'roadmaps', 'create', 'admin', 'jobs']);
  });

  it('never shows a tab an unverified member cannot open, and offers Verify instead', () => {
    expect(UNVERIFIED_PERMISSIONS).not.toContain('mentorship:request');
    expect(tabs([Role.STUDENT], today, false)).toEqual(['home', 'roadmaps', 'verify', 'jobs']);
  });

  it('puts profile and settings behind the avatar for every tenant role (D4)', () => {
    for (const role of [Role.STUDENT, Role.ALUMNI, Role.FACULTY, Role.TPO, Role.COLLEGE_ADMIN]) {
      const nav = buildNav({ roles: [role], permissions: perms([role]), verified: true }, today);
      const menu = nav.menu.flatMap((g) => g.items.map((i) => i.id));
      expect(menu).toEqual(expect.arrayContaining(['profile', 'settings']));
      // Nothing appears twice, and no tab is repeated in the menu.
      expect(new Set(menu).size).toBe(menu.length);
      for (const t of nav.tabs) expect(menu).not.toContain(t.id);
    }
  });

  it('only lists destinations the member is permitted to open', () => {
    for (const role of [Role.STUDENT, Role.ALUMNI, Role.FACULTY, Role.TPO, Role.COLLEGE_ADMIN]) {
      const p = perms([role]);
      const nav = buildNav({ roles: [role], permissions: p, verified: true }, withStudy);
      for (const item of [...nav.tabs, ...nav.menu.flatMap((g) => g.items)]) {
        if (item.permissions.length) expect(item.permissions.some((x) => p.includes(x))).toBe(true);
      }
    }
    const student = buildNav(
      { roles: [Role.STUDENT], permissions: perms([Role.STUDENT]), verified: true },
      today,
    );
    expect(student.menu.flatMap((g) => g.items.map((i) => i.id))).not.toContain('admin');
    expect(student.create).toEqual(['question']);
  });

  it('sends every role to its own home after sign-in', () => {
    expect(homePath([Role.SUPER_ADMIN])).toBe('/platform');
    for (const r of [Role.STUDENT, Role.ALUMNI, Role.FACULTY, Role.TPO, Role.COLLEGE_ADMIN])
      expect(homePath([r])).toBe('/home');
  });
});

describe('feature switches', () => {
  const off = (f: Feature) => ({ ...LEGACY_FEATURES, [f]: false });
  const nav = (roles: Role[], features: Partial<Record<Feature, boolean>>) =>
    buildNav(
      { roles, permissions: perms(roles), verified: true, features },
      featureShipped(withStudy, features),
    );
  const everywhere = (n: ReturnType<typeof buildNav>) => [
    ...n.tabs.map((t) => t.id),
    ...n.menu.flatMap((g) => g.items.map((i) => i.id)),
  ];

  it('hides every destination of a switched-off feature, for every role', () => {
    for (const [id, f] of Object.entries(NAV_FEATURE) as [NavId, Feature][])
      for (const role of [Role.STUDENT, Role.ALUMNI, Role.FACULTY, Role.COLLEGE_ADMIN]) {
        expect(everywhere(nav([role], off(f)))).not.toContain(id);
      }
  });

  it('falls back to the next tab when Study is off', () => {
    expect(nav([Role.STUDENT], off('study')).tabs.map((t) => t.id)).toEqual([
      'home',
      'roadmaps',
      'create',
      'mentors',
      'jobs',
    ]);
  });

  it('hides the admin sections of a switched-off feature', () => {
    const sections = (f: Feature) =>
      nav([Role.COLLEGE_ADMIN], off(f)).admin.flatMap((g) => g.items.map((i) => i.id));
    expect(sections('study')).not.toContain('ai');
    expect(sections('contentSources')).not.toContain('sources');
    expect(sections('jobsAggregation')).not.toContain('jobSources');
    expect(sections('stories')).toEqual(expect.arrayContaining(['ai', 'sources', 'jobSources']));
  });

  it('starts new colleges focused and keeps what older colleges had', () => {
    expect(NEW_TENANT_FEATURES).toMatchObject({
      stories: false,
      reels: false,
      contentSources: false,
      leaderboards: false,
    });
    for (const f of FEATURE_KEYS)
      if (!['stories', 'reels', 'contentSources', 'leaderboards', 'studentPosting'].includes(f))
        expect(NEW_TENANT_FEATURES[f]).toBe(true);
    expect(resolveFeatures({ stories: false })).toEqual({ ...LEGACY_FEATURES, stories: false });
    expect(resolveFeatures(undefined)).toEqual(LEGACY_FEATURES);
    expect(resolveFeatures({ reels: 'yes' })).toEqual(LEGACY_FEATURES);
  });
});

describe('safeReturnPath', () => {
  it('accepts same-origin app paths', () => {
    expect(safeReturnPath('/posts/abc?x=1#c')).toBe('/posts/abc?x=1#c');
    expect(safeReturnPath('/jobs')).toBe('/jobs');
  });

  it('rejects anything that could leave the app or loop', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example/path',
      '/\\evil.example',
      'javascript:alert(1)',
      '/sign-in',
      '/',
      '/x\n',
      42,
      null,
      `/${'a'.repeat(600)}`,
    ])
      expect(safeReturnPath(bad)).toBeNull();
  });
});
