import { describe, expect, it } from 'vitest';
import { topicsInTitle } from './practice-match.js';

describe('topicsInTitle (prompt 3, U7: Practise this)', () => {
  it('finds the topics a library step names', () => {
    expect(topicsInTitle('Arrays, hashing, stacks, queues and linked lists')).toEqual([
      'arrays',
      'linked_lists',
      'stacks_queues',
    ]);
    expect(topicsInTitle('Trees, heaps and graphs')).toEqual(['trees', 'graphs']);
    expect(topicsInTitle('Sorting, searching and recursion')).toEqual(['sorting_searching', 'recursion']);
    expect(topicsInTitle('Greedy algorithms and dynamic programming')).toEqual(['dynamic_programming']);
    expect(topicsInTitle('Big-O and complexity analysis')).toEqual(['complexity']);
    expect(topicsInTitle('CS fundamentals: OOP, databases, OS and networks')).toEqual(['oop', 'dbms']);
    expect(topicsInTitle('Python with pandas')).toEqual(['python']);
  });

  it('matches nothing for a step that is not about a practice topic', () => {
    expect(topicsInTitle('One language, written fluently')).toEqual([]);
    expect(topicsInTitle('Steady problem-solving practice')).toEqual([]);
    expect(topicsInTitle('Build and ship one real project')).toEqual([]);
  });

  it('does not take JavaScript for Java or GraphQL for graphs', () => {
    expect(topicsInTitle('JavaScript and the DOM')).toEqual([]);
    expect(topicsInTitle('GraphQL APIs')).toEqual([]);
    expect(topicsInTitle('Core Java and collections')).toEqual(['java']);
  });
});
