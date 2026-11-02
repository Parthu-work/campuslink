import type { ReportDefinition } from '../report-data.js';
import { col, distinct, label } from './common.js';

/** The academic year of a batch: June of the year before graduation to the end of May. */
export const academicWindow = (gradYear: number) => ({
  from: new Date(Date.UTC(gradYear - 1, 5, 1)),
  to: new Date(Date.UTC(gradYear, 5, 1)),
});

/** NAAC, alumni engagement: what alumni did for the college in the year, from the modules. */
export const naacAlumniEngagement: ReportDefinition = {
  id: 'naac-alumni-engagement',
  framework: 'NAAC',
  title: 'Alumni engagement',
  version: '2026.1',
  sourceNote:
    'NAAC self-study data on alumni engagement other than financial contribution: events alumni hosted, mentoring sessions alumni held and referrals alumni gave, in the academic year (June to May). Financial contribution is not recorded yet. Check the metric number and format against the current manual.',
  needsReview: true,
  threeYears: false,
  async compute(data, p, count) {
    const { from, to } = academicWindow(p.gradYear);
    const e = await data.alumniEngagement(from, to);
    const row = (measure: string, value: number) => ({
      year: label(p.gradYear),
      measure,
      value: count(value),
    });
    return {
      columns: [col('year', 'Academic year'), col('measure', 'Measure'), col('value', 'Count', 'count')],
      rows: [
        row('Events hosted by alumni', e.events.length),
        row(
          'Alumni who hosted events',
          distinct(e.events, (x) => x.hostId),
        ),
        row('Mentoring sessions held by alumni', e.sessions.length),
        row(
          'Alumni mentors',
          distinct(e.sessions, (x) => x.mentorId),
        ),
        row('Referrals given by alumni', e.referrals.length),
        row(
          'Alumni who gave referrals',
          distinct(e.referrals, (x) => x.referrerId),
        ),
      ],
      totals: null,
      notes: [
        'All programmes: alumni activity is not split by the programme they graduated from.',
        'Alumni financial contribution is not recorded in this version.',
      ],
    };
  },
  async evidence(data, p) {
    const { from, to } = academicWindow(p.gradYear);
    const e = await data.alumniEngagement(from, to);
    const people = await data.people(e.events.map((x) => x.hostId));
    return {
      columns: [col('date', 'Date'), col('title', 'Event'), col('kind', 'Kind'), col('host', 'Hosted by')],
      rows: e.events
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .map((x) => ({
          date: x.startsAt.toISOString().slice(0, 10),
          title: x.title,
          kind: x.kind.replace(/_/g, ' '),
          host: people.get(x.hostId)?.name ?? 'Former member',
        })),
    };
  },
};
