import { READINESS_CUTOFF_WINDOW_DAYS, type AcademicFacts } from '@campuslink/shared';
import type { ComponentResult, ReadinessComponent } from '../component.js';

export interface DriveCutoff {
  branches: string[];
  minCgpa: number | null;
  maxActiveBacklogs: number | null;
}
export interface EligibilityFacts {
  cutoffs: (since: Date) => Promise<DriveCutoff[]>;
  academics: (userIds: string[]) => Promise<Map<string, AcademicFacts>>;
}

const DAY = 86_400_000;

/**
 * Academic eligibility headroom: of the college's own drives in the last two years that set a CGPA
 * or backlog cut-off (those for the member's branch, or all of them when none were), the share whose
 * cut-offs the member meets. No drives with cut-offs: not applicable. No academic record yet: zero,
 * and the next step is to add it. The next step names the nearest CGPA (or the backlogs) that opens
 * more drives, and those drives' share is its gain.
 */
export function eligibilityComponent(facts: EligibilityFacts): ReadinessComponent {
  return {
    id: 'eligibility',
    async compute(members, now) {
      const cutoffs = await facts.cutoffs(new Date(now.getTime() - READINESS_CUTOFF_WINDOW_DAYS * DAY));
      const out = new Map<string, ComponentResult | null>();
      if (!cutoffs.length) {
        for (const m of members) out.set(m.userId, null);
        return out;
      }
      const records = await facts.academics(members.map((m) => m.userId));
      for (const m of members) {
        const mine = cutoffs.filter(
          (c) => !c.branches.length || (m.branch !== null && c.branches.includes(m.branch)),
        );
        const drives = mine.length ? mine : cutoffs;
        const rec = records.get(m.userId);
        if (!rec || rec.cgpa === null) {
          out.set(m.userId, {
            fraction: 0,
            facts: { drives: drives.length, meets: null, cgpa: null },
            next: { id: 'add_academics', gain: null },
          });
          continue;
        }
        // A self-reported record counts once the placement cell verified it (as for drives).
        if (rec.source === 'self' && !rec.verified) {
          out.set(m.userId, {
            fraction: 0,
            facts: { drives: drives.length, meets: null, pending: 1 },
            next: null,
          });
          continue;
        }
        const cgpa = rec.cgpa;
        const backlogs = rec.activeBacklogs ?? 0;
        const cgpaOk = (c: DriveCutoff, at = cgpa) => c.minCgpa === null || at >= c.minCgpa;
        const backlogOk = (c: DriveCutoff, n = backlogs) =>
          c.maxActiveBacklogs === null || n <= c.maxActiveBacklogs;
        const meets = drives.filter((c) => cgpaOk(c) && backlogOk(c)).length;
        const n = drives.length;
        // The nearest CGPA above the member's that opens at least one more drive (backlogs as they are).
        const above = [
          ...new Set(drives.map((c) => c.minCgpa).filter((x): x is number => x !== null && x > cgpa)),
        ].sort((a, b) => a - b);
        const target = above[0];
        const atTarget =
          target === undefined ? meets : drives.filter((c) => cgpaOk(c, target) && backlogOk(c)).length;
        const noBacklogs = drives.filter((c) => cgpaOk(c) && backlogOk(c, 0)).length;
        const next: ComponentResult['next'] =
          backlogs > 0 && noBacklogs > meets && noBacklogs - meets >= atTarget - meets
            ? { id: 'clear_backlogs', count: backlogs, gain: (noBacklogs - meets) / n }
            : target !== undefined && atTarget > meets
              ? { id: 'raise_cgpa', target: target.toFixed(1), gain: (atTarget - meets) / n }
              : null;
        out.set(m.userId, {
          fraction: meets / n,
          facts: { drives: n, meets, cgpa, backlogs },
          next,
        });
      }
      return out;
    },
  };
}
