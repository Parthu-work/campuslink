import { unzipSync, strFromU8 } from 'fflate';
import { assertSafeZip } from '../../../lib/zip-guard.js';
import type { ExtractedPage } from './pdf.js';

const ZIP_LIMITS = { maxTotal: 150 * 1024 * 1024, maxRatio: 120, maxEntries: 5000 };

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

/** Opens an Office file (a ZIP) after the zip-bomb check, keeping only the XML parts we read. */
function open(data: Buffer, want: (name: string) => boolean): Record<string, string> {
  assertSafeZip(data, ZIP_LIMITS);
  const files = unzipSync(new Uint8Array(data), { filter: (f) => want(f.name) });
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
}

/** Text of each `<w:p>` (Word) or `<a:p>` (PowerPoint) paragraph, with tabs and breaks kept. */
function paragraphs(xml: string, ns: 'w' | 'a'): { text: string; style: string }[] {
  const out: { text: string; style: string }[] = [];
  const para = new RegExp(`<${ns}:p[ >][\\s\\S]*?</${ns}:p>|<${ns}:p/>`, 'g');
  for (const m of xml.matchAll(para)) {
    const p = m[0];
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '';
    let text = '';
    for (const r of p.matchAll(
      new RegExp(`<${ns}:t(?: [^>]*)?>([\\s\\S]*?)</${ns}:t>|<${ns}:(tab|br)\\b[^>]*/>`, 'g'),
    ))
      text += r[1] !== undefined ? decode(r[1]) : r[2] === 'tab' ? '\t' : '\n';
    out.push({ text: text.trim(), style });
  }
  return out;
}

/** A Word document as one page of paragraphs; Heading styles become headings. */
export function extractDocx(data: Buffer): { pages: ExtractedPage[]; pageCount: number } {
  const parts = open(data, (n) => n === 'word/document.xml');
  const xml = parts['word/document.xml'];
  if (!xml) throw new Error('This document has no body');
  const paras = paragraphs(xml, 'w').filter((p) => p.text);
  return {
    pageCount: 1,
    pages: [
      {
        page: 1,
        text: paras.map((p) => p.text).join('\n'),
        headings: paras.filter((p) => /^(Heading|Title)/i.test(p.style)).map((p) => p.text),
      },
    ],
  };
}

/** A slide deck: one page per slide (the slide's text, then its speaker notes). */
export function extractPptx(data: Buffer): { pages: ExtractedPage[]; pageCount: number } {
  const parts = open(data, (n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n));
  const num = (n: string) => Number(/(\d+)\.xml$/.exec(n)?.[1] ?? 0);
  const slides = Object.keys(parts)
    .filter((n) => n.startsWith('ppt/slides/'))
    .sort((a, b) => num(a) - num(b));
  const pages = slides.map((name, i) => {
    const xml = parts[name] ?? '';
    const text = paragraphs(xml, 'a')
      .map((p) => p.text)
      .filter(Boolean);
    const notesXml = parts[`ppt/notesSlides/notesSlide${num(name)}.xml`];
    // The notes part repeats the slide number as text; keep lines with words.
    const notes = notesXml
      ? paragraphs(notesXml, 'a')
          .map((p) => p.text)
          .filter((t) => /\p{L}/u.test(t))
      : [];
    return {
      page: i + 1,
      text: [...text, ...(notes.length ? ['', ...notes] : [])].join('\n').trim(),
      headings: text[0] ? [text[0]] : [],
    };
  });
  return { pages, pageCount: pages.length };
}
