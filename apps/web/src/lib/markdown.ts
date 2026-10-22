/**
 * A tiny markdown subset for user text (ADR 0007): paragraphs, "- " lists, **bold**, *italic*,
 * `code`, https links and #hashtags. The API stores plain text only; this parser produces tokens
 * that the RichText component turns into React elements. Nothing is ever set as HTML.
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: Inline[] }
  | { t: 'italic'; v: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; v: string }
  | { t: 'tag'; v: string };
export type Block = { t: 'p'; lines: Inline[][] } | { t: 'ul'; items: Inline[][] };

const URL_RE = /https:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/y;
const TAG_RE = /#([\p{L}\p{M}\p{N}_]{2,40})/uy;

/** Only https links survive, and only when the URL parser agrees. */
export function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (depth < 2 && src.startsWith('**', i)) {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'bold', v: parseInline(src.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }
    if (depth < 2 && ch === '*' && src[i + 1] !== ' ') {
      const end = src.indexOf('*', i + 1);
      if (end > i + 1 && src[end - 1] !== ' ') {
        flush();
        out.push({ t: 'italic', v: parseInline(src.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }
    if (ch === 'h' && src.startsWith('https://', i) && (i === 0 || /\s|\(/.test(src[i - 1] ?? ''))) {
      URL_RE.lastIndex = i;
      const m = URL_RE.exec(src);
      const href = m ? safeHref(m[0]) : null;
      if (m && href) {
        flush();
        out.push({ t: 'link', href, v: m[0] });
        i += m[0].length;
        continue;
      }
    }
    if (ch === '#' && (i === 0 || /\s/.test(src[i - 1] ?? ''))) {
      TAG_RE.lastIndex = i;
      const m = TAG_RE.exec(src);
      if (m?.[1]) {
        flush();
        out.push({ t: 'tag', v: m[1] });
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of src.split(/\n{2,}/)) {
    const lines = chunk.split('\n');
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      blocks.push({ t: 'ul', items: lines.map((l) => parseInline(l.replace(/^\s*[-•]\s+/, ''))) });
    } else if (chunk.trim()) {
      blocks.push({ t: 'p', lines: lines.map((l) => parseInline(l)) });
    }
  }
  return blocks;
}
