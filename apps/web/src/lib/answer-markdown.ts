import { parseInline, type Inline } from './markdown';

/**
 * The study assistant's answer format (ADR 0007, extended for answers): paragraphs, headings,
 * "- " and "1. " lists, fenced code, tables with | columns, maths in $…$ and $$…$$, and [n]
 * citations, on top of the inline subset (bold, italic, code, https links). Text is parsed into
 * tokens the AnswerText component turns into React elements; nothing is ever set as HTML (maths
 * is built by KaTeX into DOM nodes). Unfinished syntax while an answer streams stays plain text.
 */
export type AInline = Exclude<Inline, { t: 'tag' }> | { t: 'math'; v: string } | { t: 'cite'; n: number };
export type ABlock =
  | { t: 'p'; v: AInline[] }
  | { t: 'h'; v: AInline[] }
  | { t: 'ul'; items: AInline[][] }
  | { t: 'ol'; items: AInline[][]; start: number }
  | { t: 'code'; lang: string; v: string }
  | { t: 'math'; v: string }
  | { t: 'table'; head: AInline[][]; rows: AInline[][][] };

/** Inline maths: no space just inside the dollars, so "$5 and $10" stays text. */
const MATH = /\$(?=\S)([^$\n]{1,300}?)(?<=\S)\$/g;
const CITE = /\[(\d{1,2})\]/g;

/** Inline tokens: maths first (so `a^*` is not emphasis), then the subset, then [n] citations. */
export function answerInline(src: string): AInline[] {
  const out: AInline[] = [];
  const text = (v: string) => {
    if (!v) return;
    const last = out.at(-1);
    if (last?.t === 'text') last.v += v;
    else out.push({ t: 'text', v });
  };
  const walk = (nodes: Inline[]): AInline[] =>
    nodes.map((n): AInline => {
      if (n.t === 'tag') return { t: 'text', v: `#${n.v}` };
      if (n.t === 'bold' || n.t === 'italic') return { ...n, v: walk(n.v) as Inline[] };
      return n;
    });
  const prose = (part: string) => {
    for (const n of walk(parseInline(part))) {
      if (n.t !== 'text') {
        out.push(n);
        continue;
      }
      let at = 0;
      for (const m of n.v.matchAll(CITE)) {
        text(n.v.slice(at, m.index));
        out.push({ t: 'cite', n: Number(m[1]) });
        at = (m.index ?? 0) + m[0].length;
      }
      text(n.v.slice(at));
    }
  };
  let at = 0;
  for (const m of src.matchAll(MATH)) {
    prose(src.slice(at, m.index));
    out.push({ t: 'math', v: m[1] ?? '' });
    at = (m.index ?? 0) + m[0].length;
  }
  prose(src.slice(at));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => answerInline(c.trim()));
const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function parseAnswer(src: string): ABlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: ABlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: 'p', v: answerInline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fence = /^\s*```\s*([\w+-]{0,20})\s*$/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? '')) body.push(lines[i++] ?? '');
      out.push({ t: 'code', lang: fence[1] ?? '', v: body.join('\n') });
      continue;
    }
    if (/^\s*\$\$/.test(line)) {
      flush();
      const one = /^\s*\$\$(.+)\$\$\s*$/.exec(line);
      if (one) {
        out.push({ t: 'math', v: one[1] ?? '' });
        continue;
      }
      const body: string[] = [line.replace(/^\s*\$\$/, '')];
      i++;
      while (i < lines.length && !/\$\$\s*$/.test(lines[i] ?? '')) body.push(lines[i++] ?? '');
      if (i < lines.length) body.push((lines[i] ?? '').replace(/\$\$\s*$/, ''));
      out.push({ t: 'math', v: body.join('\n').trim() });
      continue;
    }
    const heading = /^\s*#{1,4}\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      out.push({ t: 'h', v: answerInline(heading[1] ?? '') });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && SEPARATOR.test(lines[i + 1] ?? '')) {
      flush();
      const head = cells(line);
      const rows: AInline[][][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? '')) rows.push(cells(lines[i++] ?? ''));
      i--;
      out.push({ t: 'table', head, rows });
      continue;
    }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flush();
      const kind = ul ? 'ul' : 'ol';
      const last = out.at(-1);
      const item = answerInline((ul ? ul[1] : ol?.[2]) ?? '');
      if (last && last.t === kind) last.items.push(item);
      else if (kind === 'ul') out.push({ t: 'ul', items: [item] });
      else out.push({ t: 'ol', items: [item], start: Number(ol?.[1] ?? 1) });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

/** Plain text for "Copy": citations kept as [n], everything else as written. */
export const answerPlain = (src: string) => src.replace(/\n{3,}/g, '\n\n').trim();
