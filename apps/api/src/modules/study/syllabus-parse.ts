import { SYLLABUS_MAX_TOPICS, SYLLABUS_MAX_UNITS, type SyllabusInput } from '@campuslink/shared';

const UNIT = /^\s*(?:unit|module|chapter|part)\s*[-–—:.]?\s*([0-9]+|[ivxlc]+)\b\s*[-–—:.)]*\s*(.*)$/i;
const BULLET = /^\s*(?:[-–—•·*▪◦]|\(?[0-9]{1,2}[.)]|\(?[a-z][.)])\s+/i;

const clean = (s: string) =>
  s
    .replace(BULLET, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.:;,–—-]+|[\s.:;,–—-]+$/g, '')
    .slice(0, 160);

/** Splits a line of topics on commas, semicolons and bullets (not inside brackets). */
function topicsOf(line: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of line) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,;•·▪]/.test(ch)) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(clean).filter((t) => t.length > 1);
}

/**
 * Turns pasted syllabus text into a suggested Unit → Topic tree that the faculty reviews before
 * saving. Recognises "UNIT I: Title", "Module 2 - Title" and "Unit-III Title: topic, topic" lines;
 * other lines become topics of the unit above. Nothing is invented: every title comes from the text.
 */
export function parseSyllabus(text: string): SyllabusInput {
  const units: { title: string; topics: { title: string; keywords: string[] }[] }[] = [];
  const add = (title: string) => {
    units.push({ title: title || `Unit ${units.length + 1}`, topics: [] });
    return units.at(-1);
  };
  let unit: (typeof units)[number] | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = UNIT.exec(line);
    let rest = line;
    if (m) {
      const tail = (m[2] ?? '').trim();
      const colon = tail.indexOf(':');
      if (colon > 0 && /[,;]/.test(tail.slice(colon + 1))) {
        unit = add(clean(tail.slice(0, colon)) || `Unit ${m[1]?.toUpperCase()}`);
        rest = tail.slice(colon + 1);
      } else {
        unit = add(clean(tail) || `Unit ${m[1]?.toUpperCase()}`);
        continue;
      }
    }
    unit ??= add('');
    for (const title of topicsOf(rest)) if (unit) unit.topics.push({ title, keywords: [] });
  }
  return {
    units: units
      .slice(0, SYLLABUS_MAX_UNITS)
      .map((u) => ({ title: u.title, topics: u.topics.slice(0, SYLLABUS_MAX_TOPICS) })),
  };
}
