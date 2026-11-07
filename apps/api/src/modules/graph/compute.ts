import {
  BRANCHES,
  CTC_BANDS,
  OUTCOME_MATCH,
  type OutcomeEvidence,
  ROUND_KINDS,
  ctcBand,
  type Branch,
  type CtcBand,
  type RoundKind,
} from '@campuslink/shared';
import { companyKey } from '../../lib/company.js';
import type { CompanyGraphDoc, MentorOutcomeDoc } from './graph.model.js';

/**
 * The Placement Graph as pure functions over verified records (prompt 2, G10): the service reads
 * the rows through each owning module's service, these build the per-company and per-mentor
 * summaries, and the unit tests run them on fixtures.
 */

export interface OfferRow {
  id: string;
  userId: string | null;
  branch: string | null;
  gradYear: number | null;
  companyKey: string;
  companyName: string;
  ctcLpa: number | null;
  ctcBand: CtcBand;
  type: string;
  offerDate: Date;
}
export interface DriveRow {
  companyKey: string;
  companyName: string;
  driveDate: Date;
  rounds: string[];
  registrations: {
    userId: string | null;
    branch: string | null;
    results: { round: number; result: string }[];
    final: string;
  }[];
}
export interface ReferralRow {
  referrerId: string;
  requesterId: string;
  company: string;
  at: Date;
  outcome: string | null;
}
export interface SessionRow {
  mentorId: string;
  menteeId: string;
  at: Date;
}
export interface GraphInput {
  offers: OfferRow[];
  drives: DriveRow[];
  referrals: ReferralRow[];
  /** Verified alumni who show their company to members. */
  alumni: { userId: string; companyKey: string; company: string }[];
  /** Alumni taking mentoring requests. */
  mentors: ReadonlySet<string>;
  sessions: SessionRow[];
  /** The placement cell's own spelling of company names. */
  names: Map<string, string>;
}

export type CompanyGraph = Omit<CompanyGraphDoc, '_id' | 'day' | 'computedAt'>;

const isBranch = (b: string | null): b is Branch => !!b && (BRANCHES as readonly string[]).includes(b);
const converted = (o: string | null) => o === 'interview' || o === 'offer';
/** Rounds where a student meets an interviewer (an interview, not a test). */
const INTERVIEW_ROUNDS = new Set(['technical', 'hr', 'group_discussion']);
const appeared = (r: string) => r === 'cleared' || r === 'not_cleared';

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** The band of the median offer: exact CTCs where all are known, else the median band. */
export function medianBand(rows: { ctcLpa: number | null; ctcBand: CtcBand }[]): CtcBand | null {
  if (!rows.length) return null;
  const exact = rows.flatMap((r) => (r.ctcLpa === null ? [] : [r.ctcLpa]));
  if (exact.length === rows.length) return ctcBand(median(exact));
  return CTC_BANDS[Math.floor(median(rows.map((r) => CTC_BANDS.indexOf(r.ctcBand))))] ?? null;
}

/** Job offers only (an internship is not a placement), one row per student and company. */
function placements(offers: OfferRow[]): OfferRow[] {
  const best = new Map<string, OfferRow>();
  for (const o of offers) {
    if (o.type === 'internship') continue;
    const k = `${o.companyKey}|${o.userId ?? o.id}`;
    const cur = best.get(k);
    if (!cur || (o.ctcLpa ?? -1) > (cur.ctcLpa ?? -1)) best.set(k, o);
  }
  return [...best.values()];
}

function group<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
}

/** Per-company summaries. Companies with nothing on record are left out. */
export function buildCompanyGraphs(input: GraphInput): CompanyGraph[] {
  const offers = group(placements(input.offers), (o) => o.companyKey);
  const drives = group(input.drives, (d) => d.companyKey);
  const referrals = group(input.referrals, (r) => companyKey(r.company));
  const alumni = group(input.alumni, (a) => a.companyKey);
  const sessionsByMentor = new Map<string, number>();
  for (const s of input.sessions)
    sessionsByMentor.set(s.mentorId, (sessionsByMentor.get(s.mentorId) ?? 0) + 1);

  // Every company the placement cell lists has a page (practice links to it), even with no results yet.
  const keys = new Set([
    ...input.names.keys(),
    ...offers.keys(),
    ...drives.keys(),
    ...referrals.keys(),
    ...alumni.keys(),
  ]);
  const out: CompanyGraph[] = [];
  for (const key of keys) {
    const o = offers.get(key) ?? [];
    const d = drives.get(key) ?? [];
    const r = referrals.get(key) ?? [];
    const a = alumni.get(key) ?? [];
    const name =
      input.names.get(key) ?? o[0]?.companyName ?? d[0]?.companyName ?? a[0]?.company ?? r[0]?.company ?? key;

    const byBatch = group(
      o.filter((x) => x.gradYear !== null),
      (x) => String(x.gradYear),
    );
    const batches = [...byBatch.entries()]
      .map(([y, rows]) => ({ gradYear: Number(y), offers: rows.length, band: medianBand(rows) }))
      .sort((x, y) => y.gradYear - x.gradYear);
    const byBranch = group(
      o.filter((x) => isBranch(x.branch)),
      (x) => x.branch as string,
    );
    const branches = [...byBranch.entries()]
      .map(([branch, rows]) => ({ branch: branch as Branch, offers: rows.length }))
      .sort((x, y) => y.offers - x.offers || x.branch.localeCompare(y.branch));

    const rounds = new Map<RoundKind, { appeared: number; cleared: number }>();
    for (const drive of d)
      drive.rounds.forEach((kind, i) => {
        const k = (ROUND_KINDS as readonly string[]).includes(kind) ? (kind as RoundKind) : 'other';
        const cur = rounds.get(k) ?? { appeared: 0, cleared: 0 };
        for (const reg of drive.registrations) {
          const res = reg.results.find((x) => x.round === i)?.result ?? '';
          if (!appeared(res)) continue;
          cur.appeared += 1;
          if (res === 'cleared') cur.cleared += 1;
        }
        rounds.set(k, cur);
      });

    const mentorsHere = a.filter((x) => input.mentors.has(x.userId));
    out.push({
      companyKey: key,
      name,
      offers: o.length,
      batches,
      branches,
      drives: d.length,
      rounds: ROUND_KINDS.flatMap((kind) => {
        const v = rounds.get(kind);
        return v ? [{ kind, appeared: v.appeared, cleared: v.cleared }] : [];
      }),
      alumni: a.length,
      mentors: mentorsHere.length,
      sessions: mentorsHere.reduce((n, m) => n + (sessionsByMentor.get(m.userId) ?? 0), 0),
      referrals: {
        referred: r.length,
        reported: r.filter((x) => x.outcome !== null).length,
        converted: r.filter((x) => converted(x.outcome)).length,
      },
    });
  }
  return out.sort((x, y) => y.offers - x.offers || y.alumni - x.alumni || x.name.localeCompare(y.name));
}

