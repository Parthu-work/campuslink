import { describe, expect, it } from 'vitest';
import {
  buddyScore,
  circleBody,
  isFirstYear,
  isoWeek,
  nextStepDue,
  studyGroupBody,
} from './schemas/habits.js';

describe('ISO weeks in India time (prompt 2, G7)', () => {
  it('numbers weeks the ISO way, across year ends', () => {
    expect(isoWeek(new Date('2026-01-01T06:00:00Z'))).toBe('2026-W01'); // a Thursday
    expect(isoWeek(new Date('2026-11-06T06:00:00Z'))).toBe('2026-W45');
    expect(isoWeek(new Date('2027-01-01T06:00:00Z'))).toBe('2026-W53'); // 2026 has 53 weeks
    expect(isoWeek(new Date('2024-12-30T06:00:00Z'))).toBe('2025-W01'); // a Monday in week 1
    expect(isoWeek(new Date('2021-01-03T06:00:00Z'))).toBe('2020-W53');
  });
  it('uses India time: late Sunday UTC is already Monday', () => {
    expect(isoWeek(new Date('2026-11-08T17:00:00Z'))).toBe('2026-W45'); // Sun 22:30 IST
    expect(isoWeek(new Date('2026-11-08T20:00:00Z'))).toBe('2026-W46'); // Mon 01:30 IST
  });
  it('the Next Step is due from Monday 19:00 IST until the week ends', () => {
    expect(nextStepDue(new Date('2026-11-09T13:29:00Z'))).toBe(false); // Mon 18:59 IST
    expect(nextStepDue(new Date('2026-11-09T13:30:00Z'))).toBe(true); // Mon 19:00 IST
    expect(nextStepDue(new Date('2026-11-12T03:00:00Z'))).toBe(true); // Thursday
    expect(nextStepDue(new Date('2026-11-15T17:00:00Z'))).toBe(true); // Sunday evening
  });
});

describe('the Senior Buddy (prompt 2, G7)', () => {
  const now = new Date('2026-08-20T00:00:00Z');
  it('first-years graduate about four years out; later years do not count', () => {
    expect(isFirstYear(2030, now)).toBe(true);
    expect(isFirstYear(2029, now)).toBe(false);
    expect(isFirstYear(2026, now)).toBe(false);
    expect(isFirstYear(null, now)).toBe(false);
  });
  it('prefers the same branch, then a shared language, then the least busy senior', () => {
    const junior = { branch: 'CSE', languages: ['te'] };
    const sameBranch = buddyScore(junior, { branch: 'CSE', languages: ['hi'], juniors: 0 });
    const sameLanguage = buddyScore(junior, { branch: 'ECE', languages: ['te'], juniors: 0 });
    const both = buddyScore(junior, { branch: 'CSE', languages: ['te', 'en'], juniors: 0 });
    const busy = buddyScore(junior, { branch: 'CSE', languages: ['te'], juniors: 2 });
    expect(both).toBeGreaterThan(sameBranch);
    expect(sameBranch).toBeGreaterThan(sameLanguage);
    expect(both).toBeGreaterThan(busy);
  });
});

describe('circles and study groups (prompt 2, G7)', () => {
  it('a batch circle needs its year and a branch circle its branch', () => {
    expect(circleBody.safeParse({ name: 'Class of 2027', kind: 'batch' }).success).toBe(false);
    expect(circleBody.safeParse({ name: 'Class of 2027', kind: 'batch', gradYear: 2027 }).success).toBe(true);
    expect(circleBody.safeParse({ name: 'CSE circle', kind: 'branch' }).success).toBe(false);
    expect(circleBody.safeParse({ name: 'Robotics club', kind: 'club' }).success).toBe(true);
  });
  it('a study group names its subject', () => {
    expect(studyGroupBody.safeParse({ name: 'Automata group' }).success).toBe(false);
    expect(
      studyGroupBody.safeParse({ name: 'Automata group', subjectId: '0123456789abcdef01234567' }).success,
    ).toBe(true);
  });
});
