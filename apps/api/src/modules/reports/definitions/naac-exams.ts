import type { ReportDefinition } from '../report-data.js';
import { col, distinct, groupBy, inBranch } from './common.js';

const examName = (r: Record<string, unknown>) =>
  r.exam === 'OTHER' ? String(r.examName ?? 'Other') : String(r.exam).replace('_', ' ');

/** NAAC, students qualifying state, national or international exams (by the year qualified). */
export const naacExams: ReportDefinition = {
  id: 'naac-exams',
  framework: 'NAAC',
  title: 'Students qualifying state, national or international exams',
  version: '2026.1',
  sourceNote:
    'NAAC self-study data on students qualifying in state, national or international level examinations (for example NET, GATE, GMAT, CAT, GRE, TOEFL, civil services, state government exams), by the calendar year of qualifying. Only verified records are counted. Check the metric number and format against the current manual.',
  needsReview: true,
  threeYears: false,
  async compute(data, p, count) {
    const rows0 = inBranch(await data.exams([p.gradYear]), p);
    const groups = groupBy(rows0, (r) => `${examName(r)}|${String(r.level)}`);
    const rows = [...groups.values()]
      .map((g) => ({
        year: String(p.gradYear),
        exam: examName(g[0] ?? {}),
        level: String(g[0]?.level ?? ''),
        students: distinct(g, (r) => r.subject),
      }))
      .sort((a, b) => b.students - a.students || a.exam.localeCompare(b.exam))
      .map((r) => ({ ...r, students: count(r.students) }));
    return {
      columns: [
        col('year', 'Year qualified'),
        col('exam', 'Exam'),
        col('level', 'Level'),
        col('students', 'Students', 'count'),
      ],
      rows,
      totals: { year: 'Total', students: count(distinct(rows0, (r) => r.subject)) },
      notes: ['A student who qualified two exams appears on both rows and once in the total.'],
    };
  },
  async evidence(data, p) {
    const rows = inBranch(await data.exams([p.gradYear]), p);
    const people = await data.people(rows.flatMap((r) => (r.userId ? [r.userId] : [])));
    return {
      columns: [
        col('year', 'Year qualified', 'number'),
        col('rollNumber', 'Roll number'),
        col('name', 'Name'),
        col('programme', 'Programme'),
        col('exam', 'Exam'),
        col('level', 'Level'),
        col('scoreBand', 'Score band'),
      ],
      rows: rows.map((r) => ({
        year: Number(r.year),
        rollNumber: (r.userId && people.get(r.userId)?.rollNumber) || '',
        name: (r.userId && people.get(r.userId)?.name) || 'Former member',
        programme: r.branch ?? '',
        exam: examName(r),
        level: String(r.level),
        scoreBand: String(r.scoreBand ?? ''),
      })),
    };
  },
};
