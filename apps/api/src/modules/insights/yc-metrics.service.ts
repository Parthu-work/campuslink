import { currentGradYear, SMALL_CELL, suppress, type Count } from '@campuslink/shared';
import type { InsightsService, RangeFacts } from './insights.service.js';

/**
 * Prompt 2, G13: the YC metrics pack (docs/build/yc-metrics.md). One college's figures for any
 * date range, from the owning services' count-only methods. Like the analytics dashboard, every
 * count leaves through `suppress()` and every ratio is worked out only from counts that are shown
 * (five or more, or zero). Nothing here names, points to or quotes a member.
 */
export interface YcMetricsDeps {
  insights: Pick<InsightsService, 'rangeFacts'>;
  /** Active, verified members per role. */
  verifiedByRole(): Promise<Record<string, number>>;
  /** Drives held in the range, and registrations against the students each was for. */
  drives(from: Date, to: Date): Promise<{ drives: number; eligible: number; registered: number }>;
  /** The batch on the college's list. */
  roster(gradYear: number): Promise<number>;
  /** The batch's verified job offers on or before a date, and the students holding one. */
  jobOffers(gradYear: number, asOf: Date): Promise<{ offers: number; students: number }>;
  /** Answer requests of the AI chat features (study assistant, Career Copilot) in a range of days. */
  aiQuestions(from: string, to: string): Promise<number>;
  /** WhatsApp messages sent in the range, by last status. */
  whatsapp(from: Date, to: Date): Promise<Record<string, number>>;
}

export interface YcRange {
  /** UTC days, inclusive. */
  from: string;
  to: string;
}

export interface YcCollegeMetrics {
  range: YcRange;
  /** Some member did something in the range. */
  live: boolean;
  /** False when the range starts before the event retention cutoff (only weekly actives remain). */
  eventsComplete: boolean;
  verifiedMembers: { students: Count; alumni: Count; faculty: Count; placementCell: Count; admins: Count };
  weeklyActiveStudents: {
    weeks: { week: string; students: Count; source: 'events' | 'rollup'; partial: boolean }[];
    /** Mean over the complete weeks, rounded and suppressed (null with no complete week). */
    average: Count | null;
  };
  activation: {
    invited: Count;
    signedUp: Count;
    verified: Count;
    matured: Count;
    activated: Count;
    activationPct: number | null;
  };
  week4Retention: { cohort: Count; retained: Count; pct: number | null };
  mentorship: {
    requests: Count;
    sessions: Count;
    conversionPct: number | null;
    medianReplyHours: number | null;
  };
  drives: { run: Count; eligible: Count; registered: Count; registrationPct: number | null };
  offers: {
    gradYear: number;
    finalYears: Count;
    jobOffers: Count;
    studentsPlaced: Count;
    per100: number | null;
    previous: { gradYear: number; asOf: string; finalYears: Count; jobOffers: Count; per100: number | null };
    /** Percentage points against the previous batch at the same point of its season. */
    change: number | null;
  };
  ai: { questions: Count; activeStudents: Count; perActiveStudent: number | null };
  whatsapp: { delivered: Count; read: Count; readPct: number | null };
}

const DAY = 86_400_000;
const shown = (n: number) => n === 0 || n >= SMALL_CELL;
const pct = (part: number, whole: number) =>
  whole > 0 && shown(part) && shown(whole) ? Math.round((1000 * part) / whole) / 10 : null;
const ratio = (part: number, whole: number) =>
  whole > 0 && shown(part) && shown(whole) ? Math.round((100 * part) / whole) / 100 : null;
const median = (xs: number[]) => {
  if (xs.length < SMALL_CELL) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
  return Math.round(m * 10) / 10;
};
const start = (day: string) => new Date(`${day}T00:00:00Z`);
const after = (day: string) => new Date(start(day).getTime() + DAY);

export class YcMetricsService {
  constructor(private readonly d: YcMetricsDeps) {}

