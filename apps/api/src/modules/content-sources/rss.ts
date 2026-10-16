import { XMLParser } from 'fast-xml-parser';
import { decodeEntities, plainText, snippet } from '../../lib/text.js';

export interface FeedItem {
  title: string;
  url: string;
  snippet: string;
  publishedAt: Date;
  categories: string[];
}
export interface ParsedFeed {
  format: 'rss' | 'atom';
  title: string;
  items: FeedItem[];
}

export class FeedParseError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: false,
  trimValues: true,
  isArray: (name) => ['item', 'entry', 'link', 'category'].includes(name),
  // Bodies may contain unescaped HTML: keep them as raw text and strip markup ourselves.
  stopNodes: ['*.description', '*.content:encoded', '*.summary', '*.content'],
});

type Node = Record<string, unknown>;
const textOf = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return textOf(v[0]);
  if (typeof v === 'object') return textOf((v as Node)['#text'] ?? (v as Node)['@_term'] ?? '');
  return '';
};
const clean = (s: string, max: number) =>
  snippet(plainText(decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))), max);
const isWebUrl = (u: string) => {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
};
function date(s: string, now: Date): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 86_400_000) return now;
  return d;
}

/**
 * True when the document declares a DTD or entities anywhere in its markup. CDATA sections and
 * comments are text, so they are removed first (articles often quote `<!DOCTYPE html>` there);
 * outside them a literal `<!` can only be markup.
 */
export function declaresDtd(xml: string): boolean {
  const markup = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  return /<!DOCTYPE|<!ENTITY/i.test(markup);
}

/**
 * RSS 2.0 / Atom 1.0. Documents with a DOCTYPE or ENTITY declaration are refused outright (no DTD
 * processing at all: no XXE, no entity expansion bombs). Only snippets are kept, never full articles.
 */
export function parseFeed(xml: string, now = new Date()): ParsedFeed {
  if (declaresDtd(xml)) throw new FeedParseError('Feeds with DTDs are not supported');
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch {
    throw new FeedParseError('Not a valid XML feed');
  }
  const rss = doc.rss as Node | undefined;
  const atom = doc.feed as Node | undefined;
  if (rss?.channel) {
    const ch = (Array.isArray(rss.channel) ? rss.channel[0] : rss.channel) as Node;
    const items = ((ch.item as Node[] | undefined) ?? []).slice(0, 100).map((it) => {
      const link = textOf((it.link as unknown[] | undefined)?.[0]) || textOf(it.guid);
      return {
        title: clean(textOf(it.title), 200),
        url: link.trim(),
        snippet: clean(textOf(it.description) || textOf(it['content:encoded']), 280),
        publishedAt: date(textOf(it.pubDate) || textOf(it['dc:date']), now),
        categories: ((it.category as unknown[] | undefined) ?? []).map(textOf).filter(Boolean).slice(0, 10),
      };
    });
    return {
      format: 'rss',
      title: clean(textOf(ch.title), 120),
      items: items.filter((i) => i.title && isWebUrl(i.url)),
    };
  }
  if (atom) {
    const items = ((atom.entry as Node[] | undefined) ?? []).slice(0, 100).map((e) => {
      const links = (e.link as Node[] | undefined) ?? [];
      const alt = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? links[0];
      return {
        title: clean(textOf(e.title), 200),
        url: String(alt?.['@_href'] ?? '').trim(),
        snippet: clean(textOf(e.summary) || textOf(e.content), 280),
        publishedAt: date(textOf(e.published) || textOf(e.updated), now),
        categories: ((e.category as Node[] | undefined) ?? [])
          .map((c) => String(c['@_term'] ?? textOf(c)))
          .filter(Boolean)
          .slice(0, 10),
      };
    });
    return {
      format: 'atom',
      title: clean(textOf(atom.title), 120),
      items: items.filter((i) => i.title && isWebUrl(i.url)),
    };
  }
  throw new FeedParseError('This is not an RSS or Atom feed');
}
