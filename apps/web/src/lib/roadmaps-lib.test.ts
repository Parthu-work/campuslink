import { describe, expect, it } from 'vitest';
import type { RoadmapContent, RoadmapNode, RoadmapSummaryView } from '@campuslink/shared';
import { diffContent, layoutGalaxy, layoutGraph, nextSteps, totalHours } from './roadmaps';

const node = (id: string, prerequisites: string[] = [], over: Partial<RoadmapNode> = {}): RoadmapNode => ({
  id,
  title: id,
  kind: 'skill',
  summary: `${id} summary text`,
  prerequisites,
  estimateHours: [2, 4],
  resources: [],
  proof: '',
  sources: [],
  needsReview: true,
  ...over,
});

describe('roadmap graph layout', () => {
  it('puts each node one layer after its deepest prerequisite', () => {
    const { placed, width, height } = layoutGraph([
      node('a'),
      node('b', ['a']),
      node('c', ['a']),
      node('d', ['b', 'c']),
      node('e', ['a', 'd']),
    ]);
    const layer = Object.fromEntries(placed.map((p) => [p.node.id, p.layer]));
    expect(layer).toEqual({ a: 0, b: 1, c: 1, d: 2, e: 3 });
    expect(width).toBeGreaterThan(height);
    // Single nodes are centred against the tallest layer.
    const a = placed.find((p) => p.node.id === 'a');
    const b = placed.find((p) => p.node.id === 'b');
    const c = placed.find((p) => p.node.id === 'c');
    expect(a && b && c && a.y > b.y && a.y < c.y).toBe(true);
  });

  it('survives unknown prerequisites and cycles without looping', () => {
    const { placed } = layoutGraph([node('a', ['zz']), node('b', ['c']), node('c', ['b'])]);
    expect(placed).toHaveLength(3);
  });

  it('suggests steps whose prerequisites are done', () => {
    const nodes = [node('a'), node('b', ['a']), node('c', ['b'])];
    expect(nextSteps(nodes, new Set()).map((n) => n.id)).toEqual(['a']);
    expect(nextSteps(nodes, new Set(['a'])).map((n) => n.id)).toEqual(['b']);
    expect(totalHours(nodes)).toEqual([6, 12]);
  });
});

describe('career galaxy', () => {
  it('groups roadmaps by category and keeps stars and labels inside their cell', () => {
    const r = (id: string, category: RoadmapSummaryView['category']) =>
      ({ id, category, nodeCount: 10 }) as RoadmapSummaryView;
    const many = Array.from({ length: 9 }, (_, i) => r(`s${i}`, 'software'));
    const { groups, width, height } = layoutGalaxy(
      [...many, r('d', 'data-ai'), r('c', 'core-engineering')],
      ['software', 'data-ai', 'security', 'core-engineering'],
    );
    expect(groups.map((c) => c.category)).toEqual(['software', 'data-ai', 'core-engineering']);
    expect([width, height]).toEqual([1000, 800]);
    expect(groups[0]?.stars).toHaveLength(9);
    for (const g of groups)
      for (const s of g.stars) {
        expect(Math.abs(s.x - g.cx)).toBeLessThan(110);
        expect(Math.abs(s.y - g.cy)).toBeLessThan(140);
      }
    // Stars in a constellation never overlap.
    const st = groups[0]?.stars ?? [];
    for (const a of st)
      for (const b of st) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
    // A big constellation never stacks two centred labels at the same end (they would collide).
    const twelve = layoutGalaxy(
      Array.from({ length: 12 }, (_, i) => r(`t${i}`, 'software')),
      ['software'],
      1,
    ).groups[0];
    const centred = (twelve?.stars ?? []).filter((s) => s.label.anchor === 'middle');
    expect(centred.filter((s) => s.y > (twelve?.cy ?? 0)).length).toBeLessThanOrEqual(1);
    expect(centred.filter((s) => s.y < (twelve?.cy ?? 0)).length).toBeLessThanOrEqual(1);
    expect(layoutGalaxy([r('x', 'software')], ['software'], 1).width).toBe(500);
  });
});

describe('version diff', () => {
  it('lists added, removed and changed steps with the fields that changed', () => {
    const base: RoadmapContent = {
      title: 'Demo',
      summary: 'A demo roadmap for the diff test only.',
      category: 'software',
      branches: ['CSE'],
      outcomes: [],
      sources: [],
      nodes: [node('a'), node('b', ['a']), node('c')],
    };
    const next: RoadmapContent = {
      ...base,
      summary: 'A changed summary for the diff test only.',
      nodes: [node('a', [], { title: 'A!', estimateHours: [3, 4] }), node('b', ['a']), node('d')],
    };
    const d = diffContent(base, next);
    expect(d.roadmap).toEqual(['summary']);
    expect(d.nodes).toEqual([
      { kind: 'changed', node: next.nodes[0], fields: ['title', 'estimateHours'] },
      { kind: 'added', node: next.nodes[2] },
      { kind: 'removed', node: base.nodes[2] },
    ]);
  });
});
