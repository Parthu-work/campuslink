import { createHash } from 'node:crypto';
import { SKILL_VOCABULARY, type Branch, type JobLevel, type JobMode, type JobType } from '@campuslink/shared';
import { companyKey } from '../../lib/company.js';

/**
 * Best-effort inference for imported postings. Posted jobs carry these fields explicitly; for
 * ingested ones we read the title and text, and show the result as "about" in the UI.
 */
const has = (re: RegExp, ...texts: (string | null | undefined)[]) => texts.some((t) => !!t && re.test(t));

export function inferMode(text: string, hint?: string | null, remote?: boolean | null): JobMode | null {
  const h = (hint ?? '').toLowerCase();
  if (h.includes('hybrid') || has(/\bhybrid\b/i, text)) return 'hybrid';
  if (remote || h.includes('remote') || has(/\b(remote|work from home|wfh)\b/i, text)) return 'remote';
  if (
    h.includes('on-site') ||
    h.includes('onsite') ||
    h.includes('office') ||
    has(/\b(on-?site|in[- ]office)\b/i, text)
  )
    return 'onsite';
  return null;
}

export function inferType(title: string, text: string, hint?: string | null): JobType {
  const h = `${hint ?? ''} ${title}`;
  if (has(/\b(intern|internship|trainee)\b/i, h)) return 'internship';
  if (has(/\b(contract|contractor|temporary|fixed[- ]term)\b/i, h)) return 'contract';
  if (has(/\bpart[- ]time\b/i, h)) return 'part_time';
  if (has(/\binternship\b/i, text.slice(0, 400))) return 'internship';
  return 'full_time';
}

export function inferLevel(title: string, text: string): JobLevel | null {
  if (
    has(
      /\b(intern|internship|fresher|freshers|trainee|graduate engineer|new grad|entry[- ]level|campus hire|apprentice)\b/i,
      title,
    )
  )
    return 'fresher';
  if (has(/\b(principal|staff|lead|head of|director|architect|vp|manager)\b/i, title)) return 'senior';
  if (has(/\b(senior|sr\.?)\b/i, title)) return 'senior';
  if (has(/\b(junior|jr\.?|associate)\b|\b(engineer|developer|analyst)\s+(i|1)\b/i, title)) return 'junior';
  const m = /(\d{1,2})\s*(?:\+|-\s*\d{1,2})?\s*(?:years|yrs)/i.exec(text);
  if (m) {
    const y = Number(m[1]);
    if (y <= 1) return 'fresher';
    if (y <= 3) return 'junior';
    if (y <= 6) return 'mid';
    return 'senior';
  }
  if (has(/\b(fresher|freshers|0\s*-\s*1 years?|no experience required)\b/i, text)) return 'fresher';
  return null;
}

/** Short or common-word skills are only recognised in unambiguous forms. */
const ALIASES: Record<string, RegExp> = {
  C: /\bC\s*(?:\/|and)\s*C\+\+|\bC programming\b/i,
  'C++': /\bC\+\+/i,
  'C#': /\bC#/i,
  R: /\bR programming\b|\bR\s*(?:\/|and)\s*Python\b/i,
  Go: /\bgolang\b|\bGo\s+(?:language|developer|programming)\b/i,
  REST: /\bREST(?:ful)?\s+APIs?\b/i,
  Express: /\bExpress(?:\.js|js)\b/i,
  Spring: /\bSpring\s+(?:framework|MVC)\b/i,
  '.NET': /\.NET\b/i,
  'Node.js': /\bnode(?:\.js|js)\b/i,
  'Next.js': /\bnext(?:\.js|js)\b/i,
  'CI/CD': /\bCI\s*\/\s*CD\b/i,
  'UI/UX': /\bUI\s*\/\s*UX\b|\bUX design/i,
  LLM: /\bLLMs?\b|\blarge language models?\b/i,
  SQL: /\bSQL\b/,
  Agile: /\bagile\b|\bscrum\b/i,
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SKILL_RES: [string, RegExp][] = SKILL_VOCABULARY.map((s) => [
  s,
  ALIASES[s] ?? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(s)}(?![\\p{L}\\p{N}])`, 'iu'),
]);

export function extractSkills(...texts: string[]): string[] {
  const text = texts.join('\n');
  return SKILL_RES.filter(([, re]) => re.test(text))
    .map(([s]) => s)
    .slice(0, 12);
}

/** Which branches a role suits, from its skills and keywords (plus the source's own branches). */
const BRANCH_HINTS: [Branch[], RegExp][] = [
  [
    ['CSE', 'IT', 'AIML', 'DS'],
    /\b(software|developer|SDE|full[- ]stack|backend|frontend|web|cloud|devops|data|machine learning|QA|test automation|android|ios)\b/i,
  ],
  [['ECE'], /\b(VLSI|Verilog|VHDL|embedded|RTOS|PCB|semiconductor|RF|signal processing|firmware|IoT)\b/i],
  [['EEE'], /\b(electrical|PLC|SCADA|power systems?|switchgear|substation|electrician)\b/i],
  [
    ['MECH'],
    /\b(mechanical|SolidWorks|CATIA|AutoCAD|ANSYS|Creo|CNC|manufacturing|automotive|HVAC|production engineer)\b/i,
  ],
  [['CIVIL'], /\b(civil|structural|STAAD|ETABS|Revit|site engineer|construction|surveying|Primavera)\b/i],
  [['CHEM'], /\b(chemical|process engineer|Aspen|HYSYS|refinery|petrochemical|pharma)\b/i],
];
export function inferBranches(title: string, text: string, extra: Branch[] = []): Branch[] {
  const out = new Set<Branch>(extra);
  for (const [branches, re] of BRANCH_HINTS)
    if (re.test(title) || re.test(text.slice(0, 2000))) branches.forEach((b) => out.add(b));
  return [...out].slice(0, 6);
}

export const freshersOk = (level: JobLevel | null, type: JobType, text: string) =>
  level === 'fresher' ||
  type === 'internship' ||
  /\b(freshers?|new grads?|recent graduates?|0\s*-\s*1 years?)\b/i.test(text);

/** Cross-source duplicate key: company + title + first location word group. */
export function dedupeKey(company: string, title: string, location: string): string {
  const t = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const l = (location.toLowerCase().split(/[,/;|]/)[0] ?? '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return createHash('sha256')
    .update(`${companyKey(company)}|${t}|${l}`)
    .digest('hex')
    .slice(0, 40);
}

/** Indian locations (and India-wide remote) for boards that list jobs worldwide. */
const INDIA =
  /\b(india|bengaluru|bangalore|hyderabad|secunderabad|chennai|pune|mumbai|navi mumbai|delhi|new delhi|ncr|gurugram|gurgaon|noida|kolkata|ahmedabad|kochi|cochin|coimbatore|visakhapatnam|vizag|vijayawada|warangal|jaipur|chandigarh|indore|thiruvananthapuram|trivandrum|mysuru|mysore|nagpur|bhubaneswar|lucknow|mangaluru|mangalore|vadodara|surat|guntur|tirupati)\b/i;
export const isIndiaLocation = (location: string) => INDIA.test(location);
