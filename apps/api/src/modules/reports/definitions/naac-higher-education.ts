import type { ReportDefinition } from '../report-data.js';
import { col, distinct, groupBy, inBranch, label, programmeCol, yearCol } from './common.js';

/** NAAC, progression to higher education. */
export const naacHigherEducation: ReportDefinition = {
  id: 'naac-higher-education',
  framework: 'NAAC',
  title: 'Progression to higher education',
  version: '2026.1',
  sourceNote:
    'NAAC self-study data on students progressing to higher education: the programme graduated from, the institution joined and the programme admitted to. Only records the placement cell verified are counted. Check the metric number and format against the current manual.',
  needsReview: true,
  threeYears: false,
  async compute(data, p, count) {
    const rows0 = inBranch(await data.higherStudies([p.gradYear]), p);
    const groups = groupBy(rows0, (r) => `${r.branch ?? ''}|${String(r.institution)}|${String(r.program)}`);
    const rows = [...groups.values()]
      .map((g) => ({
        year: label(p.gradYear),
        programme: g[0]?.branch ?? '',
        institution: String(g[0]?.institution ?? ''),
        admittedTo: String(g[0]?.program ?? ''),
        country: String(g[0]?.country ?? ''),
        students: distinct(g, (r) => r.subject),
      }))
      .sort((a, b) => a.programme.localeCompare(b.programme) || b.students - a.students)
      .map((r) => ({ ...r, students: count(r.students) }));
    const abroad = distinct(
      rows0.filter((r) => String(r.country).toLowerCase() !== 'india'),
      (r) => r.subject,
    );
    return {
      columns: [
        yearCol,
        programmeCol,
        col('institution', 'Institution joined'),
        col('admittedTo', 'Programme admitted to'),
        col('country', 'Country'),
        col('students', 'Students', 'count'),
      ],
      rows,
      totals: { year: 'Total', students: count(distinct(rows0, (r) => r.subject)) },
      notes: [`Of these, abroad: ${String(count(abroad))}.`],
    };
  },
  async evidence(data, p) {
    const rows = inBranch(await data.higherStudies([p.gradYear]), p);
    const people = await data.people(rows.flatMap((r) => (r.userId ? [r.userId] : [])));
    return {
      columns: [
        col('year', 'Academic year'),
        col('rollNumber', 'Roll number'),
        col('name', 'Name'),
        col('programme', 'Programme graduated from'),
        col('institution', 'Institution joined'),
        col('admittedTo', 'Programme admitted to'),
        col('country', 'Country'),
        col('admitYear', 'Admission year', 'number'),
        col('exam', 'Qualifying exam'),
      ],
      rows: rows.map((r) => ({
        year: label(p.gradYear),
        rollNumber: (r.userId && people.get(r.userId)?.rollNumber) || '',
        name: (r.userId && people.get(r.userId)?.name) || 'Former member',
        programme: r.branch ?? '',
        institution: String(r.institution),
        admittedTo: String(r.program),
        country: String(r.country),
        admitYear: Number(r.admitYear),
        exam: r.qualifyingExam ? String(r.qualifyingExam) : '',
      })),
    };
  },
};
