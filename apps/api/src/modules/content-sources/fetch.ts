import { APP_NAME } from '@campuslink/shared';
import type { safeFetch } from '../../lib/safe-fetch.js';
import { SafeFetchError } from '../../lib/safe-fetch.js';
import { parseRobots, robotsAllows, type Robots } from '../../lib/robots.js';
import { FeedParseError, parseFeed, type ParsedFeed } from './rss.js';

export const BOT_TOKEN = `${APP_NAME}Bot`;
const USER_AGENT = `${BOT_TOKEN}/1.0 (+snippets and links only; respects robots.txt)`;
const FEED_TYPES = /xml|rss|atom|text\/plain/i;

export type FetchOutcome =
  | {
      kind: 'ok';
      feed: ParsedFeed;
      etag: string | null;
      lastModified: string | null;
      maxAgeSec: number | null;
    }
  | { kind: 'not_modified'; maxAgeSec: number | null }
  | { kind: 'blocked'; message: string }
  | { kind: 'error'; message: string; retryAfterSec: number | null };

const robotsCache = new Map<string, { at: number; ttl: number; robots: Robots | 'allow' | 'deny' }>();
export const clearRobotsCache = () => robotsCache.clear();

async function robotsFor(origin: string, fetcher: typeof safeFetch): Promise<Robots | 'allow' | 'deny'> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.robots;
  let robots: Robots | 'allow' | 'deny';
  try {
    const res = await fetcher(`${origin}/robots.txt`, {
      maxBytes: 512 * 1024,
      timeoutMs: 8000,
      headers: { 'user-agent': USER_AGENT },
    });
    if (res.status >= 200 && res.status < 300) robots = parseRobots(res.body.toString('utf8'));
    else if (res.status >= 400 && res.status < 500 && res.status !== 429)
      robots = 'allow'; // RFC 9309 §2.3.1.3
    else robots = 'deny';
  } catch {
    robots = 'deny'; // unreachable: assume complete disallow, try again later
  }
  robotsCache.set(origin, { at: Date.now(), ttl: robots === 'deny' ? 3600_000 : 24 * 3600_000, robots });
  return robots;
}

function maxAge(cacheControl: string): number | null {
  const m = /max-age=(\d{1,7})/i.exec(cacheControl);
  return m ? Number(m[1]) : null;
}

/**
 * One polite fetch of a feed: robots.txt first, conditional request (ETag / Last-Modified),
 * Retry-After honoured, size and time capped, all through the SSRF-safe fetcher.
 */
export async function fetchFeed(
  url: string,
  fetcher: typeof safeFetch,
  cache: { etag?: string | null; lastModified?: string | null } = {},
): Promise<FetchOutcome> {
  const u = new URL(url);
  const robots = await robotsFor(u.origin, fetcher);
  if (robots === 'deny' || (robots !== 'allow' && !robotsAllows(robots, BOT_TOKEN, u.pathname + u.search)))
    return { kind: 'blocked', message: 'robots.txt does not allow fetching this feed' };
  let res;
  try {
    res = await fetcher(url, {
      maxBytes: 3 * 1024 * 1024,
      timeoutMs: 15_000,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
        ...(cache.etag ? { 'if-none-match': cache.etag } : {}),
        ...(cache.lastModified ? { 'if-modified-since': cache.lastModified } : {}),
      },
    });
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof SafeFetchError ? e.message : 'Fetch failed',
      retryAfterSec: null,
    };
  }
  const age = maxAge(res.headers?.['cache-control'] ?? '');
  if (res.status === 304) return { kind: 'not_modified', maxAgeSec: age };
  if (res.status === 429 || res.status === 503) {
    const ra = res.headers?.['retry-after'];
    const secs = ra
      ? /^\d+$/.test(ra)
        ? Number(ra)
        : Math.max(0, (new Date(ra).getTime() - Date.now()) / 1000)
      : NaN;
    return {
      kind: 'error',
      message: `The source asked us to slow down (${res.status})`,
      retryAfterSec: Number.isFinite(secs) ? Math.min(Math.max(secs, 300), 86_400) : 3600,
    };
  }
  if (res.status !== 200)
    return { kind: 'error', message: `The source returned ${res.status}`, retryAfterSec: null };
  if (res.contentType && !FEED_TYPES.test(res.contentType))
    return {
      kind: 'error',
      message: `Unexpected content type ${res.contentType.split(';')[0]}`,
      retryAfterSec: null,
    };
  try {
    const feed = parseFeed(res.body.toString('utf8'));
    return {
      kind: 'ok',
      feed,
      etag: res.headers?.etag ?? null,
      lastModified: res.headers?.['last-modified'] ?? null,
      maxAgeSec: age,
    };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof FeedParseError ? e.message : 'Could not read the feed',
      retryAfterSec: null,
    };
  }
}
