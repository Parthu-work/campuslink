import { SMALL_CELL } from '@campuslink/shared';
import type { ReportDefinition } from '../report-data.js';
import { col, distinct, inBranch, jobOffers, label, round, shown, yearCol } from './common.js';

/**
 * NBA SAR criterion 4.6 "Placement, Higher Studies and Entrepreneurship" (30 marks) per programme
 * over the last three graduating batches (LYG, LYGm1, LYGm2), as in NBA's Tier-II UG Engineering SAR
 * format, GAPC v4.0, January 2025 (checked in prompt 1b, R12). Still marked for review for one rule
 * the platform cannot apply: FS is at least the sanctioned intake plus lateral entry (N + N2).
 */
export const nbaSarPlacement: ReportDefinition = {
  id: 'nba-sar-placement',
  framework: 'NBA',
  title: 'Placement, higher studies and entrepreneurship (SAR)',
  version: '2026.2',
  sourceNote:
    'NBA Self-Assessment Report format, UG Engineering, GAPC Version 4.0, Tier-II institution programs (January 2025), criterion 4.6 Placement, Higher Studies and Entrepreneurship (30), Table 4.6.1: FS final-year students, X placed, Y admitted to higher studies, Z taking up entrepreneurship; Placement Index P = ((X + Y + Z) / FS) × 100 for LYG, LYGm1 and LYGm2; points = 0.3 × the average P. https://www.nbaind.org/files/2-SAR-UG-EG-T2-14-1-2025_Format_20250115122255.pdf (checked 2 November 2026). Not applied: when FS is below the sanctioned intake plus lateral entry and leftover seats (N + N2), the SAR uses N + N2; the platform does not hold the sanctioned intake, so enter it in the SAR yourself.',
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
      const yCount = distinct(of(higher), (r) => r.subject);
      const z = distinct(of(ventures), (r) => r.subject);
      // The SAR's Placement Index is a percentage.
      const ratio = n > 0 && shown(n) && shown(x + yCount + z) ? round(((x + yCount + z) / n) * 100) : null;
      ratios.push(ratio);
      return {
        year: label(y),
        finalYear: count(n),
        placed: count(x),
        higherStudies: count(yCount),
        entrepreneurs: count(z),
        ratio,
      };
    });
    const all = ratios.every((r) => r !== null);
    const avg = all ? round((ratios as number[]).reduce((a, b) => a + b, 0) / ratios.length) : null;
    return {
      columns: [
        yearCol,
        col('finalYear', 'Final-year students (FS)', 'count'),
        col('placed', 'Placed (X)', 'count'),
        col('higherStudies', 'Higher studies (Y)', 'count'),
        col('entrepreneurs', 'Entrepreneurship (Z)', 'count'),
        col('ratio', 'P = ((X + Y + Z) / FS) × 100', 'number'),
      ],
      rows,
      totals: { year: 'Average of the three years', ratio: avg },
      notes: [
        avg === null
          ? `The average and the points need every year's index; an index is left out when X + Y + Z is under ${SMALL_CELL} (see the evidence workbook).`
          : `Points per SAR criterion 4.6: 0.3 × ${avg} = ${round(0.3 * avg)} of 30.`,
        'If FS is below the sanctioned intake plus lateral entry and leftover seats (N + N2), the SAR uses N + N2 instead; the platform does not hold the sanctioned intake.',
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
