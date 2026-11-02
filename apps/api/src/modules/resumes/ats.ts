import type { AtsCheck, ResumeContent } from '@campuslink/shared';

/**
 * The ATS check (prompt 2, G2), deterministic: parseability rules worth 60 points and, against a job
 * description or a drive's role, keyword coverage worth 40. Without one, parseability is scaled to
 * 100. It says why for every point and never claims to predict any company's own system.
 */

const STOP = new Set(
  `a an and are as at be by for from has have in is it its of on or our that the their this to was we were will with you your
   who what when where which while within into over under about across after before during per via than then them they
   can may must should would could able also any all each other more most such only own same so too very just
   job role roles position candidate candidates team teams work working company years year experience experienced strong good
   excellent knowledge understanding skills skill ability required requirements preferred plus etc including include includes
   responsibilities responsible looking join opportunity opportunities apply eligible eligibility salary ctc lpa package location
   based need needs want wants seeking degree graduate graduates fresher freshers b tech btech be me mtech batch students student hiring hire`
    .split(/\s+/)
    .filter(Boolean),
);

/** Lower-cased words of a text, keeping technical tokens whole (c++, c#, node.js, .net, ci/cd). */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+#./-]*[a-z0-9+#]|[a-z0-9]/g) ?? []).map((w) =>
    w.replace(/[./-]+$/, ''),
  );
}

/**
 * Keywords of a job description: words (and two-word phrases) that are not filler, ranked by how
 * often they appear, then by first appearance. At most `limit`.
 */
export function extractKeywords(text: string, limit = 20): string[] {
  const ws = words(text).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
  const counts = new Map<string, { n: number; first: number }>();
  const add = (k: string, i: number) => {
    const c = counts.get(k);
    if (c) c.n++;
    else counts.set(k, { n: 1, first: i });
  };
  ws.forEach((w, i) => add(w, i));
  // Two-word phrases that recur ("machine learning", "spring boot") outrank their parts.
  for (let i = 0; i + 1 < ws.length; i++) add(`${ws[i]} ${ws[i + 1]}`, i);
  const ranked = [...counts]
    .filter(([k, c]) => !k.includes(' ') || c.n > 1)
    // A recurring phrase outranks its own words at the same count ("spring boot" over "spring").
    .sort(
      (a, b) =>
        b[1].n - a[1].n || Number(b[0].includes(' ')) - Number(a[0].includes(' ')) || a[1].first - b[1].first,
    )
    .map(([k]) => k);
  const out: string[] = [];
  for (const k of ranked) {
    if (out.length >= limit) break;
    // A phrase already kept covers its single words, and a word inside a kept phrase is dropped.
    if (out.some((o) => o.split(' ').includes(k) || k.split(' ').includes(o))) continue;
    out.push(k);
  }
  return out;
}

/** All the text of a résumé, for keyword matching. */
export function resumeText(c: ResumeContent): string {
  return [
    c.basics.label,
    c.basics.summary,
    ...c.education.flatMap((e) => [e.institution, e.area, e.studyType]),
    ...c.work.flatMap((w) => [w.name, w.position, ...w.highlights]),
    ...c.projects.flatMap((p) => [p.name, p.description, ...p.highlights]),
    ...c.skills.flatMap((s) => [s.name, ...s.keywords]),
    ...c.certificates.map((x) => x.name),
    ...c.awards.map((x) => x.title),
  ].join('\n');
}

const VERB_START = /^[A-Z][a-z]+(ed|ing|s)?\b/;
const startsWithVerb = (b: string) =>
  VERB_START.test(b.trim()) && !/^(I|My|The|A|An|Responsible)\b/.test(b.trim());

export function parseability(c: ResumeContent, pages: number): AtsCheck[] {
  const bulletsAll = [
    ...c.work.flatMap((w) => w.highlights),
    ...c.projects.flatMap((p) => p.highlights),
  ].filter(Boolean);
  const datesOk = [...c.work, ...c.education].every(
    (e) => !!e.startDate && (!e.endDate || e.endDate >= e.startDate),
  );
  const strong = bulletsAll.filter((b) => startsWithVerb(b) && /\d/.test(b)).length;
  const checks: [AtsCheck['id'], boolean, number][] = [
    ['name', !!c.basics.name, 6],
    ['contact', !!(c.basics.email || c.basics.phone), 8],
    ['education', c.education.length > 0, 8],
    ['skills', c.skills.length > 0, 8],
    ['experience', c.work.length + c.projects.length > 0, 8],
    ['dates', datesOk, 6],
    ['length', pages <= 2, 6],
    ['images', true, 4],
    // Bullets that start with a verb and carry a number: at least half of them.
    ['bullets', bulletsAll.length > 0 && strong * 2 >= bulletsAll.length, 6],
  ];
  return checks.map(([id, ok, points]) => ({ id, ok, points, earned: ok ? points : 0 }));
}

export function atsScore(
  c: ResumeContent,
  pages: number,
  jd: string | null,
): { score: number; checks: AtsCheck[]; matched: string[]; missing: string[] } {
  const checks = parseability(c, pages);
  const parse = checks.reduce((n, k) => n + k.earned, 0); // out of 60
  if (!jd) return { score: Math.round((parse / 60) * 100), checks, matched: [], missing: [] };
  const keywords = extractKeywords(jd);
  const have = ` ${words(resumeText(c)).join(' ')} `;
  const matched = keywords.filter((k) => have.includes(` ${k} `));
  const missing = keywords.filter((k) => !matched.includes(k));
  const coverage = keywords.length ? matched.length / keywords.length : 1;
  return { score: Math.round(parse + 40 * coverage), checks, matched, missing };
}

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
