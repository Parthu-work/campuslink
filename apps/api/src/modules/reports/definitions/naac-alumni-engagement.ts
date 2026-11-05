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
  version: '2026.2',
  sourceNote:
    'NAAC self-study data on alumni engagement: events alumni hosted, mentoring sessions alumni held, referrals and quick favours (micro-asks) alumni gave, and financial contributions the college recorded as received, in the academic year (June to May). Check the metric number and format against the current manual. Not yet checked: on 2 November 2026 (prompt 1b, R12) naac.gov.in presented a revoked TLS certificate, so its manual could not be downloaded safely; see docs/specs/outcomes-reports.md.',
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
        // Prompt 2, G6: micro-asks and contributions (2026.2).
        row('Quick favours (micro-asks) done by alumni', (e.asks ?? []).length),
        row(
          'Alumni who contributed financially',
          distinct(e.contributions ?? [], (x) => x.subject),
        ),
        {
          year: label(p.gradYear),
          measure: 'Financial contribution received (₹, whole rupees)',
          // A sum, not a count of people: shown only when five or more alumni contributed.
          value:
            count(distinct(e.contributions ?? [], (x) => x.subject)) === '<5'
              ? '<5 contributors'
              : Math.floor((e.contributions ?? []).reduce((n, x) => n + x.amountPaise, 0) / 100),
        },
      ],
      totals: null,
      notes: [
        'All programmes: alumni activity is not split by the programme they graduated from.',
        'Financial contribution counts only what the college recorded as received (Admin › Giving); pledges not yet received are left out. The amount is hidden when fewer than five alumni contributed.',
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
