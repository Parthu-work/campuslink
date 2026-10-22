import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { RoadmapContent, RoadmapNode, RoadmapSummaryView, RoadmapView } from '@campuslink/shared';
import { api, ApiError } from './api';

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

/** Nodes whose prerequisites are all done (what to do next). */
export function nextSteps(nodes: RoadmapNode[], done: ReadonlySet<string>): RoadmapNode[] {
  return nodes.filter((n) => !done.has(n.id) && n.prerequisites.every((p) => done.has(p)));
}

// ── Career Galaxy ─────────────────────────────
export interface Star {
  roadmap: RoadmapSummaryView;
  x: number;
  y: number;
  r: number;
  /** Where the label goes, pointing away from the constellation's centre. */
  label: { x: number; y: number; anchor: 'start' | 'middle' | 'end' };
}
export interface Constellation {
  category: string;
  cx: number;
  cy: number;
  titleY: number;
  stars: Star[];
}
export const GALAXY_CELL = { w: 500, h: 400 };

/**
 * One constellation per category in a grid of cells; its roadmaps sit on an ellipse around the
 * centre with labels pointing outward, so nothing overlaps whatever the count (up to ~12).
 */
export function layoutGalaxy(
  roadmaps: RoadmapSummaryView[],
  categories: readonly string[],
  columns = 2,
): { groups: Constellation[]; width: number; height: number } {
  const present = categories.filter((c) => roadmaps.some((r) => r.category === c));
  const groups = present.map((category, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const cx = col * GALAXY_CELL.w + GALAXY_CELL.w / 2;
    const cy = row * GALAXY_CELL.h + GALAXY_CELL.h / 2 + 18;
    const mine = roadmaps.filter((r) => r.category === category);
    const n = mine.length;
    const stars = mine.map((roadmap, j): Star => {
      const r = 7 + Math.min(7, roadmap.nodeCount / 2);
      if (n === 1) return { roadmap, x: cx, y: cy, r, label: { x: cx, y: cy + r + 20, anchor: 'middle' } };
      // Two stars sit side by side; more go round the ellipse from the top.
      const angle = (n === 2 ? Math.PI : -Math.PI / 2) + (j / n) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = cx + cos * 72;
      const y = cy + sin * 120;
      const label =
        cos > 0.3
          ? { x: x + r + 8, y: y + 5, anchor: 'start' as const }
          : cos < -0.3
            ? { x: x - r - 8, y: y + 5, anchor: 'end' as const }
            : { x, y: sin > 0 ? y + r + 20 : y - r - 9, anchor: 'middle' as const };
      return { roadmap, x, y, r, label };
    });
    return { category, cx, cy, titleY: row * GALAXY_CELL.h + 30, stars };
  });
  const rows = Math.max(1, Math.ceil(present.length / columns));
  return {
    groups,
    width: GALAXY_CELL.w * Math.min(columns, Math.max(1, present.length)),
    height: rows * GALAXY_CELL.h,
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

// ── Hours ─────────────────────────────
export function totalHours(nodes: RoadmapNode[]): [number, number] {
  return nodes.reduce<[number, number]>(
    (s, n) => [s[0] + n.estimateHours[0], s[1] + n.estimateHours[1]],
    [0, 0],
  );
}

// ── Mutations ─────────────────────────────
export function useRoadmapProgress(roadmap: Pick<RoadmapView, 'id' | 'slug'>) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const patch = (myProgress: RoadmapView['myProgress']) => {
    qc.setQueryData<RoadmapView>(['roadmap', roadmap.slug], (old) =>
      old && myProgress
        ? { ...old, myProgress, progress: { done: myProgress.done.length, total: old.nodeCount } }
        : old,
    );
    void qc.invalidateQueries({ queryKey: ['roadmaps'] });
  };
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const toggle = useMutation({
    mutationFn: (v: { nodeId: string; done: boolean }) =>
      api.put<RoadmapView['myProgress']>(`/roadmaps/${roadmap.id}/progress`, v),
    // Optimistic: the step ticks at once and unticks if saving fails (audit ST-4).
    onMutate: ({ nodeId, done }) => {
      const before = qc.getQueryData<RoadmapView>(['roadmap', roadmap.slug]);
      const mine = before?.myProgress;
      if (before && mine) {
        const set = new Set(mine.done);
        if (done) set.add(nodeId);
        else set.delete(nodeId);
        qc.setQueryData<RoadmapView>(['roadmap', roadmap.slug], {
          ...before,
          myProgress: { ...mine, done: [...set] },
          progress: { done: set.size, total: before.nodeCount },
        });
      }
      return { before };
    },
    onSuccess: patch,
    onError: (e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(['roadmap', roadmap.slug], ctx.before);
      onError(e);
    },
  });
  const goal = useMutation({
    mutationFn: (nodesPerWeek: number) =>
      api.put<RoadmapView['myProgress']>(`/roadmaps/${roadmap.id}/goal`, { nodesPerWeek }),
    onSuccess: (p) => {
      patch(p);
      toast.success(t('roadmaps.goalSaved'));
    },
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

/** List view is the default with reduced motion or on small screens; remembered per viewer. */
export function defaultRoadmapView(): 'graph' | 'list' {
  try {
    const saved = localStorage.getItem('roadmaps.view');
    if (saved === 'graph' || saved === 'list') return saved;
  } catch {
    // Storage blocked: fall through to the default.
  }
  if (typeof matchMedia !== 'function') return 'list';
  return matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(max-width: 640px)').matches
    ? 'list'
    : 'graph';
}
export function rememberRoadmapView(v: 'graph' | 'list') {
  try {
    localStorage.setItem('roadmaps.view', v);
  } catch {
    // Not important enough to surface.
  }
}
