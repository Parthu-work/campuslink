import { PRACTICE_MASTERY_DAYS } from '@campuslink/shared';
import { clamp01, type ComponentResult, type ReadinessComponent } from '../component.js';

export type PracticeFacts = (
  userIds: string[],
  since: Date,
) => Promise<Map<string, { sets: number; attempts: number; right: number }>>;

const DAY = 86_400_000;
/** Daily sets in the window that earn the full practice-done share. */
const SETS_TARGET = 10;
/** Practice done is this share of the component; answer accuracy is the rest. */
const DONE_SHARE = 0.4;

/**
 * Practice mastery (G4): 40% for daily sets completed in the mastery window (up to ten) and 60% for
 * the share of practice answers that were right in it. One more daily set adds its done share for
 * certain; what it does to accuracy is not promised.
 */
export function practiceComponent(facts: PracticeFacts): ReadinessComponent {
  return {
    id: 'practice',
    async compute(members, now) {
      const all = await facts(
        members.map((m) => m.userId),
        new Date(now.getTime() - PRACTICE_MASTERY_DAYS * DAY),
      );
      const out = new Map<string, ComponentResult>();
      for (const m of members) {
        const f = all.get(m.userId) ?? { sets: 0, attempts: 0, right: 0 };
        const accuracy = f.attempts ? f.right / f.attempts : 0;
        out.set(m.userId, {
          fraction: clamp01(
            DONE_SHARE * (Math.min(f.sets, SETS_TARGET) / SETS_TARGET) + (1 - DONE_SHARE) * accuracy,
          ),
          facts: { sets: f.sets, accuracy: f.attempts ? Math.round(accuracy * 100) : null },
          next: f.sets < SETS_TARGET ? { id: 'do_practice', count: 1, gain: DONE_SHARE / SETS_TARGET } : null,
        });
      }
      return out;
    },
  };
}
