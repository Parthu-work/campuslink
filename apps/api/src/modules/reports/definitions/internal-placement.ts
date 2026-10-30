import { BRANCHES } from '@campuslink/shared';
import type { OfferRow, ReportData, ReportDefinition, ReportParams } from '../report-data.js';
import {
  col,
  distinct,
  inBranch,
  jobOffers,
  label,
  medianBand,
  programmeCol,
  round,
  shown,
} from './common.js';

/** Exact per-branch figures for one batch (the internal report and the dashboard use them). */
export async function placementFigures(data: ReportData, gradYear: number, p: Pick<ReportParams, 'branch'>) {
  const [roster, seekers, offers] = await Promise.all([
    data.roster([gradYear]),
    data.seekers([gradYear]),
    data.offers([gradYear]),
  ]);
  const jobs = jobOffers(offers);
  const branches = p.branch
    ? [p.branch]
    : [...new Set([...roster.map((r) => r.branch), ...jobs.map((r) => r.branch)])].sort(
        (a, b) =>
          (BRANCHES as readonly (string | null)[]).indexOf(a) -
          (BRANCHES as readonly (string | null)[]).indexOf(b),
      );
  const one = (branch: string | null) => {
    const mine = <T extends { branch: string | null }>(rs: T[]) => rs.filter((r) => r.branch === branch);
    const placedOffers = mine(jobs);
    const placed = new Set(placedOffers.map((r) => r.subject));
    // Seeking: registered for a drive, or placed some other way (an off-campus offer is a search too).
    const seeking = new Set([...mine(seekers).map((r) => r.subject), ...placed]);
    return {
      branch,
      finalYear: mine(roster).reduce((s, r) => s + r.n, 0),
      seeking: seeking.size,
      placed: placed.size,
      offers: placedOffers.length,
      band: medianBand(bestOf(placedOffers)),
    };
  };
  const rows = branches.map(one);
  const all = {
    finalYear: rows.reduce((s, r) => s + r.finalYear, 0),
    seeking: distinct([...inBranch(seekers, p), ...inBranch(jobs, p)], (r) => r.subject),
    placed: distinct(inBranch(jobs, p), (r) => r.subject),
    offers: inBranch(jobs, p).length,
    band: medianBand(bestOf(inBranch(jobs, p))),
    offersRows: inBranch(jobs, p),
  };
  return { rows, all };
}

function bestOf(rows: OfferRow[]) {
  const best = new Map<string, OfferRow>();
  for (const r of rows) {
    const cur = best.get(r.subject);
    if (!cur || (r.ctcLpa ?? 0) > (cur.ctcLpa ?? 0)) best.set(r.subject, r);
  }
  return [...best.values()];
}

export const pct = (part: number, whole: number) =>
  whole > 0 && shown(part) && shown(whole) ? round((100 * part) / whole, 1) : null;

/** Internal: placement by branch (seeking vs placed), offers per student, median band, last year. */
export const internalPlacement: ReportDefinition = {
  id: 'internal-placement',
  framework: 'internal',
  title: 'Placement by branch',
  version: '2026.1',
  sourceNote:
    'Internal measure, not an accreditation format: of the students seeking placement (registered for a drive or placed off campus), how many have a verified job offer, with offers per placed student and the median package band, against the batch before.',
  needsReview: false,
  threeYears: false,
  async compute(data, p, count) {
    const [now, before] = await Promise.all([
      placementFigures(data, p.gradYear, p),
      placementFigures(data, p.gradYear - 1, p),
    ]);
    const last = new Map(before.rows.map((r) => [r.branch, r]));
    const rows = now.rows.map((r) => {
      const prev = last.get(r.branch);
      return {
        programme: r.branch ?? 'Not set',
        finalYear: count(r.finalYear),
        seeking: count(r.seeking),
        placed: count(r.placed),
        placementPct: pct(r.placed, r.seeking),
        offersPerStudent: r.placed && shown(r.placed) ? round(r.offers / r.placed) : null,
        band: r.band,
        lastYearPct: prev ? pct(prev.placed, prev.seeking) : null,
      };
    });
    return {
      columns: [
        programmeCol,
        col('finalYear', 'Final-year students', 'count'),
        col('seeking', 'Seeking placement', 'count'),
        col('placed', 'Placed', 'count'),
        col('placementPct', 'Placement %', 'percent'),
        col('offersPerStudent', 'Offers per placed student', 'number'),
        col('band', 'Median band', 'band'),
        col('lastYearPct', `Placement % ${label(p.gradYear - 1)}`, 'percent'),
      ],
      rows,
      totals: {
        programme: 'All',
        finalYear: count(now.all.finalYear),
        seeking: count(now.all.seeking),
        placed: count(now.all.placed),
        placementPct: pct(now.all.placed, now.all.seeking),
        offersPerStudent:
          now.all.placed && shown(now.all.placed) ? round(now.all.offers / now.all.placed) : null,
        band: now.all.band,
        lastYearPct: pct(before.all.placed, before.all.seeking),
      },
      notes: ['Percentages are left out where a count behind them is under 5.'],
    };
  },
  async evidence(data, p) {
    const { all } = await placementFigures(data, p.gradYear, p);
    const people = await data.people(all.offersRows.flatMap((r) => (r.userId ? [r.userId] : [])));
    return {
      columns: [
        col('rollNumber', 'Roll number'),
        col('name', 'Name'),
        col('programme', 'Programme'),
        col('company', 'Employer'),
        col('role', 'Role'),
        col('ctc', 'CTC (₹ lakh a year)', 'number'),
        col('source', 'Source'),
      ],
      rows: all.offersRows.map((r) => ({
        rollNumber: (r.userId && people.get(r.userId)?.rollNumber) || '',
        name: (r.userId && people.get(r.userId)?.name) || 'Former member',
        programme: r.branch ?? '',
        company: r.companyName,
        role: r.role,
        ctc: r.ctcLpa,
        source: r.source.replace(/_/g, ' '),
      })),
    };
  },
};
