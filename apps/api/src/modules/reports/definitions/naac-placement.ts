import type { ReportDefinition } from '../report-data.js';
import {
  col,
  distinct,
  groupBy,
  inBranch,
  jobOffers,
  label,
  medianBand,
  programmeCol,
  yearCol,
} from './common.js';

/** NAAC, placement of outgoing students: a year-wise list with company and package band. */
export const naacPlacement: ReportDefinition = {
  id: 'naac-placement',
  framework: 'NAAC',
  title: 'Placement of outgoing students',
  version: '2026.1',
  sourceNote:
    'NAAC self-study data on placement of outgoing students: year-wise list of students placed with the employer and package. Packages are shown as bands here; the evidence workbook lists each student. NAAC moved to binary accreditation in 2025, so check the metric number and format against the current manual.',
  needsReview: true,
  threeYears: false,
  async compute(data, p, count) {
    const offers = jobOffers(inBranch(await data.offers([p.gradYear]), p));
    const groups = groupBy(offers, (r) => `${r.branch ?? ''}|${r.companyKey}`);
    const rows = [...groups.values()]
      .map((g) => ({
        year: label(p.gradYear),
        programme: g[0]?.branch ?? '',
        company: g[0]?.companyName ?? '',
        students: distinct(g, (r) => r.subject),
        band: medianBand(g),
      }))
      .sort((a, b) => a.programme.localeCompare(b.programme) || b.students - a.students)
      .map((r) => ({ ...r, students: count(r.students) }));
    return {
      columns: [
        yearCol,
        programmeCol,
        col('company', 'Employer'),
        col('students', 'Students placed', 'count'),
        col('band', 'Package (median band)', 'band'),
      ],
      rows,
      totals: { year: 'Total', students: count(distinct(offers, (r) => r.subject)) },
      notes: ['A student placed with two employers appears on both rows and once in the total.'],
    };
  },
  async evidence(data, p) {
    const offers = jobOffers(inBranch(await data.offers([p.gradYear]), p));
    const people = await data.people(offers.flatMap((r) => (r.userId ? [r.userId] : [])));
    return {
      columns: [
        col('year', 'Academic year'),
        col('rollNumber', 'Roll number'),
        col('name', 'Name'),
        col('programme', 'Programme'),
        col('company', 'Employer'),
        col('role', 'Role'),
        col('band', 'Package band', 'band'),
        col('source', 'Source'),
      ],
      rows: offers.map((r) => ({
        year: label(p.gradYear),
        rollNumber: (r.userId && people.get(r.userId)?.rollNumber) || '',
        name: (r.userId && people.get(r.userId)?.name) || 'Former member',
        programme: r.branch ?? '',
        company: r.companyName,
        role: r.role,
        band: r.ctcBand,
        source: r.source.replace(/_/g, ' '),
      })),
    };
  },
};
