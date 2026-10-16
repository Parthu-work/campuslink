/** Legal-form words dropped when comparing company names ("Infosys Ltd" = "Infosys Limited" = "Infosys"). */
const LEGAL = new Set([
  'pvt',
  'private',
  'ltd',
  'limited',
  'inc',
  'incorporated',
  'llc',
  'llp',
  'corp',
  'corporation',
  'co',
  'plc',
  'gmbh',
  'pte',
  'sa',
  'bv',
]);

/**
 * Comparable key for a company name: lowercase, no bracketed notes ("(demo)", "(India)"), "&" as
 * "and", punctuation removed, trailing legal-form words dropped. Empty when nothing is left.
 */
export function companyKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && LEGAL.has(words[words.length - 1] ?? '')) words.pop();
  return words.join(' ');
}
