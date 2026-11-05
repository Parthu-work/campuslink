import { READINESS_SESSIONS_TARGET } from '@campuslink/shared';
import type { ComponentResult, ReadinessComponent } from '../component.js';

export type SessionFacts = (userIds: string[], since: Date) => Promise<Map<string, number>>;

const YEAR = 365 * 86_400_000;

/** Mentorship sessions done: completed sessions as a mentee in the last year, two for full points. */
export function mentorshipComponent(facts: SessionFacts): ReadinessComponent {
  return {
    id: 'mentorship',
    async compute(members, now) {
      const all = await facts(
        members.map((m) => m.userId),
        new Date(now.getTime() - YEAR),
      );
      const out = new Map<string, ComponentResult>();
      for (const m of members) {
        const n = all.get(m.userId) ?? 0;
        out.set(m.userId, {
          fraction: Math.min(n, READINESS_SESSIONS_TARGET) / READINESS_SESSIONS_TARGET,
          facts: { sessions: n },
          next:
            n < READINESS_SESSIONS_TARGET
              ? { id: 'book_session', count: 1, gain: 1 / READINESS_SESSIONS_TARGET }
              : null,
        });
      }
      return out;
    },
  };
}
