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