  async college(range: YcRange, now = new Date()): Promise<YcCollegeMetrics> {
    const from = start(range.from);
    const until = after(range.to);
    const gradYear = currentGradYear(until);
    const asOf = new Date(Math.min(until.getTime(), now.getTime()));
    const prevAsOf = new Date(asOf);
    prevAsOf.setUTCFullYear(asOf.getUTCFullYear() - 1);
    const [facts, roles, drives, roster, prevRoster, offers, prevOffers, questions, wa] = await Promise.all([
      this.d.insights.rangeFacts(range.from, range.to, now),
      this.d.verifiedByRole(),
      this.d.drives(from, until),
      this.d.roster(gradYear),
      this.d.roster(gradYear - 1),
      this.d.jobOffers(gradYear, asOf),
      this.d.jobOffers(gradYear - 1, prevAsOf),
      this.d.aiQuestions(range.from, range.to),
      this.d.whatsapp(from, until),
    ]);
    const per100 = pct(offers.offers, roster);
    const prevPer100 = pct(prevOffers.offers, prevRoster);
    const complete = facts.weeklyActiveStudents.filter((w) => !w.partial);
    const delivered = wa.delivered ?? 0;
    const read = wa.read ?? 0;
    return {
      range,
      live: facts.activeMembers > 0,
      eventsComplete: facts.complete,
      verifiedMembers: {
        students: suppress(roles.STUDENT ?? 0),
        alumni: suppress(roles.ALUMNI ?? 0),
        faculty: suppress(roles.FACULTY ?? 0),
        placementCell: suppress(roles.TPO ?? 0),
        admins: suppress(roles.COLLEGE_ADMIN ?? 0),
      },
      weeklyActiveStudents: {
        weeks: facts.weeklyActiveStudents.map((w) => ({ ...w, students: suppress(w.students) })),
        average: complete.length ? average(complete.map((w) => w.students)) : null,
      },
      activation: activation(facts),
      week4Retention: {
        cohort: suppress(facts.week4.cohort),
        retained: suppress(facts.week4.retained),
        pct: pct(facts.week4.retained, facts.week4.cohort),
      },
      mentorship: {
        requests: suppress(facts.mentorship.requests),
        sessions: suppress(facts.mentorship.converted),
        conversionPct: pct(facts.mentorship.converted, facts.mentorship.requests),
        medianReplyHours: median(facts.mentorship.replyHours),
      },
      drives: {
        run: suppress(drives.drives),
        eligible: suppress(drives.eligible),
        registered: suppress(drives.registered),
        registrationPct: pct(drives.registered, drives.eligible),
      },
      offers: {
        gradYear,
        finalYears: suppress(roster),
        jobOffers: suppress(offers.offers),
        studentsPlaced: suppress(offers.students),
        per100,
        previous: {
          gradYear: gradYear - 1,
          asOf: prevAsOf.toISOString().slice(0, 10),
          finalYears: suppress(prevRoster),
          jobOffers: suppress(prevOffers.offers),
          per100: prevPer100,
        },
        change: per100 !== null && prevPer100 !== null ? Math.round((per100 - prevPer100) * 10) / 10 : null,
      },
      ai: {
        questions: suppress(questions),
        activeStudents: suppress(facts.activeStudents),
        perActiveStudent: ratio(questions, facts.activeStudents),
      },
      whatsapp: {
        delivered: suppress(delivered),
        read: suppress(read),
        readPct: pct(read, delivered + read),
      },
    };
  }
}

/** The mean of the weekly counts, itself suppressed under five (no single week is revealed by it). */
function average(xs: number[]): Count {
  return suppress(Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));
}

function activation(f: RangeFacts): YcCollegeMetrics['activation'] {
  const a = f.activation;
  return {
    invited: suppress(a.invited),
    signedUp: suppress(a.signedUp),
    verified: suppress(a.verified),
    matured: suppress(a.matured),
    activated: suppress(a.activated),
    activationPct: pct(a.activated, a.matured),
  };
}
