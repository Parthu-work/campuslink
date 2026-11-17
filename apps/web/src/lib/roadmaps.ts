import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from './toast';
import { useTranslation } from '../i18n/react';
import {
  nextStep,
  timeAtPace,
  type RoadmapContent,
  type RoadmapNode,
  type RoadmapView,
} from '@campuslink/shared';
import { api, ApiError } from './api';
import { putOrQueue } from './offline-writes';

// ── Graph layout ─────────────────────────────
export interface PlacedNode {
  node: RoadmapNode;
  layer: number;
  row: number;
  x: number;
  y: number;
}
export const NODE_W = 188;
export const NODE_H = 64;
const GAP_X = 72;
const GAP_Y = 28;

/**
 * Layered layout: each node sits one layer after its deepest prerequisite; rows within a layer
 * follow the average row of the prerequisites (fewer crossings). Deterministic, no dependencies.
 */
export function layoutGraph(nodes: RoadmapNode[]): { placed: PlacedNode[]; width: number; height: number } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    const n = byId.get(id);
    const d = n
      ? Math.max(-1, ...n.prerequisites.filter((p) => byId.has(p)).map((p) => visit(p, seen))) + 1
      : 0;
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) visit(n.id, new Set());
  const layers: RoadmapNode[][] = [];
  for (const n of nodes) (layers[depth.get(n.id) ?? 0] ??= []).push(n);
  const rowOf = new Map<string, number>();
  const placed: PlacedNode[] = [];
  layers.forEach((layer, li) => {
    const sorted = [...layer].sort((a, b) => {
      const avg = (n: RoadmapNode) => {
        const rows = n.prerequisites.map((p) => rowOf.get(p)).filter((r): r is number => r !== undefined);
        return rows.length ? rows.reduce((s, r) => s + r, 0) / rows.length : 0;
      };
      return avg(a) - avg(b);
    });
    sorted.forEach((node, row) => {
      rowOf.set(node.id, row);
      placed.push({ node, layer: li, row, x: li * (NODE_W + GAP_X), y: row * (NODE_H + GAP_Y) });
    });
  });
  const rows = Math.max(1, ...layers.map((l) => l.length));
  // Centre short layers vertically.
  for (const p of placed) {
    const count = layers[p.layer]?.length ?? 1;
    p.y += ((rows - count) * (NODE_H + GAP_Y)) / 2;
  }
  return {
    placed,
    width: layers.length * (NODE_W + GAP_X) - GAP_X,
    height: rows * (NODE_H + GAP_Y) - GAP_Y,
  };
}

// ── Version diff ─────────────────────────────
export type NodeChange =
  | { kind: 'added'; node: RoadmapNode }
  | { kind: 'removed'; node: RoadmapNode }
  | { kind: 'changed'; node: RoadmapNode; fields: string[] };

const FIELDS = [
  'title',
  'kind',
  'summary',
  'prerequisites',
  'estimateHours',
  'resources',
  'proof',
  'sources',
  'needsReview',
] as const;

/** Node-level diff between two versions, plus which roadmap-level fields changed. */
export function diffContent(before: RoadmapContent, after: RoadmapContent) {
  const old = new Map(before.nodes.map((n) => [n.id, n]));
  const now = new Map(after.nodes.map((n) => [n.id, n]));
  const nodes: NodeChange[] = [];
  for (const n of after.nodes) {
    const o = old.get(n.id);
    if (!o) nodes.push({ kind: 'added', node: n });
    else {
      const fields = FIELDS.filter((f) => JSON.stringify(o[f]) !== JSON.stringify(n[f]));
      if (fields.length) nodes.push({ kind: 'changed', node: n, fields });
    }
  }
  for (const n of before.nodes) if (!now.has(n.id)) nodes.push({ kind: 'removed', node: n });
  const roadmap = (['title', 'summary', 'category', 'branches', 'outcomes', 'sources'] as const).filter(
    (f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]),
  );
  return { roadmap, nodes };
}

