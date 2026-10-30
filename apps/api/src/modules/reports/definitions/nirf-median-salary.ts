import { SMALL_CELL } from '@campuslink/shared';
import type { ReportDefinition } from '../report-data.js';
import {
  bestOffers,
  col,
  groupBy,
  inBranch,
  jobOffers,
  label,
  median,
  programmeCol,
  round,
  yearCol,
} from './common.js';

/**
 * NIRF-style graduation outcome: the median salary of placed graduates per programme. The median,
 * never the mean, and only from five or more exact figures.
 */
export const nirfMedianSalary: ReportDefinition = {
  id: 'nirf-median-salary',
  framework: 'NIRF',
  title: 'Median salary of placed graduates',
  version: '2026.1',
  sourceNote:
    'NIRF graduation outcome data: median annual salary of graduates placed, per programme and year. One salary per student (their highest verified job offer). Check the format against the current NIRF data capture sheet before submitting.',
  needsReview: true,
  threeYears: true,
  async compute(data, p, count) {
    const offers = bestOffers(jobOffers(inBranch(await data.offers(p.gradYears), p)));
    const rows = [...groupBy(offers, (r) => `${r.gradYear ?? 0}|${r.branch ?? ''}`).values()]
      .map((g) => {
        const exact = g.flatMap((r) => (r.ctcLpa === null ? [] : [r.ctcLpa]));
        const gradYear = g[0]?.gradYear ?? 0;
        return {
          gradYear,
          year: label(gradYear),
          programme: g[0]?.branch ?? '',
          placed: count(g.length),
          median: exact.length >= SMALL_CELL ? round(median(exact) as number) : null,
        };
      })
      .sort((a, b) => a.gradYear - b.gradYear || a.programme.localeCompare(b.programme))
      .map(({ gradYear: _y, ...r }) => r);
    return {
      columns: [
        yearCol,
        programmeCol,
        col('placed', 'Graduates placed', 'count'),
        col('median', 'Median salary (₹ lakh a year)', 'number'),
      ],
      rows,
      totals: null,
      notes: [
        `The median is shown only from ${SMALL_CELL} or more exact salaries; offers of members who left the platform keep only a band and are not in the median.`,
      ],
    };
  },
  async evidence(data, p) {
    const offers = bestOffers(jobOffers(inBranch(await data.offers(p.gradYears), p)));
    const people = await data.people(offers.flatMap((r) => (r.userId ? [r.userId] : [])));
    return {
      columns: [
        col('year', 'Academic year'),
        col('rollNumber', 'Roll number'),
        col('name', 'Name'),
        col('programme', 'Programme'),
        col('company', 'Employer'),
        col('ctc', 'Salary (₹ lakh a year)', 'number'),
      ],
      rows: offers.map((r) => ({
        year: r.gradYear ? label(r.gradYear) : '',
        rollNumber: (r.userId && people.get(r.userId)?.rollNumber) || '',
        name: (r.userId && people.get(r.userId)?.name) || 'Former member',
        programme: r.branch ?? '',
        company: r.companyName,
        ctc: r.ctcLpa,
      })),
    };
  },
};
