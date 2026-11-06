import { describe, expect, it } from 'vitest';
import {
  LEITNER_INTERVALS,
  LEITNER_TOP,
  PRACTICE_SET_SIZE,
  PRACTICE_TOPICS,
  addDays,
  areaOfTopic,
  checkAnswer,
  itemProblem,
  nextCard,
  normaliseOutput,
  parseNumber,
  planSet,
  practiceItemBody,
  type PlanItem,
  type PracticeTopic,
} from './schemas/practice.js';

const items = (prefix: string, n: number, topic: PracticeTopic): PlanItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, topic }));

describe('spaced repetition', () => {
  const today = '2026-11-06';
  it('a mistake comes back tomorrow, whatever box it was in', () => {
    expect(nextCard(null, false, today)).toEqual({ box: 0, due: '2026-11-07' });
    expect(nextCard(3, false, today)).toEqual({ box: 0, due: '2026-11-07' });
  });
  it('each right answer moves one box up and waits longer, up to the top box', () => {
    expect(nextCard(null, true, today)).toEqual({ box: 1, due: addDays(today, LEITNER_INTERVALS[1]) });
    let box: number | null = null;
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      const n = nextCard(box, true, today);
      box = n.box;
      waits.push((Date.parse(n.due) - Date.parse(today)) / 86_400_000);
    }
    expect(box).toBe(LEITNER_TOP);
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
    expect(waits.at(-1)).toBe(LEITNER_INTERVALS[LEITNER_TOP]);
  });
  it('adds days across months and years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('planning a set', () => {
  it('puts due mistakes first, capped, and fills the rest with new items', () => {
    const due = items('d', 9, 'percentages');
    const plan = planSet({ due, fresh: items('f', 20, 'arrays'), later: [], weak: new Set(), reviewsMax: 6 });
    expect(plan).toHaveLength(PRACTICE_SET_SIZE);
    expect(plan.slice(0, 6)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4', 'd5']);
    expect(plan.slice(6).every((id) => id.startsWith('f'))).toBe(true);
  });
  it('brings weak topics back: half of the new items come from them when there are enough', () => {
    const fresh = [...items('w', 10, 'probability'), ...items('o', 10, 'grammar')];
    const plan = planSet({ due: [], fresh, later: [], weak: new Set(['probability']) });
    expect(plan.filter((id) => id.startsWith('w')).length).toBeGreaterThanOrEqual(5);
  });
  it('spreads new items across topics', () => {
    const fresh = [...items('a', 10, 'arrays'), ...items('b', 10, 'strings'), ...items('c', 10, 'trees')];
    const plan = planSet({ due: [], fresh, later: [], weak: new Set() });
    for (const p of ['a', 'b', 'c'])
      expect(plan.filter((id) => id.startsWith(p)).length).toBeGreaterThanOrEqual(3);
  });
  it('uses seen items that are not yet due only when new ones run out, with no repeats', () => {
    const plan = planSet({
      due: items('d', 2, 'ratio'),
      fresh: items('f', 3, 'ratio'),
      later: items('l', 10, 'ratio'),
      weak: new Set(),
    });
    expect(plan).toHaveLength(10);
    expect(new Set(plan).size).toBe(10);
    expect(plan.slice(0, 5).sort()).toEqual(['d0', 'd1', 'f0', 'f1', 'f2']);
  });
  it('gives a short set when the bank is small, never a padded one', () => {
    expect(planSet({ due: [], fresh: items('f', 4, 'series'), later: [], weak: new Set() })).toHaveLength(4);
  });
});

describe('checking answers', () => {
  it('reads numbers the way people type them', () => {
    expect(parseNumber('1,200')).toBe(1200);
    expect(parseNumber(' -2.5 ')).toBe(-2.5);
    expect(parseNumber('3/4')).toBe(0.75);
    expect(parseNumber('1 1/2')).toBe(1.5);
    expect(parseNumber('45%')).toBe(45);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('1/0')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
  it('numeric answers allow the item\x27s tolerance and nothing more', () => {
    const item = { kind: 'numeric' as const, answer: '33.33', tolerance: 0.01 };
    expect(checkAnswer(item, '33.33')).toBe(true);
    expect(checkAnswer(item, '33.34')).toBe(true);
    expect(checkAnswer(item, '33.4')).toBe(false);
    expect(checkAnswer({ kind: 'numeric', answer: '0.75' }, '3/4')).toBe(true);
    expect(checkAnswer({ kind: 'numeric', answer: '12' }, 'twelve')).toBe(false);
  });
  it('MCQ answers match the option index exactly; empty is a miss', () => {
    expect(checkAnswer({ kind: 'mcq', answer: '2' }, '2')).toBe(true);
    expect(checkAnswer({ kind: 'mcq', answer: '2' }, '1')).toBe(false);
    expect(checkAnswer({ kind: 'mcq', answer: '0' }, '')).toBe(false);
  });
  it('output answers ignore line endings, trailing spaces and blank edges, not anything else', () => {
    expect(normaliseOutput('1 2 \r\n3\n\n')).toBe('1 2\n3');
    const item = { kind: 'output_prediction' as const, answer: '10\n20' };
    expect(checkAnswer(item, '10  \r\n20\n')).toBe(true);
    expect(checkAnswer(item, '10 20')).toBe(false);
    expect(checkAnswer(item, '  ')).toBe(false);
  });
  it('coding items are never checked here (the CodeRunner does it)', () => {
    expect(checkAnswer({ kind: 'coding', answer: 'x' }, 'x')).toBe(false);
  });
});

describe('items', () => {
  const base = {
    kind: 'mcq',
    topic: 'percentages',
    text: 'What is 10% of 250?',
    options: ['25', '2.5', '250'],
    answer: '0',
    explanation: '10% is a tenth: 250 / 10 = 25.',
  };
  it('accepts a well-formed MCQ and fills the defaults', () => {
    const r = practiceItemBody.parse(base);
    expect(r).toMatchObject({ difficulty: 'medium', companies: [], tests: [], codeLanguage: null });
  });
  it('rejects what each kind is missing', () => {
    expect(practiceItemBody.safeParse({ ...base, answer: '5' }).success).toBe(false);
    expect(practiceItemBody.safeParse({ ...base, options: ['25', '25 '] }).success).toBe(false);
    expect(practiceItemBody.safeParse({ ...base, kind: 'numeric', options: [], answer: 'x' }).success).toBe(
      false,
    );
    expect(
      itemProblem({
        kind: 'output_prediction',
        options: [],
        answer: '1',
        code: '',
        codeLanguage: 'c',
        tests: [],
      })?.path,
    ).toBe('code');
    expect(
      itemProblem({ kind: 'coding', options: [], answer: '', code: '', codeLanguage: 'python', tests: [] })
        ?.path,
    ).toBe('tests');
  });
  it('every topic belongs to an area', () => {
    for (const t of PRACTICE_TOPICS) expect(areaOfTopic(t)).toBeTruthy();
    expect(areaOfTopic('arrays')).toBe('dsa');
    expect(areaOfTopic('syllogisms')).toBe('logical');
  });
});
