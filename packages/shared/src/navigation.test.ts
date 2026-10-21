import { describe, expect, it } from 'vitest';
import { buildNav, homePath, NAV_DESTINATIONS, safeReturnPath, type NavId } from './navigation.js';
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
    expect(tabs([Role.SUPER_ADMIN])).toEqual(['platform', 'health', 'settings']);
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
