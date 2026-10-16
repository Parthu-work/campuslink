import type { safeFetch } from './safe-fetch.js';
import { decodeEntities, plainText, snippet } from './text.js';

export interface LinkPreview {
  url: string;
  host: string;
  title: string;
  description: string;
  siteName: string;
}

function meta(html: string, key: string): string {
  // <meta property="og:title" content="…"> in either attribute order.
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i');
  return (re1.exec(html)?.[1] ?? re2.exec(html)?.[1] ?? '').trim();
}

/**
 * Title, description and site name of a shared link (no images: nothing is hotlinked). Fetched once
 * through the SSRF-safe fetcher with tight limits; any failure yields a host-only preview.
 */
export async function linkPreview(url: string, fetcher: typeof safeFetch): Promise<LinkPreview> {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const empty = { url, host, title: '', description: '', siteName: '' };
  try {
    const res = await fetcher(url, {
      maxBytes: 512 * 1024,
      timeoutMs: 5000,
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    if (res.status !== 200 || !/text\/html|application\/xhtml/i.test(res.contentType)) return empty;
    const html = res.body.toString('utf8').slice(0, 200_000);
    const head = html.split(/<\/head>/i)[0] ?? html;
    const clean = (s: string, max: number) => snippet(plainText(decodeEntities(s)), max);
    const title = clean(
      meta(head, 'og:title') ||
        meta(head, 'twitter:title') ||
        (/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1] ?? ''),
      140,
    );
    const description = clean(
      meta(head, 'og:description') || meta(head, 'description') || meta(head, 'twitter:description'),
      240,
    );
    const siteName = clean(meta(head, 'og:site_name'), 60);
    return { url, host, title, description, siteName };
  } catch {
    return empty;
  }
}
