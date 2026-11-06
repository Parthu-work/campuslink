import type { AtsReport } from '@campuslink/shared';
import { clamp01, type ComponentResult, type ReadinessComponent } from '../component.js';

/** What the résumés module reports per member: how many résumés, and the best ATS report. */
export type ResumeFacts = (
  userIds: string[],
) => Promise<Map<string, { count: number; report: AtsReport | null }>>;

/** Keywords a member is asked to add in one go. */
const KEYWORDS_AT_ONCE = 5;

/**
 * Résumé ATS score (G2): the best ATS score among the member's résumés, out of 100. Failed checks
 * are worth exactly their missing points (scaled to 100 when no role was given, as the ATS score
 * itself is), so "fix two issues (+6)" is what fixing them earns.
 */
export function resumeComponent(facts: ResumeFacts): ReadinessComponent {
  return {
    id: 'resume',
    async compute(members) {
      const all = await facts(members.map((m) => m.userId));
      const out = new Map<string, ComponentResult>();
      for (const m of members) {
        const f = all.get(m.userId);
        if (!f?.count) {
          out.set(m.userId, {
            fraction: 0,
            facts: { resumes: 0, ats: null },
            next: { id: 'build_resume', gain: null },
          });
          continue;
        }
        const r = f.report;
        if (!r) {
          out.set(m.userId, {
            fraction: 0,
            facts: { resumes: f.count, ats: null },
            next: { id: 'check_resume', gain: null },
          });
          continue;
        }
        const failed = r.checks.filter((c) => !c.ok);
        // Parseability is out of 60; without a role the ATS score is parseability scaled to 100.
        const scale = r.keywords ? 1 : 100 / 60;
        const missingParse = failed.reduce((n, c) => n + (c.points - c.earned), 0) * scale;
        const kw = r.keywords;
        const kwTotal = kw ? kw.matched.length + kw.missing.length : 0;
        const add = kw ? Math.min(KEYWORDS_AT_ONCE, kw.missing.length) : 0;
        const next: ComponentResult['next'] = failed.length
          ? { id: 'fix_resume_issues', count: failed.length, gain: missingParse / 100 }
          : kw && add > 0 && kwTotal > 0
            ? { id: 'add_keywords', count: add, gain: (40 * add) / kwTotal / 100 }
            : !kw
              ? { id: 'check_against_role', gain: null }
              : null;
        out.set(m.userId, {
          fraction: clamp01(r.score / 100),
          facts: { resumes: f.count, ats: r.score, issues: failed.length },
          next,
        });
      }
      return out;
    },
  };
}
