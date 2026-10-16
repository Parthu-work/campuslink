import type { safeFetch, SafeResponse } from '../src/lib/safe-fetch.js';

/** Builds an ISO-BMFF box. */
export function box(type: string, payload: Buffer): Buffer {
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + payload.length, 0);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, payload]);
}
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

/** A tiny but structurally valid MP4 with the given duration, a GPS tag and an XMP-style box. */
export function fakeMp4(seconds: number): Buffer {
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), u32(512), Buffer.from('isomiso2avc1mp41')]));
  const mvhd = box(
    'mvhd',
    Buffer.concat([u32(0), u32(0), u32(0), u32(1000), u32(Math.round(seconds * 1000)), Buffer.alloc(80)]),
  );
  const tkhd = box('tkhd', Buffer.concat([Buffer.alloc(76), u32(1080 * 65536), u32(1920 * 65536)]));
  const trak = box('trak', Buffer.concat([tkhd, box('udta', Buffer.from('TRACK-SECRET-NAME'))]));
  const udta = box('udta', box('©xyz', Buffer.from('+17.3850+078.4867/GPS-SECRET')));
  const moov = box('moov', Buffer.concat([mvhd, trak, udta]));
  const mdat = box('mdat', Buffer.alloc(256, 7));
  return Buffer.concat([ftyp, moov, mdat]);
}

export const rss = (
  items: { title: string; link: string; description?: string; pubDate?: string }[],
  title = 'Demo feed',
) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${i.link}</link><description>${i.description ?? ''}</description><pubDate>${
          i.pubDate ?? new Date().toUTCString()
        }</pubDate></item>`,
    )
    .join('')}</channel></rss>`;

type Reply = { status?: number; body?: string; contentType?: string; headers?: SafeResponse['headers'] };

/**
 * Fake SSRF-safe fetcher: routes by exact URL, records calls. Unknown URLs fail like an unreachable
 * host. Lets ingestion and link previews be tested offline.
 */
export function fakeFetcher(routes: Record<string, Reply | (() => Reply)>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (url: string, opts: { headers?: Record<string, string> } = {}) => {
    calls.push({ url, headers: opts.headers ?? {} });
    const r = routes[url];
    if (!r) throw new Error('unreachable');
    const reply = typeof r === 'function' ? r() : r;
    return {
      status: reply.status ?? 200,
      contentType: reply.contentType ?? 'application/rss+xml',
      body: Buffer.from(reply.body ?? ''),
      finalUrl: url,
      headers: reply.headers ?? {},
    } satisfies SafeResponse;
  }) as unknown as typeof safeFetch;
  return { fn, calls, routes };
}
