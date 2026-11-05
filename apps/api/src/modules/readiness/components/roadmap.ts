import { clamp01, type ComponentResult, type ReadinessComponent } from '../component.js';

export type RoadmapFacts = (
  userIds: string[],
) => Promise<Map<string, { roadmapId: string; slug: string; title: string; done: number; total: number }>>;

/** Steps suggested at once. */
const STEPS_AT_ONCE = 3;

/**
 * Roadmap progress for the member's target track: the roadmap they set a weekly goal on (else the
 * one they touched last), steps done of its published version. Each step is worth the same.
 */
export function roadmapComponent(facts: RoadmapFacts): ReadinessComponent {
  return {
    id: 'roadmap',
    async compute(members) {
      const all = await facts(members.map((m) => m.userId));
      const out = new Map<string, ComponentResult>();
      for (const m of members) {
        const t = all.get(m.userId);
        if (!t) {
          out.set(m.userId, {
            fraction: 0,
            facts: { roadmap: null },
            next: { id: 'pick_roadmap', gain: null },
          });
          continue;
        }
        const left = t.total - t.done;
        const steps = Math.min(STEPS_AT_ONCE, left);
        out.set(m.userId, {
          fraction: clamp01(t.done / t.total),
          facts: { roadmap: t.title, slug: t.slug, done: t.done, total: t.total },
          next:
            steps > 0 ? { id: 'roadmap_steps', count: steps, target: t.slug, gain: steps / t.total } : null,
        });
      }
      return out;
    },
  };
}
