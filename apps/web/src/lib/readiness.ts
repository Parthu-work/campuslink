import type { ReadinessAction, ReadinessComponentView } from '@campuslink/shared';

/** Where a readiness next step is done (null: nothing to open in this build). */
export function readinessActionHref(a: Pick<ReadinessAction, 'id' | 'target'>): string | null {
  switch (a.id) {
    case 'build_resume':
    case 'check_resume':
    case 'fix_resume_issues':
    case 'add_keywords':
    case 'check_against_role':
      return '/resume';
    case 'do_mock':
    case 'improve_answers':
      return '/interviews';
    case 'pick_roadmap':
      return '/roadmaps';
    case 'roadmap_steps':
      return a.target ? `/roadmaps/${encodeURIComponent(a.target)}` : '/roadmaps';
    case 'book_session':
      return '/mentors';
    case 'do_practice':
      return '/practice';
    case 'add_academics':
    case 'raise_cgpa':
    case 'clear_backlogs':
      return '/placements';
    default:
      return null;
  }
}

/** Which sentence (under `readiness.facts.`) describes a component's facts. */
export function readinessFactKey(c: Pick<ReadinessComponentView, 'id' | 'status' | 'facts'>): string {
  if (c.status === 'off') return 'off';
  if (c.status === 'not_available') return 'notAvailable';
  if (c.status === 'not_applicable') return 'noCutoffs';
  const f = c.facts;
  switch (c.id) {
    case 'resume':
      return !f.resumes ? 'noResume' : f.ats === null || f.ats === undefined ? 'unchecked' : 'resume';
    case 'interviews':
      return !f.mocks && (f.average === null || f.average === undefined)
        ? 'noMocks'
        : f.average === null || f.average === undefined
          ? 'interviewsUnscored'
          : 'interviews';
    case 'roadmap':
      return f.roadmap ? 'roadmap' : 'noRoadmap';
    case 'mentorship':
      return 'mentorship';
    case 'eligibility':
      return f.pending ? 'pending' : f.cgpa === null || f.cgpa === undefined ? 'noRecord' : 'eligibility';
    default:
      return f.sets ? 'practice' : 'noPractice';
  }
}
