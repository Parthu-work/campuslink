import type { PracticeTopic } from './schemas/practice.js';

/**
 * Words that name a practice topic in a roadmap step's title (prompt 3, U7: "Practise this").
 * English only, as the library's titles are; a topic matches on its own name or a common short
 * form. Deliberately narrow: a step that only mentions a topic in passing ("Steady problem-solving
 * practice") matches nothing, so the link never promises questions the step is not about.
 */
const TOPIC_WORDS: Partial<Record<PracticeTopic, RegExp>> = {
  arrays: /\barrays?\b|\bhashing\b|\bhash ?maps?\b/i,
  strings: /\bstrings?\b(?! theory)/i,
  linked_lists: /\blinked lists?\b/i,
  stacks_queues: /\bstacks?\b|\bqueues?\b/i,
  trees: /\btrees?\b|\bheaps?\b|\bbinary search trees?\b|\bbst\b/i,
  graphs: /\bgraphs?\b(?! ?ql)|\bbfs\b|\bdfs\b/i,
  sorting_searching: /\bsorting\b|\bsearching\b|\bbinary search\b/i,
  recursion: /\brecursion\b|\bbacktracking\b/i,
  dynamic_programming: /\bdynamic programming\b/i,
  complexity: /\bbig-?o\b|\bcomplexity\b|\btime complexity\b/i,
  oop: /\boop\b|\bobject[- ]oriented\b/i,
  dbms: /\bdbms\b|\bdatabases?\b|\bsql\b/i,
  python: /\bpython\b/i,
  java: /\bjava\b(?!script)/i,
  probability: /\bprobability\b/i,
  permutations: /\bpermutations?\b|\bcombinations?\b/i,
  percentages: /\bpercentages?\b/i,
  profit_loss: /\bprofit and loss\b|\bprofit & loss\b/i,
  ratio: /\bratios?\b|\bproportions?\b/i,
  averages: /\baverages?\b/i,
  time_work: /\btime and work\b/i,
  time_distance: /\btime(?:,)? speed and distance\b|\btime and distance\b/i,
  interest: /\bsimple interest\b|\bcompound interest\b/i,
  number_system: /\bnumber systems?\b/i,
  series: /\bnumber series\b|\bletter series\b/i,
  coding_decoding: /\bcoding[- ]decoding\b/i,
  blood_relations: /\bblood relations?\b/i,
  directions: /\bdirection sense\b/i,
  syllogisms: /\bsyllogisms?\b/i,
  arrangements: /\bseating arrangements?\b|\barrangements?\b/i,
  grammar: /\bgrammar\b/i,
  vocabulary: /\bvocabulary\b/i,
  reading: /\breading comprehension\b/i,
  sentence_order: /\bsentence (?:order|ordering|rearrangement)\b|\bpara ?jumbles?\b/i,
};

/** The practice topics a roadmap step's title names, in the order of the closed topic list. */
export function topicsInTitle(title: string): PracticeTopic[] {
  return (Object.keys(TOPIC_WORDS) as PracticeTopic[]).filter((t) => TOPIC_WORDS[t]?.test(title));
}
