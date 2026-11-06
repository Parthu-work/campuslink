import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READINESS_WEIGHTS,
  READINESS_COMPONENTS,
  type AtsReport,
  type ReadinessComponentId,
  type ReadinessWeights,
} from '@campuslink/shared';
import { apportion, compose } from '../src/modules/readiness/score.js';
import type { ComponentResult } from '../src/modules/readiness/component.js';
import {
  eligibilityComponent,
  interviewsComponent,
  mentorshipComponent,
  practiceComponent,
  resumeComponent,
  roadmapComponent,
} from '../src/modules/readiness/components/index.js';

/** Prompt 2, G5: the score is a transparent sum; every component's rule, gains and skips. */

const NOW = new Date('2026-11-05T10:00:00Z');
const DAY = 86_400_000;
const ALL = new Set<ReadinessComponentId>(READINESS_COMPONENTS);
const WITHOUT_PRACTICE = new Set<ReadinessComponentId>(READINESS_COMPONENTS.filter((c) => c !== 'practice'));
const r = (fraction: number, next: ComponentResult['next'] = null): ComponentResult => ({
  fraction,
  facts: {},
  next,
});
const M = { userId: 'u1', branch: 'CSE', gradYear: 2027 };

describe('apportion', () => {
  it('gives whole numbers that add up to the total, never above a cap', () => {
    expect(apportion([33.33, 33.33, 33.34], 100)).toEqual([33, 33, 34]);
    expect(apportion([10.6, 20.6, 0], 31)).toEqual([10, 21, 0]);
    expect(apportion([5.5, 5.5], 11, [5, 6])).toEqual([5, 6]);
    expect(apportion([], 0)).toEqual([]);
  });
});

describe('compose (score composition)', () => {
  it('is the sum of weighted components, and the points shown add up to the score', () => {
    const v = compose(
      DEFAULT_READINESS_WEIGHTS,
      ALL,
      {
        resume: r(0.8),
        interviews: r(0.5),
        practice: r(0),
        roadmap: r(1),
        mentorship: r(0.5),
        eligibility: r(1),
      },
      NOW,
    );
    // 25×0.8 + 20×0.5 + 15×0 + 15×1 + 10×0.5 + 15×1 = 20 + 10 + 0 + 15 + 5 + 15 = 65
    expect(v.score).toBe(65);
    expect(v.components.reduce((n, c) => n + c.points, 0)).toBe(65);
    expect(v.components.reduce((n, c) => n + c.max, 0)).toBe(100);
    expect(v.components.find((c) => c.id === 'resume')).toMatchObject({
      points: 20,
      max: 25,
      status: 'scored',
    });
    expect(v.renormalised).toBe(false);
  });

  it('skips an unregistered component (practice before G4) and scales the rest up to 100, saying so', () => {
    const v = compose(
      DEFAULT_READINESS_WEIGHTS,
      WITHOUT_PRACTICE,
      { resume: r(1), interviews: r(1), roadmap: r(1), mentorship: r(1), eligibility: r(1) },
      NOW,
    );
    expect(v.score).toBe(100);
    expect(v.renormalised).toBe(true);
    const practice = v.components.find((c) => c.id === 'practice');
    expect(practice).toMatchObject({ status: 'not_available', points: 0, max: 0 });
    // 25 of the 85 weighted points → 29.4 of 100.
    expect(v.components.find((c) => c.id === 'resume')?.max).toBe(29);
    expect(v.components.reduce((n, c) => n + c.max, 0)).toBe(100);
  });

  it('a component with nothing to measure (no drives with cut-offs) is not applicable and skipped', () => {
    const v = compose(
      DEFAULT_READINESS_WEIGHTS,
      ALL,
      {
        resume: r(0.5),
        interviews: r(0.5),
        practice: r(0.5),
        roadmap: r(0.5),
        mentorship: r(0.5),
        eligibility: null,
      },
      NOW,
    );
    expect(v.components.find((c) => c.id === 'eligibility')?.status).toBe('not_applicable');
    expect(v.score).toBe(50);
    expect(v.renormalised).toBe(true);
  });

  it('a weight of 0 switches a component off without marking the score renormalised', () => {
    const weights: ReadinessWeights = { ...DEFAULT_READINESS_WEIGHTS, mentorship: 0, practice: 0 };
    const v = compose(
      weights,
      WITHOUT_PRACTICE,
      { resume: r(1), interviews: r(0), roadmap: r(0), eligibility: r(0) },
      NOW,
    );
    expect(v.components.find((c) => c.id === 'mentorship')?.status).toBe('off');
    expect(v.components.find((c) => c.id === 'practice')?.status).toBe('off');
    expect(v.renormalised).toBe(false);
    // 25 of 75 → a third.
    expect(v.score).toBe(33);
  });

  it('next steps are ordered by the points they add, capped at what is left, unknown gains last', () => {
    const v = compose(
      DEFAULT_READINESS_WEIGHTS,
      ALL,
      {
        resume: r(0.7, { id: 'fix_resume_issues', count: 2, gain: 0.24 }),
        interviews: r(0, { id: 'do_mock', count: 1, gain: 0.4 / 3 }),
        practice: r(0, { id: 'do_practice', gain: null }),
        roadmap: r(0.95, { id: 'roadmap_steps', count: 1, gain: 0.5 }),
        mentorship: r(1),
        eligibility: r(1),
      },
      NOW,
    );
    expect(v.next.map((a) => [a.component, a.gain])).toEqual([
      ['resume', 6],
      ['interviews', 3],
      ['roadmap', 1],
    ]);
    expect(v.components.find((c) => c.id === 'practice')?.next?.gain).toBeNull();
  });

  it('all components skipped scores 0 rather than dividing by zero', () => {
    const v = compose(DEFAULT_READINESS_WEIGHTS, new Set(), {}, NOW);
    expect(v.score).toBe(0);
    expect(v.components.every((c) => c.max === 0)).toBe(true);
  });
});

