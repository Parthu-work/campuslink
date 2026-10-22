import { createHash } from 'node:crypto';
import { contentWords, estimateTokens } from '../ai/tokens.js';
import type { ExtractedPage } from './pdf.js';
import type { Segment } from './captions.js';

export interface Chunk {
  index: number;
  text: string;
  heading: string;
  page: number | null;
  startSec: number | null;
  endSec: number | null;
  tokenCount: number;
  contentHash: string;
}

const PAGE_NUMBER = /^\s*(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?\s*$/i;
/**
 * Phrases that read as instructions to a language model. Uploaded material is untrusted: these are
 * neutralised at ingestion (the prompt builder also fences material and tells the model to ignore
 * instructions inside it).
 */
const INSTRUCTION_LIKE = [
  /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:instructions?|rules|prompts?|guidelines)\b/gi,
  /\b(?:you are now|from now on you|act as|pretend to be)\b[^.\n]{0,60}/gi,
  /\b(?:system prompt|developer message|jailbreak)\b/gi,
  /<\/?\s*(?:system|assistant|user|source|question|instructions?)\b[^>]*>/gi,
];
export const NEUTRALISED = '[instruction-like text removed]';

export function neutraliseInstructions(text: string): string {
  return INSTRUCTION_LIKE.reduce((t, re) => t.replace(re, NEUTRALISED), text);
}

/**
 * Removes running headers and footers (a line repeated at the top or bottom of at least half the
 * pages), page numbers and end-of-line hyphenation, and normalises whitespace.
 */
