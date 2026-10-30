import { describe, expect, it } from 'vitest';
import { checkEligibility, type AcademicFacts, type EligibilityCriteria } from './eligibility.js';

const open: EligibilityCriteria = { branches: [], gradYears: [] };
const rec = (o: Partial<AcademicFacts> = {}): AcademicFacts => ({
  cgpa: 7.5,
  activeBacklogs: 0,
  historyBacklogs: 1,
  tenthPct: 85,
  twelfthPct: 80,
  diplomaPct: null,
  source: 'import',
  verified: true,
  ...o,
});
const cse27 = { branch: 'CSE', gradYear: 2027 };

describe('checkEligibility (B7)', () => {
  it.each([
    ['no criteria: everyone', open, null, cse27, true, []],
    ['branch in the list', { ...open, branches: ['CSE', 'IT'] }, null, cse27, true, []],
    ['branch not in the list', { ...open, branches: ['ECE'] }, null, cse27, false, ['branch']],
    ['batch not in the list', { ...open, gradYears: [2026] }, null, cse27, false, ['gradYear']],
    [
      'no branch on the profile',
      { ...open, branches: ['CSE'] },
      null,
      { branch: null, gradYear: 2027 },
      false,
      ['branch'],
    ],
    ['CGPA at the minimum', { ...open, minCgpa: 7.5 }, rec(), cse27, true, []],
    ['CGPA below the minimum', { ...open, minCgpa: 8 }, rec(), cse27, false, ['cgpa']],
    [
      'active backlogs over the limit',
      { ...open, maxActiveBacklogs: 0 },
      rec({ activeBacklogs: 2 }),
      cse27,
      false,
      ['activeBacklogs'],
    ],
    ['history backlogs at the limit', { ...open, maxHistoryBacklogs: 1 }, rec(), cse27, true, []],
    [
      'history backlogs over the limit',
      { ...open, maxHistoryBacklogs: 0 },
      rec(),
      cse27,
      false,
      ['historyBacklogs'],
    ],
    ['tenth below', { ...open, minTenthPct: 90 }, rec(), cse27, false, ['tenthPct']],
    [
      'diploma stands in for the twelfth',
      { ...open, minTwelfthPct: 70 },
      rec({ twelfthPct: null, diplomaPct: 75 }),
      cse27,
      true,
      [],
    ],
    [
      'neither twelfth nor diploma',
      { ...open, minTwelfthPct: 70 },
      rec({ twelfthPct: null }),
      cse27,
      false,
      ['twelfthPct'],
    ],
    ['missing CGPA fails a CGPA rule', { ...open, minCgpa: 6 }, rec({ cgpa: null }), cse27, false, ['cgpa']],
    ['academic rule, no record', { ...open, minCgpa: 6 }, null, cse27, false, ['noRecord']],
    [
      'academic rule, unverified self-report',
      { ...open, minCgpa: 6 },
      rec({ source: 'self', verified: false }),
      cse27,
      false,
      ['unverifiedRecord'],
    ],
    [
      'verified self-report counts',
      { ...open, minCgpa: 6 },
      rec({ source: 'self', verified: true }),
      cse27,
      true,
      [],
    ],
    [
      'every unmet criterion is listed',
      { branches: ['ECE'], gradYears: [2026], minCgpa: 8, maxActiveBacklogs: 0 },
      rec({ activeBacklogs: 1 }),
      cse27,
      false,
      ['branch', 'gradYear', 'cgpa', 'activeBacklogs'],
    ],
  ] as const)('%s', (_name, criteria, record, profile, eligible, kinds) => {
    const r = checkEligibility(criteria, record, profile);
    expect(r.eligible).toBe(eligible);
    expect(r.reasons.map((x) => x.kind)).toEqual(kinds);
  });

  it('says what the student has and what the drive needs', () => {
    expect(checkEligibility({ ...open, minCgpa: 6.5 }, rec({ cgpa: 6.2 }), cse27).reasons).toEqual([
      { kind: 'cgpa', have: 6.2, need: 6.5 },
    ]);
  });
});
