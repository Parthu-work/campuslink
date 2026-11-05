import {
  READINESS_COMPONENTS,
  type ReadinessAction,
  type ReadinessComponentId,
  type ReadinessComponentView,
  type ReadinessView,
  type ReadinessWeights,
} from '@campuslink/shared';
import type { ComponentResult } from './component.js';

/**
 * Whole numbers that add up to `total`, as close to `exact` as possible (largest remainder), never
 * above each one's `cap`. Points shown per component then add up to exactly the score.
 */
export function apportion(
  exact: number[],
  total: number,
  caps: number[] = exact.map(() => Infinity),
): number[] {
  const out = exact.map((x, i) => Math.min(Math.floor(x + 1e-9), caps[i] ?? Infinity));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, r: x - Math.floor(x + 1e-9) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  while (left > 0) {
    const pick = order.find(
      ({ i }) => (out[i] ?? 0) < (caps[i] ?? Infinity) && (exact[i] ?? 0) > (out[i] ?? 0),
    );
    if (!pick) break;
    out[pick.i] = (out[pick.i] ?? 0) + 1;
    order.splice(order.indexOf(pick), 1);
    left--;
  }
  return out;
}

const NEXT_SHOWN = 3;

/**
 * The score: each scored component earns `weight ÷ (sum of scored weights) × 100 × fraction`.
 * Components the college switched off, that this build cannot score yet, or that have nothing to
 * measure for this member are skipped, and the rest are scaled up to 100 (and the view says so).
 * No hidden model: the points of every component add up to the score.
 */
export function compose(
  weights: ReadinessWeights,
  registered: ReadonlySet<ReadinessComponentId>,
  results: Partial<Record<ReadinessComponentId, ComponentResult | null>>,
  now: Date,
): ReadinessView {
  const status = (id: ReadinessComponentId): ReadinessComponentView['status'] =>
    weights[id] <= 0
      ? 'off'
      : !registered.has(id)
        ? 'not_available'
        : results[id]
          ? 'scored'
          : 'not_applicable';
  const ids = [...READINESS_COMPONENTS];
  const scored = ids.filter((id) => status(id) === 'scored');
  const sum = scored.reduce((n, id) => n + weights[id], 0);
  const exactMax = scored.map((id) => (sum ? (weights[id] * 100) / sum : 0));
  const max = apportion(exactMax, sum ? 100 : 0);
  const exactPoints = scored.map((id, i) => (exactMax[i] ?? 0) * (results[id]?.fraction ?? 0));
  const total = Math.round(exactPoints.reduce((a, b) => a + b, 0));
  const points = apportion(exactPoints, total, max);

  const components: ReadinessComponentView[] = ids.map((id) => {
    const k = scored.indexOf(id);
    const r = results[id];
    if (k < 0 || !r)
      return {
        id,
        status: status(id),
        weight: weights[id],
        points: 0,
        max: 0,
        facts: r?.facts ?? {},
        next: null,
      };
    const cap = (max[k] ?? 0) - (points[k] ?? 0);
    const next: ReadinessAction | null = r.next
      ? {
          ...r.next,
          component: id,
          gain:
            r.next.gain === null || r.next.gain <= 0 || cap <= 0
              ? null
              : Math.min(cap, Math.max(1, Math.round(r.next.gain * (exactMax[k] ?? 0)))),
        }
      : null;
    return {
      id,
      status: 'scored',
      weight: weights[id],
      points: points[k] ?? 0,
      max: max[k] ?? 0,
      facts: r.facts,
      next,
    };
  });
  const next = components
    .flatMap((c) => (c.next ? [c.next] : []))
    .sort((a, b) => (b.gain ?? -1) - (a.gain ?? -1))
    .slice(0, NEXT_SHOWN);
  return {
    score: points.reduce((a, b) => a + b, 0),
    components,
    next,
    renormalised: components.some((c) => c.status === 'not_available' || c.status === 'not_applicable'),
    computedAt: now.toISOString(),
  };
}
