import { describe, expect, it } from 'vitest';
import { answerInline, parseAnswer } from './answer-markdown';

describe('answer markdown', () => {
  it('splits citations and inline maths out of text, keeping emphasis', () => {
    expect(answerInline('**DFA** accepts $L = a^*b^*$ [1][2].')).toEqual([
      { t: 'bold', v: [{ t: 'text', v: 'DFA' }] },
      { t: 'text', v: ' accepts ' },
      { t: 'math', v: 'L = a^*b^*' },
      { t: 'text', v: ' ' },
      { t: 'cite', n: 1 },
      { t: 'cite', n: 2 },
      { t: 'text', v: '.' },
    ]);
    // Prices are not maths; hashtags are just text in answers.
    expect(answerInline('Costs $5 and $10 #tag')).toEqual([{ t: 'text', v: 'Costs $5 and $10 #tag' }]);
  });

  it('parses headings, lists, code, display maths and tables', () => {
    const blocks = parseAnswer(
      [
        '### Pumping lemma',
        'Every regular language [1]:',
        '- has a pumping length',
        '- can be pumped',
        '1. pick s',
        '2. split it',
        '```python',
        'print("a*b")',
        '```',
        '$$',
        'xy^iz \\in L',
        '$$',
        '| State | a |',
        '|---|---|',
        '| q0 | q1 |',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'ul', 'ol', 'code', 'math', 'table']);
    expect(blocks[4]).toEqual({ t: 'code', lang: 'python', v: 'print("a*b")' });
    expect(blocks[5]).toEqual({ t: 'math', v: 'xy^iz \\in L' });
    expect(blocks[6]).toMatchObject({
      t: 'table',
      rows: [[[{ t: 'text', v: 'q0' }], [{ t: 'text', v: 'q1' }]]],
    });
  });

  it('an unfinished fence while streaming is still a code block', () => {
    expect(parseAnswer('Look:\n```\nlet x')).toEqual([
      { t: 'p', v: [{ t: 'text', v: 'Look:' }] },
      { t: 'code', lang: '', v: 'let x' },
    ]);
  });
});