export function cleanPages(pages: ExtractedPage[]): ExtractedPage[] {
  const edges = new Map<string, number>();
  const key = (l: string) => l.replace(/\d+/g, '#').trim().toLowerCase();
  for (const p of pages) {
    const lines = p.text.split('\n').filter((l) => l.trim());
    for (const l of new Set([lines[0], lines.at(-1)].filter((x): x is string => !!x).map(key)))
      edges.set(l, (edges.get(l) ?? 0) + 1);
  }
  const repeated = new Set(
    pages.length >= 3 ? [...edges].filter(([, n]) => n >= Math.ceil(pages.length / 2)).map(([l]) => l) : [],
  );
  return pages.map((p) => {
    const lines = p.text.split('\n');
    const first = lines.findIndex((l) => l.trim());
    const last = lines.length - 1 - [...lines].reverse().findIndex((l) => l.trim());
    const kept = lines.filter((l, i) => {
      const edge = i === first || i === last;
      return !PAGE_NUMBER.test(l) && !(edge && repeated.has(key(l)));
    });
    const text = kept
      .join('\n')
      .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { ...p, text: neutraliseInstructions(text) };
  });
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const sentences = (s: string) => s.split(/(?<=[.!?。])\s+(?=\S)/u);

/** A block that must stay whole if it can: code (indented or fenced), a table, or a formula line. */
const isStructured = (l: string) =>
  /^( {4}|\t|```)/.test(l) || (l.match(/\|/g)?.length ?? 0) >= 2 || /^\s*[$\\]/.test(l);

interface Block {
  text: string;
  heading: string;
  page: number | null;
  start: number | null;
  end: number | null;
}

/** Paragraph blocks of a page, with code and tables kept together. */
function blocksOf(page: ExtractedPage, heading: { current: string }): Block[] {
  const out: Block[] = [];
  const headings = new Set(page.headings);
  let buf: string[] = [];
  let structured = false;
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) out.push({ text, heading: heading.current, page: page.page, start: null, end: null });
    buf = [];
  };
  for (const line of page.text.split('\n')) {
    if (headings.has(line.trim())) {
      flush();
      heading.current = line.trim();
      buf.push(line);
      continue;
    }
    const s = isStructured(line);
    if (!line.trim() || s !== structured) {
      flush();
      structured = s;
    }
    if (line.trim()) buf.push(line);
  }
  flush();
  return out;
}

/** Packs blocks into chunks of about `target` tokens (never above `max`) with ~12% overlap. */
function pack(blocks: Block[], target: number, max: number): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Block[] = [];
  let tokens = 0;
  // False while `cur` holds only the overlap carried from the previous chunk.
  let fresh = false;
  const add = (b: Block, n: number) => {
    cur.push(b);
    tokens += n;
    fresh = true;
  };
  const emit = (sectionBreak = false) => {
    if (!cur.length || !fresh) return;
    const text = cur.map((b) => b.text).join('\n\n');
    const first = cur[0];
    const last = cur.at(-1);
    chunks.push({
      index: chunks.length,
      text,
      heading: first?.heading ?? '',
      page: first?.page ?? null,
      startSec: first?.start ?? null,
      endSec: last?.end ?? null,
      tokenCount: estimateTokens(text),
      contentHash: hash(text),
    });
    // Overlap: carry the last sentences (about 12% of the target) into the next chunk.
    const tail = last ? sentences(last.text) : [];
    const carried: string[] = [];
    let n = 0;
    while (tail.length && n < target * 0.12) {
      const s = tail.pop() ?? '';
      carried.unshift(s);
      n += estimateTokens(s);
    }
    // No overlap across a new heading: the next section starts clean.
    cur =
      !sectionBreak && last && carried.length && n < target * 0.3
        ? [{ ...last, text: carried.join(' ') }]
        : [];
    tokens = cur.reduce((t, b) => t + estimateTokens(b.text), 0);
    fresh = false;
  };
  for (const b of blocks) {
    const size = estimateTokens(b.text);
    // A new page always starts a new chunk, so a citation names the page the words are on; a new
    // section (heading) does once the current chunk has some substance.
    if (cur[0] && b.page !== null && b.page !== cur[0].page) {
      if (fresh) emit(true);
      // Overlap carried from the previous page would label this chunk with the wrong page.
      cur = [];
      tokens = 0;
    } else if (fresh && cur[0] && b.heading !== cur[0].heading && tokens >= target * 0.25) emit(true);
    if (size > max && !isStructured(b.text)) {
      // A long paragraph: split by sentences.
      let part: string[] = [];
      let n = 0;
      for (const s of sentences(b.text)) {
        if (n + estimateTokens(s) > target && part.length) {
          if (tokens + n > target) emit();
          add({ ...b, text: part.join(' ') }, n);
          emit();
          part = [];
          n = 0;
        }
        part.push(s);
        n += estimateTokens(s);
      }
      if (part.length) add({ ...b, text: part.join(' ') }, n);
      continue;
    }
    if (tokens + size > target && fresh) emit();
    add(b, size);
    if (tokens >= max) emit();
  }
  emit();
  return chunks.map((c, i) => ({ ...c, index: i }));
}

/** Structure-aware chunks of a document (by heading, paragraph and sentence). */
export function chunkPages(pages: ExtractedPage[], target = 500, max = 800): Chunk[] {
  const heading = { current: '' };
  return pack(
    pages.flatMap((p) => blocksOf(p, heading)),
    target,
    max,
  );
}

/** Chunks of a transcript by time (shorter, so a citation lands near the moment it is said). */
export function chunkSegments(
  segments: Segment[],
  chapters: { at: number; title: string }[] = [],
  target = 300,
): Chunk[] {
  const chapterAt = (t: number) => [...chapters].reverse().find((c) => c.at <= t)?.title ?? '';
  const blocks: Block[] = segments.map((s) => ({
    text: neutraliseInstructions(s.text),
    heading: chapterAt(s.start),
    page: null,
    start: s.start,
    end: s.end,
  }));
  return pack(blocks, target, target * 2);
}

export interface TopicRef {
  id: string;
  unitId: string;
  title: string;
  keywords: string[];
}

/**
 * Tags a passage to syllabus topics by keyword and heading match: a topic's whole title in the
 * text counts most, then its keywords, then its title words. At most three topics, best first.
 */
export function tagTopics(text: string, heading: string, topics: TopicRef[]): string[] {
  const hay = `${heading}\n${text}`.toLowerCase();
  const words = new Set(contentWords(hay));
  const scored = topics.map((t) => {
    let score = 0;
    const title = t.title.toLowerCase();
    if (title.length >= 4 && hay.includes(title)) score += heading.toLowerCase().includes(title) ? 6 : 4;
    for (const k of t.keywords) if (k.length >= 2 && hay.includes(k.toLowerCase())) score += 2;
    const tw = contentWords(title).filter((w) => w.length >= 4);
    if (tw.length) score += (tw.filter((w) => words.has(w)).length / tw.length) * 2;
    return { id: t.id, score };
  });
  return scored
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.id);
}
