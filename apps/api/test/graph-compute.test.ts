import { describe, expect, it } from 'vitest';
import { OUTCOME_MATCH, outcomePoints, type PublicProfile } from '@campuslink/shared';
import {
  buildCompanyGraphs,
  buildMentorOutcomes,
  evidenceFor,
  medianBand,
  type DriveRow,
  type GraphInput,
  type OfferRow,
} from '../src/modules/graph/compute.js';
import { scoreMatch } from '../src/modules/mentorship/mentors.service.js';

/** Prompt 2, G10: the Placement Graph and outcome-proven matching as pure functions, on fixtures. */

const day = (iso: string) => new Date(`${iso}T10:00:00Z`);
let seq = 0;
const offer = (o: Partial<OfferRow>): OfferRow => ({
  id: `o${++seq}`,
  userId: `u${seq}`,
  branch: 'CSE',
  gradYear: 2025,
  companyKey: 'nimbus labs',
  companyName: 'Nimbus Labs',
  ctcLpa: 6,
  ctcBand: '5_8',
  type: 'full_time',
  offerDate: day('2025-01-10'),
  ...o,
});
const drive = (o: Partial<DriveRow>): DriveRow => ({
  companyKey: 'nimbus labs',
  companyName: 'Nimbus Labs',
  driveDate: day('2025-01-05'),
  rounds: ['aptitude', 'technical', 'hr'],
  registrations: [],
  ...o,
});
const input = (o: Partial<GraphInput>): GraphInput => ({
  offers: [],
  drives: [],
  referrals: [],
  alumni: [],
  mentors: new Set(),
  sessions: [],
  names: new Map(),
  ...o,
});

describe('the Placement Graph (G10): per-company summaries', () => {
  it('counts distinct students with job offers per batch and branch; internships are not placements', () => {
    const [g] = buildCompanyGraphs(
      input({
        offers: [
          offer({ userId: 'a', branch: 'CSE', gradYear: 2025 }),
          // The same student's second Nimbus offer counts once (the better one is kept).
          offer({ userId: 'a', branch: 'CSE', gradYear: 2025, ctcLpa: 9, ctcBand: '8_12' }),
          offer({ userId: 'b', branch: 'ECE', gradYear: 2025 }),
          offer({ userId: 'c', branch: 'CSE', gradYear: 2024 }),
          offer({ userId: 'd', branch: 'CSE', gradYear: 2025, type: 'internship' }),
          // An erased member's anonymised offer still counts (by its own id).
          offer({ userId: null, branch: 'IT', gradYear: 2024, ctcLpa: null, ctcBand: '3_5' }),
        ],
        names: new Map([['nimbus labs', 'Nimbus Labs Pvt. Ltd.']]),
      }),
    );
    expect(g).toMatchObject({ companyKey: 'nimbus labs', name: 'Nimbus Labs Pvt. Ltd.', offers: 4 });
    expect(g?.batches.map((b) => [b.gradYear, b.offers])).toEqual([
      [2025, 2],
      [2024, 2],
    ]);
    expect(g?.branches).toEqual([
      { branch: 'CSE', offers: 2 },
      { branch: 'ECE', offers: 1 },
      { branch: 'IT', offers: 1 },
    ]);
  });

  it('the median band uses exact CTCs where all are known, else the bands', () => {
    expect(
      medianBand([
        { ctcLpa: 4, ctcBand: '3_5' },
        { ctcLpa: 6, ctcBand: '5_8' },
        { ctcLpa: 30, ctcBand: '20_plus' },
      ]),
    ).toBe('5_8');
    expect(
      medianBand([
        { ctcLpa: 4.5, ctcBand: '3_5' },
        { ctcLpa: 5.5, ctcBand: '5_8' },
      ]),
    ).toBe('5_8');
    expect(
      medianBand([
        { ctcLpa: null, ctcBand: '3_5' },
        { ctcLpa: 7, ctcBand: '5_8' },
        { ctcLpa: 9, ctcBand: '8_12' },
      ]),
    ).toBe('5_8');
    expect(medianBand([])).toBeNull();
  });

  it('rounds: who sat each kind of round and who cleared it, across drives (pending and absent do not count)', () => {
    const [g] = buildCompanyGraphs(
      input({
        drives: [
          drive({
            registrations: [
              {
                userId: 'a',
                branch: 'CSE',
                final: 'selected',
                results: [
                  { round: 0, result: 'cleared' },
                  { round: 1, result: 'cleared' },
                  { round: 2, result: 'cleared' },
                ],
              },
              {
                userId: 'b',
                branch: 'CSE',
                final: 'not_selected',
                results: [
                  { round: 0, result: 'cleared' },
                  { round: 1, result: 'not_cleared' },
                ],
              },
              {
                userId: 'c',
                branch: 'ECE',
                final: 'not_selected',
                results: [{ round: 0, result: 'not_cleared' }],
              },
              { userId: 'd', branch: 'ECE', final: 'in_process', results: [{ round: 0, result: 'absent' }] },
              { userId: 'e', branch: 'ECE', final: 'in_process', results: [{ round: 0, result: 'pending' }] },
            ],
          }),
          drive({
            rounds: ['coding'],
            registrations: [
              { userId: 'f', branch: 'IT', final: 'in_process', results: [{ round: 0, result: 'cleared' }] },
            ],
          }),
          drive({
            rounds: ['shadow' as string],
            registrations: [
              { userId: 'g', branch: 'IT', final: 'in_process', results: [{ round: 0, result: 'cleared' }] },
            ],
          }),
        ],
      }),
    );
    expect(g?.drives).toBe(3);
    expect(g?.rounds).toEqual([
      { kind: 'aptitude', appeared: 3, cleared: 2 },
      { kind: 'coding', appeared: 1, cleared: 1 },
      { kind: 'technical', appeared: 2, cleared: 1 },
      { kind: 'hr', appeared: 1, cleared: 1 },
      { kind: 'other', appeared: 1, cleared: 1 },
    ]);
  });

  it('alumni there, the ones who mentor, their sessions and referrals with reported outcomes', () => {
    const graphs = buildCompanyGraphs(
      input({
        alumni: [
          { userId: 'm1', companyKey: 'nimbus labs', company: 'Nimbus Labs' },
          { userId: 'm2', companyKey: 'nimbus labs', company: 'Nimbus Labs' },
          { userId: 'm3', companyKey: 'orbit', company: 'Orbit' },
        ],
        mentors: new Set(['m1', 'm3']),
        sessions: [
          { mentorId: 'm1', menteeId: 's1', at: day('2025-01-01') },
          { mentorId: 'm1', menteeId: 's2', at: day('2025-01-02') },
          { mentorId: 'm2', menteeId: 's3', at: day('2025-01-02') },
        ],
        referrals: [
          {
            referrerId: 'm1',
            requesterId: 's1',
            company: 'Nimbus Labs Ltd',
            at: day('2025-01-01'),
            outcome: 'interview',
          },
          {
            referrerId: 'm1',
            requesterId: 's2',
            company: 'Nimbus Labs',
            at: day('2025-01-01'),
            outcome: 'offer',
          },
          {
            referrerId: 'm2',
            requesterId: 's3',
            company: 'Nimbus Labs',
            at: day('2025-01-01'),
            outcome: 'rejected',
          },
          {
            referrerId: 'm2',
            requesterId: 's4',
            company: 'Nimbus Labs',
            at: day('2025-01-01'),
            outcome: null,
          },
        ],
      }),
    );
    const nimbus = graphs.find((g) => g.companyKey === 'nimbus labs');
    expect(nimbus).toMatchObject({ alumni: 2, mentors: 1, sessions: 2, offers: 0 });
    expect(nimbus?.referrals).toEqual({ referred: 4, reported: 3, converted: 2 });
    expect(graphs.find((g) => g.companyKey === 'orbit')).toMatchObject({
      alumni: 1,
      mentors: 1,
      sessions: 0,
    });
  });
});

