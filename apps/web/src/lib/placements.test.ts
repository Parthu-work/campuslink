import { describe, expect, it } from 'vitest';
import type { DriveView, MyRegistrationView } from '@campuslink/shared';
import { currentRound, drivesForRoles } from './placements';

const rounds: DriveView['rounds'] = [
  { name: 'Online assessment', kind: 'aptitude', at: null },
  { name: 'Technical interview', kind: 'technical', at: null },
  { name: 'HR interview', kind: 'hr', at: null },
];
const reg = (roundResults: MyRegistrationView['roundResults']): MyRegistrationView => ({
  id: 'r',
  status: 'registered',
  final: 'in_process',
  roundResults,
  createdAt: '2026-11-01T00:00:00.000Z',
});

describe('currentRound (prompt 3, U7)', () => {
  it('is the first round without a result', () => {
    expect(currentRound({ rounds, myRegistration: null })).toBe(0);
    expect(currentRound({ rounds, myRegistration: reg([{ round: 0, result: 'cleared' }]) })).toBe(1);
  });

  it('counts a pending result as not done yet', () => {
    const r = reg([
      { round: 0, result: 'cleared' },
      { round: 1, result: 'pending' },
    ]);
    expect(currentRound({ rounds, myRegistration: r })).toBe(1);
  });

  it('stays on the last round once every round has a result', () => {
    const r = reg([0, 1, 2].map((round) => ({ round, result: 'cleared' as const })));
    expect(currentRound({ rounds, myRegistration: r })).toBe(2);
    expect(currentRound({ rounds: [], myRegistration: null })).toBe(0);
  });
});

describe('drivesForRoles (prompt 3, U7)', () => {
  const drive = (title: string, closesInDays: number, open = true) => ({
    registrationOpen: open,
    registrationCloseAt: new Date(
      Date.parse('2026-11-18T00:00:00Z') + closesInDays * 86_400_000,
    ).toISOString(),
    roles: [{ title, ctcMinLpa: null, ctcMaxLpa: null, location: '', type: 'full_time' as const }],
  });

  it('matches a role the path leads to, either way round, ignoring case and the demo marker', () => {
    const swe = drive('Software Engineer', 5);
    const analyst = drive('DEMO: Data Analyst (demo)', 3);
    const civil = drive('Site Engineer', 2);
    const found = drivesForRoles([swe, analyst, civil], ['Backend Developer', 'Software Engineer (Backend)']);
    expect(found).toEqual([{ drive: swe, role: 'Software Engineer' }]);
    expect(drivesForRoles([analyst], ['data analyst']).map((x) => x.role)).toEqual([
      'DEMO: Data Analyst (demo)',
    ]);
  });

  it('only open drives, soonest closing first, at most three', () => {
    const closed = drive('Data Analyst', 1, false);
    const list = [5, 2, 9, 4].map((n) => drive('Data Analyst', n));
    const found = drivesForRoles([closed, ...list], ['Data Analyst']);
    expect(found.map((x) => x.drive)).toEqual([list[1], list[3], list[0]]);
  });

  it('finds nothing for an empty or one-letter role', () => {
    expect(drivesForRoles([drive('Data Analyst', 2)], ['', 'a'])).toEqual([]);
  });
});
