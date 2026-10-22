import { describe, expect, it } from 'vitest';
import { fromDraft, move, parseBatches, toDraft } from './study';

describe('study helpers', () => {
  it('reads batches as four-digit years, without repeats', () => {
    expect(parseBatches('2027, 2026 2027; 99 and 12345')).toEqual([2026, 2027]);
    expect(parseBatches('')).toEqual([]);
  });

  it('moves an item one place and stays put at the ends', () => {
    expect(move(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('keeps ids through a draft round trip and drops blank rows', () => {
    const draft = toDraft({
      subjectId: 's',
      units: [{ id: 'u1', title: 'Automata', topics: [{ id: 't1', title: 'DFA', keywords: ['dfa'] }] }],
    });
    draft.push({ key: 'x', title: '  ', topics: [] });
    draft[0]?.topics.push({ key: 'y', title: 'NFA ', keywords: [] }, { key: 'z', title: '', keywords: [] });
    expect(fromDraft(draft)).toEqual({
      units: [
        {
          id: 'u1',
          title: 'Automata',
          topics: [
            { id: 't1', title: 'DFA', keywords: ['dfa'] },
            { title: 'NFA', keywords: [] },
          ],
        },
      ],
    });
  });
});
