import { describe, expect, it } from 'vitest';
import {
  ADMIN_SECTIONS,
  buildNav,
  featureShipped,
  homePath,
  landingPath,
  NAV_DESTINATIONS,
  NAV_FEATURE,
  PERSONA_SPACES,
  safeReturnPath,
  SIDEBAR_LIMIT,
  sidebarEntries,
  spaceOf,
  type NavId,
  type NavPersona,
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
      ['people', ['users', 'verification', 'imports', 'list', 'onboarding', 'peers', 'growth']],
      [
        'placements',
        ['placements', 'offers', 'interviewQuestions', 'readiness', 'practiceBank', 'experiences', 'network'],
      ],
      [
        'community',
        ['moderation', 'mentorship', 'sources', 'jobSources', 'rewards', 'recognition', 'giving', 'circles'],
      ],
      ['insights', ['analytics', 'reports']],
      ['college', ['signIn', 'branding', 'features', 'ai', 'billing', 'support', 'audit']],
    ]);
    // Faculty review the interview question bank (prompt 2, G3).
    expect(admin([Role.FACULTY])).toEqual([
      ['people', ['peers']],
      ['placements', ['interviewQuestions', 'readiness', 'practiceBank', 'experiences']],
      ['community', ['moderation', 'circles']],
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

describe('readiness (prompt 2, G5)', () => {
  const ids = (roles: Role[]) =>
    buildNav(
      { roles, permissions: perms(roles), verified: true },
      new Set([...today, 'readiness']),
    ).menu.flatMap((g) => g.items.map((i) => i.id));
  it('students find their score in the menu; alumni and staff do not', () => {
    expect(ids([Role.STUDENT])).toContain('readiness');
    expect(ids([Role.ALUMNI])).not.toContain('readiness');
    expect(ids([Role.FACULTY])).not.toContain('readiness');
  });
  it('the board is a placements section for the TPO and faculty, hidden when placements are off', () => {
    const admin = (roles: Role[], features?: { placements: boolean }) =>
      buildNav(
        { roles, permissions: perms(roles), verified: true, ...(features ? { features } : {}) },
        today,
      ).admin.flatMap((g) => g.items.map((i) => i.id));
    expect(admin([Role.TPO])).toContain('readiness');
    expect(admin([Role.FACULTY])).toContain('readiness');
    expect(admin([Role.TPO], { placements: false })).not.toContain('readiness');
    expect(admin([Role.ALUMNI])).not.toContain('readiness');
  });
});
describe('alumni engagement (prompt 2, G6)', () => {
  const menu = (roles: Role[]) =>
    buildNav({ roles, permissions: perms(roles), verified: true }, today).menu.flatMap((g) =>
      g.items.map((i) => i.id),
    );
  const admin = (roles: Role[]) =>
    buildNav({ roles, permissions: perms(roles), verified: true }, today).admin.flatMap((g) =>
      g.items.map((i) => i.id),
    );
  it('students and alumni open Alumni; staff do not', () => {
    expect(menu([Role.STUDENT])).toContain('alumni');
    expect(menu([Role.ALUMNI])).toContain('alumni');
    expect(menu([Role.FACULTY])).not.toContain('alumni');
  });
  it('the TPO runs recognition and giving; faculty do not', () => {
    expect(admin([Role.TPO])).toEqual(expect.arrayContaining(['recognition', 'giving']));
    expect(admin([Role.FACULTY])).not.toContain('giving');
  });
});

// Prompt 4, P0: the platform's NETWORK_ENABLED switch. Keep this rule through navigation rewrites.
describe('the network switch (NETWORK_ENABLED, ADR 0014)', () => {
  const ids = (roles: Role[], networkEnabled?: boolean) => {
    const nav = buildNav(
      {
        roles,
        permissions: perms(roles),
        verified: true,
        ...(networkEnabled === undefined ? {} : { networkEnabled }),
      },
      today,
    );
    return [
      ...nav.tabs.map((t) => t.id),
      ...nav.menu.flatMap((g) => g.items.map((i) => i.id)),
      ...nav.admin.flatMap((g) => g.items.map((i) => `admin:${i.id}`)),
    ];
  };
  it('shows the network destinations while the switch is on or not stated', () => {
    expect(ids([Role.STUDENT])).toContain('network');
    expect(ids([Role.TPO], true)).toContain('admin:network');
    expect(ids([Role.RECRUITER], true)).toContain('recruiter');
  });
  it('hides every network destination when the switch is off, whatever the permissions', () => {
    expect(ids([Role.STUDENT], false)).not.toContain('network');
    expect(ids([Role.ALUMNI], false)).not.toContain('network');
    expect(ids([Role.TPO], false)).not.toContain('admin:network');
    expect(ids([Role.COLLEGE_ADMIN], false)).not.toContain('admin:network');
    expect(ids([Role.RECRUITER], false)).not.toContain('recruiter');
    expect(ids([Role.SUPER_ADMIN], false)).not.toContain('employers');
    // Nothing else moves.
    expect(ids([Role.STUDENT], false)).toEqual(ids([Role.STUDENT]).filter((id) => id !== 'network'));
  });
});

describe('spaces (prompt 3, U2)', () => {
  const all = new Set<NavId>(Object.keys(NAV_DESTINATIONS) as NavId[]);
  const model = (
    roles: Role[],
    o: { verified?: boolean; gradYear?: number; features?: Partial<Record<Feature, boolean>> } = {},
  ) =>
    buildNav(
      {
        roles,
        permissions: perms(roles, o.verified ?? true),
        verified: o.verified ?? true,
        ...(o.gradYear ? { gradYear: o.gradYear } : {}),
        ...(o.features ? { features: o.features } : {}),
      },
      o.features ? featureShipped(all, o.features) : all,
    );
  const ids = (m: ReturnType<typeof model>) => m.spaces.map((x) => x.id);
  const keys = (m: ReturnType<typeof model>, space: string) =>
    m.spaces.find((x) => x.id === space)?.sections.map((x) => x.key) ?? [];
  const COLLEGE: Role[] = [Role.STUDENT, Role.ALUMNI, Role.FACULTY, Role.TPO, Role.COLLEGE_ADMIN];
  const year = new Date().getUTCFullYear();

  it('gives each persona its five spaces, in tab order', () => {
    expect(ids(model([Role.STUDENT]))).toEqual(['home', 'learn', 'mentors', 'career', 'you']);
    expect(ids(model([Role.ALUMNI]))).toEqual(['home', 'mentoring', 'jobs', 'community', 'you']);
    for (const role of [Role.FACULTY, Role.TPO, Role.COLLEGE_ADMIN])
      expect(ids(model([role])), role).toEqual(['today', 'students', 'placements', 'content', 'college']);
    expect(ids(model([Role.SUPER_ADMIN]))).toEqual(['colleges', 'billing', 'traction', 'health', 'settings']);
    expect(ids(model([Role.RECRUITER]))).toEqual(['postings', 'settings']);
  });

  it('puts the sections the brief names in each student space', () => {
    const m = model([Role.STUDENT]);
    expect(keys(m, 'learn')).toEqual(expect.arrayContaining(['roadmaps', 'study', 'practice', 'assistant']));
    expect(keys(m, 'mentors')).toEqual(
      expect.arrayContaining(['mentors', 'requests', 'sessions', 'messages']),
    );
    expect(keys(m, 'career')).toEqual(
      expect.arrayContaining([
        'placements',
        'jobs',
        'resume',
        'interviews',
        'readiness',
        'companies',
        'referrals',
      ]),
    );
    expect(keys(m, 'you')).toEqual(expect.arrayContaining(['profile', 'progress', 'settings', 'help']));
    // The first section is where the tab opens; You opens on its own screen.
    expect(m.spaces.map((x) => x.path)).toEqual(['/home', '/roadmaps', '/mentors', '/placements', '/you']);
  });

  it('gives staff the admin sections as sections of their spaces (no second column)', () => {
    const m = model([Role.COLLEGE_ADMIN]);
    expect(keys(m, 'today')[0]).toBe('admin');
    expect(keys(m, 'students')).toEqual(
      expect.arrayContaining(['admin:onboarding', 'admin:verification', 'admin:readiness']),
    );
    expect(keys(m, 'placements')).toEqual(
      expect.arrayContaining(['admin:placements', 'admin:offers', 'admin:reports']),
    );
    expect(keys(m, 'content')).toEqual(expect.arrayContaining(['roadmaps', 'admin:moderation']));
    expect(keys(m, 'college')).toEqual(
      expect.arrayContaining(['admin:branding', 'admin:billing', 'admin:analytics', 'settings']),
    );
    // Every admin section the member may open is in exactly one space.
    const open = m.admin.flatMap((g) => g.items.map((x) => `admin:${x.id}`));
    const listed = m.spaces
      .flatMap((x) => x.sections.map((y) => y.key))
      .filter((k) => k.startsWith('admin:'));
    expect([...listed].sort()).toEqual([...open].sort());
  });

  it('lists every destination and admin section once per persona, and no path twice', () => {
    for (const persona of ['student', 'alumni', 'staff', 'admin'] as NavPersona[]) {
      const refs = PERSONA_SPACES[persona].flatMap((x) => x.sections);
      expect(new Set(refs).size, persona).toBe(refs.length);
      for (const id of Object.keys(NAV_DESTINATIONS) as NavId[]) {
        const dest = NAV_DESTINATIONS[id];
        if (id === 'create' || dest.group === 'platform' || id === 'recruiter') continue;
        expect(refs, `${persona} is missing ${id}`).toContain(id);
      }
    }
    for (const persona of ['staff', 'admin'] as NavPersona[]) {
      const refs = PERSONA_SPACES[persona].flatMap((x) => x.sections);
      for (const x of ADMIN_SECTIONS)
        expect(refs, `${persona} is missing ${x.id}`).toContain(`admin:${x.id}`);
    }
    for (const role of [...COLLEGE, Role.SUPER_ADMIN]) {
      const paths = model([role]).spaces.flatMap((x) => x.sections.map((y) => y.path));
      expect(new Set(paths).size, role).toBe(paths.length);
    }
  });

  it('only lists what the member may open; nothing another role owns leaks in', () => {
    for (const role of COLLEGE) {
      const p = perms([role]);
      for (const space of model([role]).spaces)
        for (const x of space.sections) {
          expect(x.locked, `${role} ${x.key}`).toBe(false);
          if (x.key.startsWith('admin:')) {
            const a = ADMIN_SECTIONS.find((y) => `admin:${y.id}` === x.key);
            expect(p, x.key).toContain(a?.permission);
          } else {
            const wanted = NAV_DESTINATIONS[x.key as NavId].permissions;
            if (wanted.length)
              expect(
                wanted.some((w) => p.includes(w)),
                `${role} ${x.key}`,
              ).toBe(true);
          }
        }
    }
    expect(keys(model([Role.STUDENT]), 'you')).not.toContain('admin');
  });

  it('keeps all five spaces for a member who is not verified yet, with what waits marked', () => {
    const m = model([Role.STUDENT], { verified: false });
    expect(ids(m)).toEqual(['home', 'learn', 'mentors', 'career', 'you']);
    const mentors = m.spaces.find((x) => x.id === 'mentors');
    expect(mentors?.sections.find((x) => x.key === 'mentors')?.locked).toBe(true);
    // Verify is offered first in You, and only until it is done.
    expect(keys(m, 'you')[0]).toBe('verify');
    expect(keys(model([Role.STUDENT]), 'you')).not.toContain('verify');
    // A minor waiting for a guardian has the same permissions as any unverified member: same shape.
    expect(ids(model([Role.STUDENT], { verified: false, gradYear: year + 4 }))).toEqual(ids(m));
  });

  it('drops the sections of a switched-off feature, and a space with nothing left', () => {
    const off = model([Role.STUDENT], { features: { study: false, placements: false, reels: false } });
    expect(keys(off, 'learn')).not.toContain('study');
    expect(keys(off, 'learn')).not.toContain('assistant');
    expect(keys(off, 'career')).not.toContain('placements');
    expect(keys(off, 'home')).not.toContain('reels');
    expect(off.spaces.find((x) => x.id === 'career')?.path).toBe('/jobs');
    const staff = model([Role.TPO], { features: { placements: false } });
    expect(keys(staff, 'placements')).not.toContain('admin:placements');
    // Every space a model lists has at least one section.
    for (const role of COLLEGE)
      for (const x of model([role]).spaces) expect(x.sections.length).toBeGreaterThan(0);
    // The recruiter has only what an employer host ships.
    const recruiter = buildNav(
      { roles: [Role.RECRUITER], permissions: perms([Role.RECRUITER]), verified: true },
      new Set<NavId>(['recruiter', 'settings']),
    );
    expect(recruiter.spaces.map((x) => x.id)).toEqual(['postings', 'settings']);
  });

  it('starts final-year students in Career, first-years in Learn and everyone else in their first space', () => {
    expect(model([Role.STUDENT], { gradYear: year + 1 }).landing).toBe('career');
    expect(model([Role.STUDENT], { gradYear: year + 4 }).landing).toBe('learn');
    expect(model([Role.STUDENT], { gradYear: year + 3 }).landing).toBe('home');
    expect(model([Role.STUDENT]).landing).toBe('home');
    expect(model([Role.ALUMNI], { gradYear: year - 2 }).landing).toBe('home');
    expect(model([Role.TPO]).landing).toBe('today');
    expect(landingPath(model([Role.STUDENT], { gradYear: year + 1 }), '/home')).toBe('/placements');
    expect(landingPath(model([Role.STUDENT], { gradYear: year + 4 }), '/home')).toBe('/roadmaps');
    expect(landingPath(model([Role.SUPER_ADMIN]), '/home')).toBe('/platform');
  });

  it('knows which space owns a URL (the tab that is lit)', () => {
    const student = model([Role.STUDENT]).spaces;
    const owner = (path: string, spaces = student) => {
      const o = spaceOf(spaces, path);
      return o ? [o.space.id, o.section?.key ?? null] : null;
    };
    expect(owner('/home')).toEqual(['home', 'home']);
    expect(owner('/posts/65f0')).toEqual(['home', 'home']);
    expect(owner('/roadmaps/sde-dsa')).toEqual(['learn', 'roadmaps']);
    // The longest section path wins.
    expect(owner('/study/chat/abc')).toEqual(['learn', 'assistant']);
    expect(owner('/study/65f0/m/1')).toEqual(['learn', 'study']);
    // A prefix is a whole segment: /mentorship is Requests, /mentors/… is Mentors.
    expect(owner('/mentorship')).toEqual(['mentors', 'requests']);
    expect(owner('/mentors/65f0')).toEqual(['mentors', 'mentors']);
    expect(owner('/messages/65f0')).toEqual(['mentors', 'messages']);
    expect(owner('/placements/65f0')).toEqual(['career', 'placements']);
    expect(owner('/companies/nimbus%20labs')).toEqual(['career', 'companies']);
    expect(owner('/experiences/new')).toEqual(['career', 'companies']);
    expect(owner('/jobs/tracker')).toEqual(['career', 'jobs']);
    expect(owner('/readiness')).toEqual(['career', 'readiness']);
    expect(owner('/circles/65f0')).toEqual(['home', 'circles']);
    expect(owner('/settings/privacy')).toEqual(['you', 'settings']);
    expect(owner('/you')).toEqual(['you', null]);
    // Every space has a screen that lists all its sections.
    expect(owner('/space/career')).toEqual(['career', null]);
    expect(model([Role.STUDENT]).spaces.map((s) => s.browse)).toEqual([
      '/space/home',
      '/space/learn',
      '/space/mentors',
      '/space/career',
      '/you',
    ]);
    expect(owner('/nowhere')).toBeNull();
    const admin = model([Role.COLLEGE_ADMIN]).spaces;
    expect(owner('/admin', admin)).toEqual(['today', 'admin']);
    expect(owner('/admin/onboarding', admin)).toEqual(['students', 'admin:onboarding']);
    expect(owner('/admin/placements/65f0', admin)).toEqual(['placements', 'admin:placements']);
    expect(owner('/admin/billing', admin)).toEqual(['college', 'admin:billing']);
    expect(owner('/roadmaps/review', admin)).toEqual(['content', 'roadmaps']);
    const platform = model([Role.SUPER_ADMIN]).spaces;
    expect(owner('/platform/billing/65f0', platform)).toEqual(['billing', 'billing']);
    expect(owner('/platform/employers', platform)).toEqual(['colleges', 'employers']);
  });

  it('never gives a desktop sidebar more than seven entries', () => {
    for (const role of [...COLLEGE, Role.SUPER_ADMIN, Role.RECRUITER]) {
      const entries = sidebarEntries(model([role]), role !== Role.SUPER_ADMIN && role !== Role.RECRUITER);
      expect(entries.length, role).toBeLessThanOrEqual(SIDEBAR_LIMIT);
      expect(model([role]).spaces.length, role).toBeLessThanOrEqual(5);
    }
    expect(sidebarEntries(model([Role.STUDENT]), true)).toEqual([
      'create',
      'search',
      'home',
      'learn',
      'mentors',
      'career',
      'you',
    ]);
  });
});
