/**
 * Roadmap vocabulary, limits and graph helpers.
 * Zod-free on purpose: screens that only need these values never load Zod (bundle budget).
 */
export const ROADMAP_CATEGORIES = [
  'software',
  'data-ai',
  'security',
  'design-product',
  'core-engineering',
  'exams-higher-studies',
] as const;
export type RoadmapCategory = (typeof ROADMAP_CATEGORIES)[number];
export const NODE_KINDS = ['skill', 'milestone', 'project', 'exam'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
export const ROADMAP_STATUSES = ['draft', 'in_review', 'published', 'archived'] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];
export const VERSION_STATUSES = ['draft', 'submitted', 'published', 'superseded'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];
export const MAX_NODES = 40;

/** Problems that make a node graph unusable (duplicate ids, unknown prerequisites, cycles). */
export function graphProblems(nodes: { id: string; prerequisites: string[] }[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) problems.push(`Duplicate node id “${n.id}”`);
    ids.add(n.id);
  }
  for (const n of nodes)
    for (const p of n.prerequisites) {
      if (!ids.has(p)) problems.push(`“${n.id}” depends on unknown node “${p}”`);
      if (p === n.id) problems.push(`“${n.id}” depends on itself`);
    }
  // Cycle check (Kahn's algorithm).
  const indeg = new Map(
    nodes.map((n) => [n.id, n.prerequisites.filter((p) => ids.has(p) && p !== n.id).length]),
  );
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  let seen = 0;
  while (queue.length) {
    const id = queue.shift() as string;
    seen++;
    for (const m of nodes)
      if (m.prerequisites.includes(id)) {
        const d = (indeg.get(m.id) ?? 0) - 1;
        indeg.set(m.id, d);
        if (d === 0) queue.push(m.id);
      }
  }
  if (seen < ids.size && !problems.some((p) => p.includes('itself')))
    problems.push('The prerequisites form a loop');
  return problems;
}

/** Nodes in an order that respects prerequisites (stable by original order). */
export function topoOrder<T extends { id: string; prerequisites: string[] }>(nodes: T[]): T[] {
  const done = new Set<string>();
  const out: T[] = [];
  let progress = true;
  while (out.length < nodes.length && progress) {
    progress = false;
    for (const n of nodes)
      if (!done.has(n.id) && n.prerequisites.every((p) => done.has(p) || !nodes.some((m) => m.id === p))) {
        done.add(n.id);
        out.push(n);
        progress = true;
      }
  }
  return out.length === nodes.length ? out : nodes;
}

// ── The journey (prompt 3, U3) ─────────────────────────────

interface JourneyNode {
  id: string;
  prerequisites: string[];
  estimateHours: readonly [number, number] | number[];
}

/** A step's likely time: the middle of its estimate, never less than an hour. */
export const stepHours = (n: Pick<JourneyNode, 'estimateHours'>) =>
  Math.max(1, ((n.estimateHours[0] ?? 0) + (n.estimateHours[1] ?? 0)) / 2);

/**
 * How deep each step sits in the graph: 0 without prerequisites, else one more than its deepest
 * prerequisite. Unknown prerequisites are ignored (graphProblems reports them).
 */