const report = (over: Partial<AtsReport> = {}): AtsReport => ({
  score: 70,
  checks: [
    { id: 'name', ok: true, points: 6, earned: 6 },
    { id: 'contact', ok: false, points: 8, earned: 0 },
    { id: 'bullets', ok: false, points: 6, earned: 0 },
  ],
  keywords: { source: 'pasted', matched: ['java', 'sql'], missing: ['spring', 'docker'] },
  gaps: [],
  pages: 1,
  version: 1,
  checkedAt: NOW.toISOString(),
  ...over,
});

describe('components', () => {
  it('résumé: the best ATS score; failed checks are worth their missing points', async () => {
    const c = resumeComponent(
      async () =>
        new Map([
          ['u1', { count: 2, report: report() }],
          ['u2', { count: 1, report: null }],
        ]),
    );
    const out = await c.compute([M, { ...M, userId: 'u2' }, { ...M, userId: 'u3' }], NOW);
    expect(out.get('u1')).toMatchObject({
      fraction: 0.7,
      next: { id: 'fix_resume_issues', count: 2, gain: 0.14 },
    });
    expect(out.get('u2')?.next?.id).toBe('check_resume');
    expect(out.get('u3')).toMatchObject({ fraction: 0, next: { id: 'build_resume', gain: null } });
    // Without a role, parseability is scaled to 100: 14 missing points become 23.3.
    const noRole = await resumeComponent(
      async () => new Map([['u1', { count: 1, report: report({ keywords: null }) }]]),
    ).compute([M], NOW);
    expect(noRole.get('u1')?.next?.gain).toBeCloseTo(14 / 60, 5);
    // All checks pass: the next step is the missing keywords (40 points over the keywords).
    const kw = await resumeComponent(
      async () =>
        new Map([
          ['u1', { count: 1, report: report({ checks: [{ id: 'name', ok: true, points: 6, earned: 6 }] }) }],
        ]),
    ).compute([M], NOW);
    expect(kw.get('u1')?.next).toEqual({ id: 'add_keywords', count: 2, gain: 0.2 });
  });

  it('mock interviews: practice done and the rubric average; one more mock is a certain gain', async () => {
    const scores = (v: number) => ({ clarity: v, structure: v, correctness: null, communication: v });
    const c = interviewsComponent(
      async () =>
        new Map([
          ['u1', [{ at: new Date(NOW.getTime() - 5 * DAY), averages: scores(3) }]],
          [
            'u2',
            [1, 2, 3].map((d) => ({
              at: new Date(NOW.getTime() - d * DAY),
              averages: { clarity: 5, structure: 2, correctness: null, communication: 5 },
            })),
          ],
          // Old sessions keep their average but no longer count as recent practice.
          ['u3', [{ at: new Date(NOW.getTime() - 200 * DAY), averages: scores(5) }]],
        ]),
    );
    const out = await c.compute(
      ['u1', 'u2', 'u3', 'u4'].map((userId) => ({ ...M, userId })),
      NOW,
    );
    // 0.4 × 1/3 + 0.6 × (3−1)/4
    expect(out.get('u1')?.fraction).toBeCloseTo(0.4 / 3 + 0.3, 5);
    expect(out.get('u1')?.next).toEqual({ id: 'do_mock', count: 1, gain: 0.4 / 3 });
    expect(out.get('u2')?.next).toEqual({ id: 'improve_answers', target: 'structure', gain: null });
    expect(out.get('u3')?.fraction).toBeCloseTo(0.6, 5);
    expect(out.get('u4')).toMatchObject({ fraction: 0, next: { id: 'do_mock' } });
  });

  it('roadmap: steps done of the target roadmap; mentorship: two sessions for full points', async () => {
    const rm = await roadmapComponent(
      async () => new Map([['u1', { roadmapId: 'r', slug: 'sde', title: 'SDE', done: 4, total: 10 }]]),
    ).compute([M, { ...M, userId: 'u2' }], NOW);
    expect(rm.get('u1')).toMatchObject({ fraction: 0.4, next: { id: 'roadmap_steps', count: 3, gain: 0.3 } });
    expect(rm.get('u2')?.next?.id).toBe('pick_roadmap');
    const ms = await mentorshipComponent(
      async () =>
        new Map([
          ['u1', 1],
          ['u2', 5],
        ]),
    ).compute([M, { ...M, userId: 'u2' }], NOW);
    expect(ms.get('u1')).toMatchObject({ fraction: 0.5, next: { id: 'book_session', gain: 0.5 } });
    expect(ms.get('u2')).toMatchObject({ fraction: 1, next: null });
  });

  it('eligibility: the share of the college’s cut-offs met, the nearest CGPA that opens more, backlogs', async () => {
    const cutoffs = [
      { branches: ['CSE'], minCgpa: 6, maxActiveBacklogs: null },
      { branches: ['CSE'], minCgpa: 7, maxActiveBacklogs: 0 },
      { branches: [], minCgpa: 7.5, maxActiveBacklogs: null },
      { branches: ['CSE'], minCgpa: 8, maxActiveBacklogs: null },
      { branches: ['ECE'], minCgpa: 9, maxActiveBacklogs: null },
    ];
    const fact = (
      cgpa: number | null,
      activeBacklogs = 0,
      source: 'import' | 'self' = 'import',
      verified = true,
    ) => ({
      cgpa,
      activeBacklogs,
      historyBacklogs: 0,
      tenthPct: null,
      twelfthPct: null,
      diplomaPct: null,
      source,
      verified,
    });
    const c = eligibilityComponent({
      cutoffs: async () => cutoffs,
      academics: async () =>
        new Map([
          ['u1', fact(7.2)],
          ['u2', fact(7.2, 1)],
          ['u3', fact(8, 0, 'self', false)],
        ]),
    });
    const out = await c.compute(
      ['u1', 'u2', 'u3', 'u4'].map((userId) => ({ ...M, userId })),
      NOW,
    );
    // CSE (and every-branch) drives: 4. At 7.2 the member meets 6 and 7: half.
    expect(out.get('u1')).toMatchObject({
      fraction: 0.5,
      facts: { drives: 4, meets: 2 },
      next: { id: 'raise_cgpa', target: '7.5', gain: 0.25 },
    });
    expect(out.get('u2')).toMatchObject({
      fraction: 0.25,
      next: { id: 'clear_backlogs', count: 1, gain: 0.25 },
    });
    expect(out.get('u3')).toMatchObject({ fraction: 0, next: null, facts: { pending: 1 } });
    expect(out.get('u4')).toMatchObject({ fraction: 0, next: { id: 'add_academics' } });
    // No drives set cut-offs: nothing to measure, so not applicable for everyone.
    const none = await eligibilityComponent({
      cutoffs: async () => [],
      academics: async () => new Map(),
    }).compute([M], NOW);
    expect(none.get('u1')).toBeNull();
  });

  it('practice: daily sets done and answer accuracy; one more set is a certain gain', async () => {
    const out = await practiceComponent(
      async () =>
        new Map([
          ['u1', { sets: 4, attempts: 40, right: 30 }],
          ['u2', { sets: 12, attempts: 100, right: 90 }],
        ]),
    ).compute(
      ['u1', 'u2', 'u3'].map((userId) => ({ ...M, userId })),
      NOW,
    );
    // 0.4 × 4/10 + 0.6 × 0.75
    expect(out.get('u1')).toMatchObject({
      facts: { sets: 4, accuracy: 75 },
      next: { id: 'do_practice', gain: 0.04 },
    });
    expect(out.get('u1')?.fraction).toBeCloseTo(0.16 + 0.45, 5);
    expect(out.get('u2')).toMatchObject({ next: null });
    expect(out.get('u2')?.fraction).toBeCloseTo(0.4 + 0.54, 5);
    expect(out.get('u3')).toMatchObject({ fraction: 0, facts: { sets: 0, accuracy: null } });
  });
});
