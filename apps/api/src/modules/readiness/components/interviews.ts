import {
  READINESS_MOCKS_TARGET,
  READINESS_MOCK_WINDOW_DAYS,
  RUBRIC_DIMENSIONS,
  type RubricDimension,
  type RubricScores,
} from '@campuslink/shared';
import { clamp01, type ComponentResult, type ReadinessComponent } from '../component.js';

export type MockFacts = (
  userIds: string[],
  since: Date,
) => Promise<Map<string, { at: Date; averages: RubricScores | null }[]>>;

const DAY = 86_400_000;
/** Practice done is this share of the component; the rubric average is the rest. */
const PRACTICE_SHARE = 0.4;
/** The last this many completed sessions set the rubric average. */
const RECENT = 3;

const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Mock interview average (G3): 40% for practice done (completed sessions in the last 90 days, up
 * to three) and 60% for the rubric average of the last three sessions (1 to 5, mapped to 0 to 1).
 * Doing one more mock adds its practice share for certain; what it does to the average is not
 * known in advance, so that part is never promised.
 */
export function interviewsComponent(facts: MockFacts): ReadinessComponent {
  return {
    id: 'interviews',
    async compute(members, now) {
      const all = await facts(
        members.map((m) => m.userId),
        new Date(now.getTime() - 365 * DAY),
      );
      const windowStart = now.getTime() - READINESS_MOCK_WINDOW_DAYS * DAY;
      const out = new Map<string, ComponentResult>();
      for (const m of members) {
        const sessions = all.get(m.userId) ?? [];
        const recent = sessions.filter((s) => s.at.getTime() >= windowStart).length;
        const last = sessions.slice(0, RECENT);
        const dims = new Map<RubricDimension, number[]>();
        for (const s of last)
          for (const d of RUBRIC_DIMENSIONS) {
            const v = s.averages?.[d];
            if (typeof v === 'number') dims.set(d, [...(dims.get(d) ?? []), v]);
          }
        const perDim = [...dims].map(([d, xs]) => [d, meanOf(xs) ?? 0] as const);
        const avg = meanOf(perDim.map(([, v]) => v));
        const quality = avg === null ? 0 : clamp01((avg - 1) / 4);
        const practice = Math.min(recent, READINESS_MOCKS_TARGET) / READINESS_MOCKS_TARGET;
        const weakest = [...perDim].sort((a, b) => a[1] - b[1])[0];
        const next: ComponentResult['next'] =
          recent < READINESS_MOCKS_TARGET
            ? { id: 'do_mock', count: 1, gain: PRACTICE_SHARE / READINESS_MOCKS_TARGET }
            : weakest && weakest[1] < 4
              ? { id: 'improve_answers', target: weakest[0], gain: null }
              : null;
        out.set(m.userId, {
          fraction: clamp01(PRACTICE_SHARE * practice + (1 - PRACTICE_SHARE) * quality),
          facts: {
            mocks: recent,
            average: avg === null ? null : Math.round(avg * 10) / 10,
            weakest: weakest?.[0] ?? null,
          },
          next,
        });
      }
      return out;
    },
  };
}