export function stepLevels(nodes: readonly JourneyNode[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const level = new Map<string, number>();
  const visit = (id: string, trail: Set<string>): number => {
    const known = level.get(id);
    if (known !== undefined) return known;
    const n = nodes.find((x) => x.id === id);
    if (!n || trail.has(id)) return 0;
    trail.add(id);
    const deps = n.prerequisites.filter((p) => ids.has(p) && p !== id);
    const l = deps.length ? 1 + Math.max(...deps.map((p) => visit(p, trail))) : 0;
    trail.delete(id);
    level.set(id, l);
    return l;
  };
  for (const n of nodes) visit(n.id, new Set());
  return level;
}

/** Phase names by position; the last one depends on what the path prepares for. */
export const PHASE_KEYS = ['foundations', 'core', 'deeper', 'build', 'practice', 'ready'] as const;
export type PhaseKey = (typeof PHASE_KEYS)[number] | 'readyExam';
const PHASE_NAMES: Record<number, readonly (typeof PHASE_KEYS)[number][]> = {
  1: ['foundations'],
  2: ['foundations', 'ready'],
  3: ['foundations', 'core', 'ready'],
  4: ['foundations', 'core', 'build', 'ready'],
  5: ['foundations', 'core', 'deeper', 'build', 'ready'],
  6: ['foundations', 'core', 'deeper', 'build', 'practice', 'ready'],
};

export interface JourneyPhase<T> {
  key: PhaseKey;
  steps: T[];
  /** The phase's likely time, in hours (the sum of its steps' middles). */
  hours: number;
}

/**
 * A path as 3 to 6 phases of roughly equal time (prompt 3, U3): steps in dependency order (by
 * depth, then as the author listed them), cut where the running total is closest to an equal
 * share, preferring a cut between depths so a phase keeps whole layers of the graph. A step never
 * lands in an earlier phase than one of its prerequisites. Fewer than three steps make one phase
 * each.
 */
export function journeyPhases<T extends JourneyNode>(
  nodes: readonly T[],
  category?: RoadmapCategory,
): JourneyPhase<T>[] {
  if (!nodes.length) return [];
  const level = stepLevels(nodes);
  const order = nodes
    .map((n, i) => ({ n, i, l: level.get(n.id) ?? 0 }))
    .sort((a, b) => a.l - b.l || a.i - b.i);
  const count = order.length < 3 ? order.length : Math.min(6, Math.max(3, Math.round(order.length / 4)));
  const hours = order.map((x) => stepHours(x.n));
  const total = hours.reduce((a, b) => a + b, 0);
  const running: number[] = [];
  hours.reduce((sum, h, i) => ((running[i] = sum + h), sum + h), 0);
  // Choose count - 1 cuts (a cut at i ends a phase after order[i - 1]).
  const cuts: number[] = [];
  const share = total / count;
  for (let j = 1; j < count; j++) {
    const target = share * j;
    const lo = (cuts[cuts.length - 1] ?? 0) + 1;
    const hi = order.length - (count - j);
    let best = lo;
    let bestCost = Infinity;
    for (let i = lo; i <= hi; i++) {
      const between = order[i - 1]?.l !== order[i]?.l;
      const cost = Math.abs((running[i - 1] ?? 0) - target) + (between ? 0 : share * 0.35);
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    cuts.push(best);
  }
  const names = PHASE_NAMES[count] ?? PHASE_NAMES[6] ?? [];
  const bounds = [0, ...cuts, order.length];
  return names.map((name, p) => {
    const slice = order.slice(bounds[p], bounds[p + 1]);
    const key: PhaseKey = name === 'ready' && category === 'exams-higher-studies' ? 'readyExam' : name;
    return {
      key,
      steps: slice.map((x) => x.n),
      hours: slice.reduce((sum, x) => sum + stepHours(x.n), 0),
    };
  });
}

/**
 * The step to do next: the first, in journey order, that is not done and whose prerequisites are
 * all done; else the first not done (a student may take steps in any order); null when all are done.
 */
export function nextStep<T extends JourneyNode>(nodes: readonly T[], done: ReadonlySet<string>): T | null {
  const ordered = journeyPhases(nodes).flatMap((p) => p.steps);
  return (
    ordered.find((n) => !done.has(n.id) && n.prerequisites.every((p) => done.has(p))) ??
    ordered.find((n) => !done.has(n.id)) ??
    null
  );
}

/** The pace shown when a member has not chosen one: hours of study a week. */
export const DEFAULT_HOURS_PER_WEEK = 6;
export const MAX_HOURS_PER_WEEK = 40;

/**
 * Time for an estimate at a pace: whole weeks when it takes a week or more, else hours.
 * `{ unit: 'week', min: 1, max: 2 }` reads "about 1–2 weeks".
 */
export function timeAtPace(
  estimate: readonly [number, number] | number[],
  hoursPerWeek: number,
): { unit: 'hour' | 'week'; min: number; max: number } {
  const lo = Math.max(0, estimate[0] ?? 0);
  const hi = Math.max(lo, estimate[1] ?? lo);
  const pace = hoursPerWeek > 0 ? hoursPerWeek : DEFAULT_HOURS_PER_WEEK;
  if (hi < pace) return { unit: 'hour', min: Math.max(1, Math.round(lo)), max: Math.max(1, Math.round(hi)) };
  return { unit: 'week', min: Math.max(1, Math.ceil(lo / pace)), max: Math.max(1, Math.ceil(hi / pace)) };
}

/** A path's total estimate (the sum of its steps' ranges). */
export const pathHours = (nodes: readonly Pick<JourneyNode, 'estimateHours'>[]): [number, number] =>
  nodes.reduce<[number, number]>(
    (s, n) => [s[0] + (n.estimateHours[0] ?? 0), s[1] + (n.estimateHours[1] ?? 0)],
    [0, 0],
  );

/**
 * A weekly goal saved before U3 counted steps a week; it reads as the hours those steps take on
 * average in this path (1 to 40), so no stored goal is lost.
 */
export function hoursFromStepsPerWeek(stepsPerWeek: number, nodes: readonly JourneyNode[]): number {
  if (stepsPerWeek <= 0 || !nodes.length) return 0;
  const average = nodes.reduce((sum, n) => sum + stepHours(n), 0) / nodes.length;
  return Math.min(MAX_HOURS_PER_WEEK, Math.max(1, Math.round(stepsPerWeek * average)));
}