// ── Mutations ─────────────────────────────
/** The list-style progress of a path from the member's own progress on it. */
const summaryProgress = (
  r: RoadmapView,
  mine: NonNullable<RoadmapView['myProgress']>,
): RoadmapView['progress'] => {
  const next = nextStep(r.content.nodes, new Set(mine.done));
  return {
    done: mine.done.length,
    total: r.nodeCount,
    hoursPerWeek: mine.hoursPerWeek,
    next: next
      ? { id: next.id, title: next.title, estimateHours: [next.estimateHours[0], next.estimateHours[1]] }
      : null,
  };
};

export function useRoadmapProgress(roadmap: Pick<RoadmapView, 'id' | 'slug'>) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const patch = (myProgress: RoadmapView['myProgress']) => {
    qc.setQueryData<RoadmapView>(['roadmap', roadmap.slug], (old) =>
      old && myProgress ? { ...old, myProgress, progress: summaryProgress(old, myProgress) } : old,
    );
    void qc.invalidateQueries({ queryKey: ['roadmaps'] });
  };
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const toggle = useMutation({
    // Runs offline too (the default would pause it), so it can wait in the outbox (B13).
    networkMode: 'always',
    mutationFn: (v: { nodeId: string; done: boolean }) =>
      // Waits in the outbox when offline (B13); the step stays ticked meanwhile.
      putOrQueue<RoadmapView['myProgress']>(qc, `/roadmaps/${roadmap.id}/progress`, v, [
        ['roadmap', roadmap.slug],
        ['roadmaps'],
      ]),
    // Optimistic: the step ticks at once and unticks if saving fails (audit ST-4).
    onMutate: ({ nodeId, done }) => {
      const before = qc.getQueryData<RoadmapView>(['roadmap', roadmap.slug]);
      const mine = before?.myProgress;
      if (before && mine) {
        const set = new Set(mine.done);
        if (done) set.add(nodeId);
        else set.delete(nodeId);
        const myProgress = { ...mine, done: [...set] };
        qc.setQueryData<RoadmapView>(['roadmap', roadmap.slug], {
          ...before,
          myProgress,
          progress: summaryProgress(before, myProgress),
        });
      }
      return { before };
    },
    onSuccess: (p) => {
      if (p !== undefined) patch(p);
    },
    onError: (e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(['roadmap', roadmap.slug], ctx.before);
      onError(e);
    },
  });
  /** Follows the path at a pace (hours a week; 0 follows without a goal or nudges). */
  const goal = useMutation({
    mutationFn: (hoursPerWeek: number) =>
      api.put<RoadmapView['myProgress']>(`/roadmaps/${roadmap.id}/goal`, { hoursPerWeek }),
    onSuccess: (p) => patch(p),
    onError,
  });
  const unfollow = useMutation({
    mutationFn: () => api.delete(`/roadmaps/${roadmap.id}/progress`),
    onSuccess: () => {
      qc.setQueryData<RoadmapView>(['roadmap', roadmap.slug], (old) =>
        old ? { ...old, myProgress: null, progress: null } : old,
      );
      void qc.invalidateQueries({ queryKey: ['roadmaps'] });
    },
    onError,
  });
  return { toggle, goal, unfollow };
}

/** The journey is the default view; the map is for those who ask for it, remembered per viewer. */
export type PathView = 'journey' | 'map';
export function defaultPathView(): PathView {
  try {
    return localStorage.getItem('roadmaps.view') === 'map' ? 'map' : 'journey';
  } catch {
    return 'journey';
  }
}
export function rememberPathView(v: PathView) {
  try {
    localStorage.setItem('roadmaps.view', v);
  } catch {
    // Not important enough to surface.
  }
}

/** "about 3–5 h", "about 2 weeks", "about 1–2 weeks": an estimate at a member's pace. */
export function useTimeText() {
  const { t } = useTranslation();
  return (estimate: readonly [number, number] | number[], hoursPerWeek: number) => {
    const { unit, min, max } = timeAtPace(estimate, hoursPerWeek);
    return min === max
      ? t(`roadmaps.time.${unit}`, { count: min })
      : t(`roadmaps.time.${unit}Range`, { min, max });
  };
}
