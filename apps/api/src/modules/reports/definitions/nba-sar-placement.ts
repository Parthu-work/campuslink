import { SMALL_CELL } from '@campuslink/shared';
import type { ReportDefinition } from '../report-data.js';
import { col, distinct, inBranch, jobOffers, label, round, shown, yearCol } from './common.js';

/**
 * NBA SAR criterion "placement, higher studies and entrepreneurship" per programme over three
 * batches. The scoring line follows the commonly published Tier-II format and stays marked for
 * review until someone checks it against the current SAR manual.
 */
export const nbaSarPlacement: ReportDefinition = {
  id: 'nba-sar-placement',
  framework: 'NBA',
  title: 'Placement, higher studies and entrepreneurship (SAR)',
  version: '2026.1',
  sourceNote:
    'NBA Self Assessment Report (Tier-II UG engineering), placement, higher studies and entrepreneurship: x placed, y admitted to higher studies, z entrepreneurs, N final-year students; P = (x + y + z) / N per year, averaged over three years. The commonly published format assesses 30 × the average. Check against the current SAR manual before submitting.',
  needsReview: true,
  threeYears: true,
  async compute(data, p, count) {
    const [roster, offers, higher, ventures] = await Promise.all([
      data.roster(p.gradYears),
      data.offers(p.gradYears),
      data.higherStudies(p.gradYears),
      data.ventures(p.gradYears),
    ]);
    const ratios: (number | null)[] = [];
    const rows = p.gradYears.map((y) => {
      const n = inBranch(roster, p)
        .filter((r) => r.gradYear === y)
        .reduce((s, r) => s + r.n, 0);
      const of = <T extends { gradYear: number | null; branch: string | null }>(rs: T[]) =>
        inBranch(rs, p).filter((r) => r.gradYear === y);
      const x = distinct(jobOffers(of(offers)), (r) => r.subject);
      const hs = of(higher);
      const yCount = distinct(hs, (r) => r.subject);
      const withExam = distinct(
        hs.filter((r) => !!r.qualifyingExam),
        (r) => r.subject,
      );
      const z = distinct(of(ventures), (r) => r.subject);
      const ratio = n > 0 && shown(n) && shown(x + yCount + z) ? round((x + yCount + z) / n) : null;
      ratios.push(ratio);
      return {
        year: label(y),
        finalYear: count(n),
        placed: count(x),
        higherStudies: count(yCount),
        withExam: count(withExam),
        entrepreneurs: count(z),
        ratio,
      };
    });
    const all = ratios.every((r) => r !== null);
    const avg = all ? round((ratios as number[]).reduce((a, b) => a + b, 0) / ratios.length) : null;
    return {
      columns: [
        yearCol,
        col('finalYear', 'Final-year students (N)', 'count'),
        col('placed', 'Placed (x)', 'count'),
        col('higherStudies', 'Higher studies (y)', 'count'),
        col('withExam', 'of which with a qualifying exam', 'count'),
        col('entrepreneurs', 'Entrepreneurs (z)', 'count'),
        col('ratio', 'P = (x + y + z) / N', 'number'),
      ],
      rows,
      totals: { year: 'Average of the three years', ratio: avg },
      notes: [
        avg === null
          ? `The average and the assessment need every year's ratio; a ratio is left out when x + y + z is under ${SMALL_CELL} (see the evidence workbook).`
          : `Assessment per the SAR format: 30 × ${avg} = ${round(30 * avg)} (check against the current NBA SAR manual).`,
        'Placed counts students with at least one verified job offer (internships are not placements). Each student is counted once per column.',
        'Higher studies and ventures count only records the placement cell verified.',
      ],
    };
  },
  async evidence(data, p) {
    const [offers, higher, ventures] = await Promise.all([
      data.offers(p.gradYears),
      data.higherStudies(p.gradYears),
      data.ventures(p.gradYears),
    ]);
    const rows = [
      ...jobOffers(inBranch(offers, p)).map((r) => ({
        kind: 'Placed',
        userId: r.userId,
        branch: r.branch,
        gradYear: r.gradYear,
        detail: `${r.companyName}, ${r.role}`,
      })),
      ...inBranch(higher, p).map((r) => ({
        kind: 'Higher studies',
        userId: r.userId,
        branch: r.branch,
        gradYear: r.gradYear,
        detail: `${String(r.program)}, ${String(r.institution)}${r.qualifyingExam ? ` (${String(r.qualifyingExam)})` : ''}`,
      })),
      ...inBranch(ventures, p).map((r) => ({
        kind: 'Entrepreneur',
        userId: r.userId,
        branch: r.branch,
        gradYear: r.gradYear,
        detail: `${String(r.name)}${r.registered ? ' (registered)' : ''}`,
      })),
    ];
    const people = await data.people(rows.flatMap((r) => (r.userId ? [r.userId] : [])));
    return {
      columns: [
        col('year', 'Academic year'),
        col('kind', 'Counted as'),
        col('rollNumber', 'Roll number'),
        col('name', 'Name'),
        col('programme', 'Programme'),
        col('detail', 'Details'),
      ],
      rows: rows.map((r) => ({
        year: r.gradYear ? label(r.gradYear) : '',
        kind: r.kind,
        rollNumber: (r.userId && people.get(r.userId)?.rollNumber) || '',
        name: (r.userId && people.get(r.userId)?.name) || 'Former member',
        programme: r.branch ?? '',
        detail: r.detail,
      })),
    };
  },
};
