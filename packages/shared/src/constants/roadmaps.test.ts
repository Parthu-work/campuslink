import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOURS_PER_WEEK,
  hoursFromStepsPerWeek,
  journeyPhases,
  nextStep,
  pathHours,
  stepHours,
  stepLevels,
  timeAtPace,
} from './roadmaps.js';

type N = { id: string; prerequisites: string[]; estimateHours: [number, number] };
const n = (id: string, prerequisites: string[] = [], estimateHours: [number, number] = [4, 8]): N => ({
  id,
  prerequisites,
  estimateHours,
});

/** A chain a → b → … of `count` steps. */
const chain = (count: number, hours: [number, number] = [4, 8]) =>
  Array.from({ length: count }, (_, i) => n(`s${i}`, i ? [`s${i - 1}`] : [], hours));

/** A step never sits in an earlier phase than any of its prerequisites. */
const respectsOrder = (nodes: N[]) => {
  const phase = new Map<string, number>();
  journeyPhases(nodes).forEach((p, i) => p.steps.forEach((s) => phase.set(s.id, i)));
  return nodes.every((x) => x.prerequisites.every((p) => (phase.get(p) ?? 0) <= (phase.get(x.id) ?? 0)));
};

describe('journey phases (prompt 3, U3)', () => {
  it('measures depth in the graph', () => {
    const levels = stepLevels([n('a'), n('b', ['a']), n('c', ['a']), n('d', ['b', 'c']), n('e', ['zz'])]);
    expect(Object.fromEntries(levels)).toEqual({ a: 0, b: 1, c: 1, d: 2, e: 0 });
  });

  it('makes three to six phases, every step in exactly one', () => {
    for (const size of [3, 4, 7, 10, 16, 24, 40]) {
      const nodes = chain(size);
      const phases = journeyPhases(nodes);
      expect(phases.length, `${size} steps`).toBeGreaterThanOrEqual(3);
      expect(phases.length, `${size} steps`).toBeLessThanOrEqual(6);
      const ids = phases.flatMap((p) => p.steps.map((s) => s.id));
      expect(ids.sort()).toEqual(nodes.map((x) => x.id).sort());
      for (const p of phases) expect(p.steps.length).toBeGreaterThan(0);
    }
  });

  it('gives fewer than three steps one phase each', () => {
    expect(journeyPhases([n('a')]).map((p) => p.key)).toEqual(['foundations']);
    expect(journeyPhases([n('a'), n('b', ['a'])]).map((p) => p.key)).toEqual(['foundations', 'ready']);
    expect(journeyPhases([])).toEqual([]);
  });

  it('names phases by position, and says exam-ready for exam paths', () => {
    expect(journeyPhases(chain(16)).map((p) => p.key)).toEqual(['foundations', 'core', 'build', 'ready']);
    expect(journeyPhases(chain(12), 'exams-higher-studies').map((p) => p.key)).toEqual([
      'foundations',
      'core',
      'readyExam',
    ]);
  });

  it('keeps prerequisites in the same or an earlier phase', () => {
    const graph = [
      n('lang'),
      n('git'),
      n('ds', ['lang']),
      n('algo', ['ds']),
      n('web', ['lang']),
      n('db', ['lang']),
      n('api', ['web', 'db']),
      n('tests', ['api']),
      n('deploy', ['api', 'git']),
      n('project', ['deploy', 'tests'], [20, 40]),
      n('mock', ['algo']),
      n('apply', ['project', 'mock']),
    ];
    expect(respectsOrder(graph)).toBe(true);
    expect(respectsOrder(chain(25))).toBe(true);
  });

  it('splits time roughly evenly', () => {
    const phases = journeyPhases(chain(20));
    const hours = phases.map((p) => p.hours);
    expect(Math.max(...hours) / Math.min(...hours)).toBeLessThanOrEqual(2);
    expect(hours.reduce((a, b) => a + b, 0)).toBe(20 * stepHours(n('x')));
  });
});

describe('the next step', () => {
  const graph = [n('a'), n('b', ['a']), n('c', ['a']), n('d', ['b', 'c'])];
  it('is the first open step whose prerequisites are done', () => {
    expect(nextStep(graph, new Set())?.id).toBe('a');
    expect(nextStep(graph, new Set(['a']))?.id).toBe('b');
    expect(nextStep(graph, new Set(['a', 'b']))?.id).toBe('c');
    expect(nextStep(graph, new Set(['a', 'b', 'c']))?.id).toBe('d');
    expect(nextStep(graph, new Set(['a', 'b', 'c', 'd']))).toBeNull();
  });
  it('falls back to the first open step when steps were taken out of order', () => {
    expect(nextStep(graph, new Set(['d']))?.id).toBe('a');
    expect(nextStep(graph, new Set(['b', 'c', 'd']))?.id).toBe('a');
  });
});

describe('time at a pace', () => {
  it('says weeks for long steps and hours for short ones', () => {
    expect(timeAtPace([6, 12], 6)).toEqual({ unit: 'week', min: 1, max: 2 });
    expect(timeAtPace([3, 5], 6)).toEqual({ unit: 'hour', min: 3, max: 5 });
    expect(timeAtPace([60, 84], 6)).toEqual({ unit: 'week', min: 10, max: 14 });
  });
  it('uses the default pace without one', () => {
    expect(timeAtPace([12, 18], 0)).toEqual(timeAtPace([12, 18], DEFAULT_HOURS_PER_WEEK));
  });
  it('sums a path', () => {
    expect(pathHours([n('a', [], [2, 4]), n('b', [], [10, 20])])).toEqual([12, 24]);
  });
  it('reads a goal saved as steps a week as the hours those steps take', () => {
    expect(hoursFromStepsPerWeek(2, chain(4, [4, 8]))).toBe(12);
    expect(hoursFromStepsPerWeek(0, chain(4))).toBe(0);
    expect(hoursFromStepsPerWeek(10, chain(4, [40, 80]))).toBe(40);
  });
});
