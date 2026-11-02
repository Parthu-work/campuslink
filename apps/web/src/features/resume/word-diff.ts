export interface DiffPart {
  text: string;
  /** A word the suggestion adds or changes (not in the member's bullet, in that order). */
  added: boolean;
}

/**
 * Which words of a suggestion are new against the member's bullet: a longest-common-subsequence
 * over words, case- and punctuation-insensitive. Bullets are at most 220 characters, so the table
 * stays tiny.
 */
export function wordDiff(original: string, next: string): DiffPart[] {
  const key = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const a = original.split(/\s+/).filter(Boolean).map(key);
  const words = next.split(/\s+/).filter(Boolean);
  const b = words.map(key);
  // lcs(i, j): the common words from a[i..] and b[j..], in one flat table.
  const width = b.length + 1;
  const table = new Array<number>((a.length + 1) * width).fill(0);
  const lcs = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] = a[i] === b[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
  const kept = new Set<number>();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      kept.add(j);
      i++;
      j++;
    } else if (lcs(i + 1, j) >= lcs(i, j + 1)) i++;
    else j++;
  }
  // Merge runs so the markup stays small: "Built a" + "REST API" + …
  const parts: DiffPart[] = [];
  words.forEach((w, j) => {
    const added = !kept.has(j);
    const last = parts.at(-1);
    if (last && last.added === added) last.text += ` ${w}`;
    else parts.push({ text: w, added });
  });
  return parts;
}
