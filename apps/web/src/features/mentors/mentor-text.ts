import type { MatchReason, MentorCard, MentorMatch } from '@campuslink/shared';

type T = (key: string, vars?: Record<string, unknown>) => string;

/** The seed's demo markers ("DEMO: …", "… (demo)", "… (DEMO)"): shown once as a badge, not in every line. */
const DEMO = /^\s*DEMO:\s*|\s*\((?:demo|DEMO)\)\s*$/g;
export const stripDemo = (s: string) => s.replace(DEMO, '').trim();
export const isDemoText = (s: string) => /^\s*DEMO:|\((?:demo|DEMO)\)\s*$/.test(s);
export const isDemoMentor = (m: MentorCard) =>
  [m.name, m.company, m.headline, m.jobTitle].some((s) => !!s && isDemoText(s));

/** One role line (prompt 3, U6): "Data Analyst at Kestrel Analytics", or either part alone. */
export function roleLine(m: Pick<MentorCard, 'jobTitle' | 'company'>, t: T): string {
  const title = stripDemo(m.jobTitle);
  const company = stripDemo(m.company);
  if (title && company) return t('mentoring.roleAt', { title, company });
  return title || company;
}

/** The headline only when it says something the role line does not. */
export function headlineAdds(m: Pick<MentorCard, 'headline' | 'jobTitle' | 'company'>): string | null {
  const h = stripDemo(m.headline);
  if (!h) return null;
  const low = h.toLowerCase();
  const title = stripDemo(m.jobTitle).toLowerCase();
  const company = stripDemo(m.company).toLowerCase();
  if ((title && low.includes(title)) || (company && low.includes(company))) return null;
  return h;
}

/** Plain-language strength of an Alumni Match score (0–100). */
export const levelOf = (score: number) => (score >= 60 ? 'strong' : score >= 30 ? 'good' : 'some');
/** The number shows only for a strong match, and never to a minor (prompt 3, U6; X7). */
export const shownScore = (match: MentorMatch, minor: boolean) =>
  !minor && match.score >= 60 ? match.score : null;

/** One reason in a sentence ("same branch (CSE)"), from the API's reason only. */
export function reasonText(r: MatchReason, t: T): string {
  switch (r.kind) {
    case 'branch':
    case 'company':
      return t(`mentoring.reason.${r.kind}`, { value: stripDemo(r.value) });
    case 'goals':
    case 'skills':
    case 'languages':
      return t(`mentoring.reason.${r.kind}`, { values: r.values.join(', ') });
    case 'outcomes':
    case 'referrals':
      return t(`mentoring.reason.${r.kind}`, { count: r.count });
    default:
      return t(`mentoring.reason.${r.kind}`);
  }
}

/** "Strong match: same branch (CSE), replies within a day". */
export function matchSentence(match: MentorMatch, t: T, list: (items: string[]) => string): string {
  const level = t(`match.level.${levelOf(match.score)}`);
  const reasons = match.reasons.map((r) => reasonText(r, t));
  return reasons.length ? t('mentoring.summary', { level, reasons: list(reasons) }) : level;
}
