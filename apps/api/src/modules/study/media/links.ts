import type { safeFetch } from '../../../lib/safe-fetch.js';

export interface VideoLink {
  provider: 'youtube' | 'vimeo';
  videoId: string;
  /** The canonical watch address (what students open outside the app). */
  url: string;
  /** The privacy-enhanced player (loaded only after the student taps play). */
  embedUrl: string;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Recognises YouTube and Vimeo video addresses; anything else is null. */
export function parseVideoLink(raw: string): VideoLink | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else id = /^\/(?:shorts|embed|live)\/([^/]+)/.exec(u.pathname)?.[1] ?? null;
  }
  if (id && YT_ID.test(id))
    return {
      provider: 'youtube',
      videoId: id,
      url: `https://www.youtube.com/watch?v=${id}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    };
  if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    const v = /^\/(\d{4,12})(?:\/|$)/.exec(u.pathname)?.[1];
    if (v)
      return {
        provider: 'vimeo',
        videoId: v,
        url: `https://vimeo.com/${v}`,
        embedUrl: `https://player.vimeo.com/video/${v}?dnt=1`,
      };
  }
  return null;
}

/**
 * Title and channel through the provider's official oEmbed endpoint, via the SSRF-safe fetcher
 * (host-allowlisted). No scraping, and the video itself is never downloaded.
 */
export async function oembed(
  fetcher: typeof safeFetch,
  link: VideoLink,
): Promise<{ title: string; author: string; durationSec: number | null }> {
  const endpoint =
    link.provider === 'youtube'
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link.url)}`
      : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(link.url)}`;
  const res = await fetcher(endpoint, {
    allowHosts: link.provider === 'youtube' ? ['www.youtube.com'] : ['vimeo.com'],
    maxBytes: 64 * 1024,
    timeoutMs: 8000,
    maxRedirects: 1,
  });
  if (res.status !== 200)
    throw new Error(res.status === 404 || res.status === 401 ? 'not_found' : 'unavailable');
  const j = JSON.parse(res.body.toString('utf8')) as {
    title?: unknown;
    author_name?: unknown;
    duration?: unknown;
  };
  return {
    title: typeof j.title === 'string' ? j.title.slice(0, 160) : '',
    author: typeof j.author_name === 'string' ? j.author_name.slice(0, 120) : '',
    durationSec: typeof j.duration === 'number' && j.duration > 0 ? Math.round(j.duration) : null,
  };
}
