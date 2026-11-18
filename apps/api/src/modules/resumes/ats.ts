export {
  atsScore,
  extractKeywords,
  parseability,
  resumeText,
  startsWithVerb,
  words,
} from '@campuslink/shared';
import { startsWithVerb } from '@campuslink/shared';

/**
 * The ATS scoring itself is in `packages/shared/src/resume-ats.ts` (prompt 3, U7: the editor scores
 * live with the same rules). Here: the offline bullet suggestions and the rewrite guard.
 */

/**
 * Offline bullet suggestions (they work without AI): what to change, in plain words, and up to three
 * rewrites that only reorder and tighten the member's own words, keeping every fact and number.
 */
export function bulletTips(bullet: string): string[] {
  const tips: string[] = [];
  const b = bullet.trim();
  if (!startsWithVerb(b)) tips.push('Start with a verb: Built, Led, Reduced, Designed…');
  if (!/\d/.test(b)) tips.push('Add a number if you have one: how many, how much, how fast.');
  if (b.length > 180) tips.push('Keep it to one line or two: cut words that do not add a fact.');
  if (/\b(responsible for|worked on|helped with|various)\b/i.test(b))
    tips.push('Say what you did, not what you were responsible for.');
  return tips;
}

export function ruleRewrites(bullet: string): string[] {
  const b = bullet.trim().replace(/\s+/g, ' ').replace(/\.$/, '');
  const out = new Set<string>();
  const stripped = b
    .replace(
      /^(I\s+|My\s+role\s+was\s+to\s+|Was\s+responsible\s+for\s+|Responsible\s+for\s+|Worked\s+on\s+|Helped\s+(with|to)\s+)/i,
      '',
    )
    .trim();
  if (stripped && stripped !== b) out.add(stripped.charAt(0).toUpperCase() + stripped.slice(1));
  const compact = b.replace(/\b(really|very|successfully|various|basically|just)\s+/gi, '');
  if (compact !== b) out.add(compact.charAt(0).toUpperCase() + compact.slice(1));
  return [...out].filter((x) => x.length >= 8).slice(0, 3);
}

/** Every number in a text (digits, with their decimals): a rewrite may not add one. */
export const numbersIn = (text: string) => new Set(text.match(/\d+(?:[.,]\d+)?/g) ?? []);
export const addsNumbers = (original: string, rewrite: string) => {
  const have = numbersIn(original);
  return [...numbersIn(rewrite)].some((n) => !have.has(n));
};
