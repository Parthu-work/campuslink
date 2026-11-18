import { describe, expect, it } from 'vitest';
import type { MentorCard, MentorMatch } from '@campuslink/shared';
import {
  headlineAdds,
  isDemoMentor,
  levelOf,
  matchSentence,
  roleLine,
  shownScore,
  stripDemo,
} from './mentor-text';

// A stand-in for t(): the key and its variables, so the tests read what was asked for.
const t = (key: string, vars?: Record<string, unknown>) =>
  vars
    ? `${key}(${Object.entries(vars)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(',')})`
    : key;
const list = (items: string[]) => items.join(' + ');

const card = (over: Partial<MentorCard> = {}): MentorCard =>
  ({
    userId: 'u1',
    name: 'Demo Alumnus 25-05',
    avatarFileId: null,
    headline: 'DEMO: Data Analyst at Kestrel Analytics (demo)',
    company: 'Kestrel Analytics (demo)',
    jobTitle: 'Data Analyst',
    branch: 'CSE',
    gradYear: 2025,
    topics: [],
    skills: [],
    languages: [],
    sessionTypes: [],
    open: true,
    companyVerified: false,
    ...over,
  }) as MentorCard;

describe('how a senior is described (prompt 3, U6)', () => {
  it('says the role once and the demo label once', () => {
    expect(stripDemo('DEMO: Data Analyst at Kestrel')).toBe('Data Analyst at Kestrel');
    expect(stripDemo('Kestrel Analytics (demo)')).toBe('Kestrel Analytics');
    expect(roleLine(card(), t)).toBe('mentoring.roleAt(title=Data Analyst,company=Kestrel Analytics)');
    expect(roleLine(card({ company: '' }), t)).toBe('Data Analyst');
    // The headline repeats the role, so it is left out; one that adds something stays.
    expect(headlineAdds(card())).toBeNull();
    expect(headlineAdds(card({ headline: 'Mock interviews for backend roles' }))).toBe(
      'Mock interviews for backend roles',
    );
    expect(isDemoMentor(card())).toBe(true);
    expect(
      isDemoMentor(card({ name: 'Rahul Varma', headline: 'SDE', company: 'Nimbus', jobTitle: 'SDE II' })),
    ).toBe(false);
  });

  it('gives strength in words with the reasons first, and a number only when strong and never to a minor', () => {
    const match = (score: number): MentorMatch => ({
      mentor: card(),
      score,
      reasons: [{ kind: 'branch', value: 'CSE' }, { kind: 'fast_reply' }],
    });
    expect(levelOf(82)).toBe('strong');
    expect(levelOf(45)).toBe('good');
    expect(levelOf(12)).toBe('some');
    expect(shownScore(match(82), false)).toBe(82);
    expect(shownScore(match(59), false)).toBeNull();
    expect(shownScore(match(95), true)).toBeNull();
    expect(matchSentence(match(82), t, list)).toBe(
      'mentoring.summary(level=match.level.strong,reasons=mentoring.reason.branch(value=CSE) + mentoring.reason.fast_reply)',
    );
    expect(matchSentence({ ...match(10), reasons: [] }, t, list)).toBe('match.level.some');
  });
});
