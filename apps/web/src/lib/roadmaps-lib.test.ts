import { describe, expect, it } from 'vitest';
import type { RoadmapContent, RoadmapNode } from '@campuslink/shared';
import { diffContent, layoutGraph } from './roadmaps';

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
