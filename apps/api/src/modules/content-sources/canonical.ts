import { createHash } from 'node:crypto';

const TRACKING =
  /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref|ref_src|cmpid|ncid|_hsenc|_hsmi|mkt_tok|yclid)$/i;

/** Canonical form for de-duplication: lowercase host, no fragment, no tracking params, sorted query. */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80'))
    u.port = '';
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  u.search = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const urlHash = (url: string) => sha256(canonicalUrl(url));
/** Near-duplicate key: the same story syndicated under different URLs. */
export const contentHash = (title: string, text: string) =>
  sha256(
    `${title.toLowerCase().replace(/\W+/g, ' ').trim()}|${text.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 200)}`,
  );