export type MentorOutcome = Omit<MentorOutcomeDoc, '_id' | 'mentorId' | 'day'> & { mentorId: string };

/**
 * What each mentor's mentees reached after their first completed session together: a verified
 * offer (offer date on or after it), an interview round in a campus drive held after it, or a
 * referral after it that the student said led to an interview or offer. Plus each mentor's own
 * referrals that converted. Branches come from the mentees' profiles.
 */
export function buildMentorOutcomes(
  input: Pick<GraphInput, 'offers' | 'drives' | 'referrals' | 'sessions'>,
  branchOf: Map<string, string | null>,
): MentorOutcome[] {
  const first = new Map<string, Date>();
  for (const s of input.sessions) {
    const k = `${s.mentorId}|${s.menteeId}`;
    const cur = first.get(k);
    if (!cur || s.at < cur) first.set(k, s.at);
  }
  const offersBy = group(
    input.offers.filter((o) => o.userId),
    (o) => o.userId as string,
  );
  const interviewsBy = new Map<string, { companyKey: string; at: Date; offer: boolean }[]>();
  for (const d of input.drives)
    for (const reg of d.registrations) {
      if (!reg.userId) continue;
      const sat = reg.results.some(
        (x) => INTERVIEW_ROUNDS.has(d.rounds[x.round] ?? '') && appeared(x.result),
      );
      if (!sat && reg.final !== 'selected') continue;
      interviewsBy.set(reg.userId, [
        ...(interviewsBy.get(reg.userId) ?? []),
        { companyKey: d.companyKey, at: d.driveDate, offer: reg.final === 'selected' },
      ]);
    }
  const referralsBy = group(
    input.referrals.filter((r) => converted(r.outcome)),
    (r) => r.requesterId,
  );

  const mentees = new Map<string, MentorOutcome['mentees']>();
  for (const [pair, at] of first) {
    const [mentorId, menteeId] = pair.split('|') as [string, string];
    const reached = new Map<string, 'interview' | 'offer'>();
    const mark = (key: string, level: 'interview' | 'offer') => {
      if (!key) return;
      if (reached.get(key) !== 'offer') reached.set(key, level);
    };
    for (const o of offersBy.get(menteeId) ?? []) if (o.offerDate >= at) mark(o.companyKey, 'offer');
    for (const i of interviewsBy.get(menteeId) ?? [])
      if (i.at >= at) mark(i.companyKey, i.offer ? 'offer' : 'interview');
    for (const r of referralsBy.get(menteeId) ?? [])
      if (r.at >= at) mark(companyKey(r.company), r.outcome === 'offer' ? 'offer' : 'interview');
    if (!reached.size) continue;
    const b = branchOf.get(menteeId) ?? null;
    mentees.set(mentorId, [
      ...(mentees.get(mentorId) ?? []),
      {
        branch: isBranch(b) ? b : null,
        companyKeys: [...reached.keys()].sort(),
        reached: [...reached.values()].includes('offer') ? 'offer' : 'interview',
      },
    ]);
  }
  const referred = new Map<string, number>();
  for (const r of input.referrals)
    if (converted(r.outcome)) referred.set(r.referrerId, (referred.get(r.referrerId) ?? 0) + 1);

  const ids = new Set([...mentees.keys(), ...referred.keys()]);
  return [...ids].sort().map((mentorId) => ({
    mentorId,
    mentees: mentees.get(mentorId) ?? [],
    referralsConverted: referred.get(mentorId) ?? 0,
  }));
}

/**
 * The evidence for one viewer: mentees of the viewer's branch, or (when fewer than the minimum)
 * mentees who reached a company the viewer targets. Deterministic; no model.
 */
export function evidenceFor(
  outcome: Pick<MentorOutcome, 'mentees' | 'referralsConverted'>,
  viewer: { branch: string | null; targets: ReadonlySet<string> },
): OutcomeEvidence {
  const branch = viewer.branch ? outcome.mentees.filter((m) => m.branch === viewer.branch).length : 0;
  const target = outcome.mentees.filter((m) => m.companyKeys.some((k) => viewer.targets.has(k))).length;
  const useBranch = branch >= OUTCOME_MATCH.minEvidence || branch >= target;
  return {
    mentees: useBranch ? branch : target,
    scope: useBranch ? 'branch' : 'target',
    referrals: outcome.referralsConverted,
  };
}
