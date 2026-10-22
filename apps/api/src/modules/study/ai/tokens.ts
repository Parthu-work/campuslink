/**
 * Small text helpers shared by the mock provider, keyword scoring and token estimates.
 * English stop words only; Telugu text keeps every word (no stemming is applied to it).
 */
const STOP = new Set(
  (
    'a an and are as at be been but by can do does for from has have how i if in into is it its of on ' +
    'or our so than that the their them then there these they this to was we what when where which ' +
    'who why will with you your about explain tell me please give show define difference between'
  ).split(' '),
);

const stem = (w: string) =>
  /^[a-z]+$/.test(w) && w.length > 4 ? w.replace(/(ies|es|s|ing|ed)$/, (m) => (m === 'ies' ? 'y' : '')) : w;

/** Lower-cased content words (letters and digits in any script), stemmed lightly. */
export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

/** A rough token count (about four characters per token) for budgets before a provider reports usage. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** FNV-1a, 32-bit: a stable hash for the deterministic mock embeddings. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
