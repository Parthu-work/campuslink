import { lookup as dnsLookup } from 'node:dns/promises';
import { Agent, fetch as undiciFetch } from 'undici';
import ipaddr from 'ipaddr.js';

export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

/** Only globally routable unicast addresses are allowed (no private, loopback, link-local, CGNAT, ULA…). */
export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress())
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  return addr.range() === 'unicast';
}

export interface SafeFetchOptions {
  /** Allowed hostnames (exact) or suffixes starting with '.' — empty means any public host. */
  allowHosts?: readonly string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  /** Injected for tests. */
  resolve?: (host: string) => Promise<string[]>;
  allowHttp?: boolean;
}

export interface SafeResponse {
  status: number;
  contentType: string;
  body: Buffer;
  finalUrl: string;
}

const defaultResolve = async (host: string) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

function hostAllowed(host: string, allow: readonly string[] | undefined): boolean {
  if (!allow?.length) return true;
  return allow.some((a) => (a.startsWith('.') ? host.endsWith(a) : host === a));
}

/**
 * SSRF-safe GET: validates scheme, host allowlist and every resolved IP, pins the connection to the
 * vetted IP (no DNS-rebinding window), re-validates each redirect hop, and caps time and size.
 * All server-side fetching of user-supplied URLs MUST go through this function.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const { maxBytes = 5 * 1024 * 1024, timeoutMs = 10_000, maxRedirects = 3, resolve = defaultResolve } = opts;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError('Invalid URL');
  }
  const deadline = AbortSignal.timeout(timeoutMs);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:'))
      throw new SafeFetchError('Only https URLs are allowed');
    if (url.username || url.password) throw new SafeFetchError('Credentials in URLs are not allowed');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!hostAllowed(host, opts.allowHosts)) throw new SafeFetchError('This host is not allowed');
    const ips = ipaddr.isValid(host) ? [host] : await resolve(host).catch(() => []);
    if (!ips.length) throw new SafeFetchError('Could not resolve host');
    if (!ips.every(isPublicAddress)) throw new SafeFetchError('Destination address is not allowed');
    const pinned = ips[0] as string;

    const agent = new Agent({
      connect: {
        // Pin to the vetted address; TLS still verifies the original hostname (servername).
        lookup: (_h, _o, cb) => cb(null, [{ address: pinned, family: pinned.includes(':') ? 6 : 4 }]),
      },
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    try {
      const res = await undiciFetch(url, {
        redirect: 'manual',
        dispatcher: agent,
        signal: deadline,
        headers: { 'user-agent': 'CampusLink-Importer/1.0', ...opts.headers },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await res.body?.cancel();
        if (!loc) throw new SafeFetchError('Redirect without location');
        url = new URL(loc, url);
        continue;
      }
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) throw new SafeFetchError('Response is too large');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of res.body ?? []) {
        size += (chunk as Uint8Array).byteLength;
        if (size > maxBytes) throw new SafeFetchError('Response is too large');
        chunks.push(Buffer.from(chunk as Uint8Array));
      }
      return {
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        body: Buffer.concat(chunks),
        finalUrl: url.toString(),
      };
    } catch (e) {
      if (e instanceof SafeFetchError) throw e;
      throw new SafeFetchError(deadline.aborted ? 'The request timed out' : 'Could not fetch that URL');
    } finally {
      await agent.close();
    }
  }
  throw new SafeFetchError('Too many redirects');
}