describe('outcome-proven matching (G10): bounded, deterministic', () => {
  const sessions = [
    { mentorId: 'M', menteeId: 'a', at: day('2025-01-01') },
    { mentorId: 'M', menteeId: 'a', at: day('2025-02-01') },
    { mentorId: 'M', menteeId: 'b', at: day('2025-01-01') },
    { mentorId: 'M', menteeId: 'c', at: day('2025-03-01') },
    { mentorId: 'M', menteeId: 'd', at: day('2025-01-01') },
  ];
  const outcomes = buildMentorOutcomes(
    {
      sessions,
      offers: [
        // a: an offer after the first session.
        offer({ userId: 'a', offerDate: day('2025-01-20') }),
        // c: an offer before the session: not the mentor's doing.
        offer({ userId: 'c', offerDate: day('2025-02-01'), companyKey: 'orbit' }),
      ],
      drives: [
        // b: sat the technical round of a drive after the session.
        drive({
          companyKey: 'orbit',
          driveDate: day('2025-01-15'),
          registrations: [
            {
              userId: 'b',
              branch: 'CSE',
              final: 'not_selected',
              results: [
                { round: 0, result: 'cleared' },
                { round: 1, result: 'not_cleared' },
              ],
            },
          ],
        }),
        // d: only cleared the aptitude test: not an interview.
        drive({
          driveDate: day('2025-01-15'),
          registrations: [
            { userId: 'd', branch: 'ECE', final: 'not_selected', results: [{ round: 0, result: 'cleared' }] },
          ],
        }),
      ],
      referrals: [
        // d: a referral after the session that led to an interview.
        { referrerId: 'X', requesterId: 'd', company: 'Quanta', at: day('2025-01-10'), outcome: 'interview' },
        { referrerId: 'M', requesterId: 'z', company: 'Quanta', at: day('2025-01-10'), outcome: 'offer' },
        {
          referrerId: 'M',
          requesterId: 'y',
          company: 'Quanta',
          at: day('2025-01-10'),
          outcome: 'no_response',
        },
      ],
    },
    new Map<string, string | null>([
      ['a', 'CSE'],
      ['b', 'CSE'],
      ['c', 'CSE'],
      ['d', 'ECE'],
    ]),
  );

  it('counts mentees who reached an interview or offer after their first session, and converted referrals', () => {
    const m = outcomes.find((o) => o.mentorId === 'M');
    expect(m?.mentees).toEqual([
      { branch: 'CSE', companyKeys: ['nimbus labs'], reached: 'offer' },
      { branch: 'CSE', companyKeys: ['orbit'], reached: 'interview' },
      { branch: 'ECE', companyKeys: ['quanta'], reached: 'interview' },
    ]);
    expect(m?.referralsConverted).toBe(1);
    // The other referrer only has a converted referral.
    expect(outcomes.find((o) => o.mentorId === 'X')).toEqual({
      mentorId: 'X',
      mentees: [],
      referralsConverted: 1,
    });
  });

  it('evidence is for mentees like the viewer: same branch, else a company they target', () => {
    const m = outcomes.find((o) => o.mentorId === 'M') as (typeof outcomes)[number];
    expect(evidenceFor(m, { branch: 'CSE', targets: new Set() })).toEqual({
      mentees: 2,
      scope: 'branch',
      referrals: 1,
    });
    expect(evidenceFor(m, { branch: 'ECE', targets: new Set(['quanta', 'orbit']) })).toEqual({
      mentees: 2,
      scope: 'target',
      referrals: 1,
    });
    expect(evidenceFor(m, { branch: 'MECH', targets: new Set() })).toEqual({
      mentees: 0,
      scope: 'branch',
      referrals: 1,
    });
  });

  it('the term is bounded: nothing under two outcomes, +4 a mentee to +12, +3 a referral to +6, +15 at most', () => {
    expect(outcomePoints({ mentees: 1, scope: 'branch', referrals: 1 })).toEqual({
      mentee: 0,
      referral: 0,
      total: 0,
    });
    expect(outcomePoints({ mentees: 2, scope: 'branch', referrals: 0 })).toEqual({
      mentee: 8,
      referral: 0,
      total: 8,
    });
    expect(outcomePoints({ mentees: 3, scope: 'branch', referrals: 2 })).toEqual({
      mentee: 12,
      referral: 6,
      total: 15,
    });
    expect(outcomePoints({ mentees: 50, scope: 'target', referrals: 50 }).total).toBe(OUTCOME_MATCH.cap);
    for (let mentees = 0; mentees < 30; mentees++)
      for (let referrals = 0; referrals < 30; referrals++) {
        const p = outcomePoints({ mentees, scope: 'branch', referrals });
        expect(p.total).toBeGreaterThanOrEqual(0);
        expect(p.total).toBeLessThanOrEqual(OUTCOME_MATCH.cap);
      }
  });

  it('scoreMatch adds the term with a plain-words reason and stays within 0 to 100', () => {
    const mentee = { branch: 'CSE', goals: [], targetCompanies: [], skills: [], languages: [] };
    const mentor = { userId: 'M', name: 'Mentor', fields: { branch: 'ECE' } } as unknown as PublicProfile;
    const plain = scoreMatch(mentee, mentor, { medianReplyHours: null, pending: 0, weeklyCap: 5 });
    const proven = scoreMatch(mentee, mentor, {
      medianReplyHours: null,
      pending: 0,
      weeklyCap: 5,
      outcomes: { mentees: 3, scope: 'branch', referrals: 2 },
    });
    expect(proven.score - plain.score).toBe(15);
    expect(proven.reasons).toEqual([
      { kind: 'outcomes', count: 3, scope: 'branch' },
      { kind: 'referrals', count: 2 },
    ]);
    const weak = scoreMatch(mentee, mentor, {
      medianReplyHours: null,
      pending: 0,
      weeklyCap: 5,
      outcomes: { mentees: 1, scope: 'branch', referrals: 1 },
    });
    expect(weak.score).toBe(plain.score);
    expect(weak.reasons).toEqual([]);
    // A strong match with the term never passes 100.
    const best = scoreMatch(
      {
        branch: 'CSE',
        goals: ['backend', 'dsa', 'sql'],
        targetCompanies: ['Nimbus'],
        skills: ['java', 'go', 'sql'],
        languages: ['telugu'],
      },
      {
        userId: 'N',
        name: 'Best',
        fields: {
          branch: 'CSE',
          company: 'Nimbus',
          topics: ['backend', 'dsa', 'sql'],
          skills: ['java', 'go', 'sql'],
          languages: ['telugu'],
        },
      } as unknown as PublicProfile,
      {
        medianReplyHours: 2,
        pending: 0,
        weeklyCap: 5,
        outcomes: { mentees: 9, scope: 'branch', referrals: 9 },
      },
    );
    expect(best.score).toBe(100);
  });
});
