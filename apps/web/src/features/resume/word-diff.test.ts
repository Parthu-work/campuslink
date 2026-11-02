import { describe, expect, it } from 'vitest';
import { wordDiff } from './word-diff';

describe('wordDiff', () => {
  it('marks only the words a suggestion adds', () => {
    expect(wordDiff('worked on the college website', 'Built the college website in React')).toEqual([
      { text: 'Built', added: true },
      { text: 'the college website', added: false },
      { text: 'in React', added: true },
    ]);
  });

  it('ignores case and punctuation, and an unchanged bullet has nothing added', () => {
    expect(wordDiff('Led a team of 4.', 'led a team of 4')).toEqual([
      { text: 'led a team of 4', added: false },
    ]);
  });

  it('handles an empty original', () => {
    expect(wordDiff('', 'Shipped it')).toEqual([{ text: 'Shipped it', added: true }]);
  });
});
