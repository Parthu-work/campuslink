import { lookup as dnsLookup } from 'node:dns/promises';
import { Agent, fetch as undiciFetch } from 'undici';
import ipaddr from 'ipaddr.js';
import { APP_NAME } from '@campuslink/shared';

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

export type SafeMethod = 'GET' | 'POST' | 'PUT';

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
  /**
   * POST is used for push delivery, bot checks and AI providers, PUT for the vector store; redirects
   * are followed only for GET.
   */
  method?: SafeMethod;
  body?: Buffer | string;
  /**
   * Lets this request reach private addresses (and plain http). Only for endpoints the platform
   * owner allowlisted in the environment (AI_PRIVATE_ENDPOINTS, such as a local Ollama); never set it
   * from tenant input.
   */
  allowPrivateNetwork?: boolean;
  /** Cancels the request (a member pressed Stop); the deadline still applies. */
  signal?: AbortSignal;
  /**
   * Called with each piece of the body as it arrives (streamed AI answers), with the status. The
   * size cap still applies and the whole body is still returned at the end.
   */
  onChunk?: (chunk: Buffer, status: number) => void;
}

export interface SafeResponse {
  status: number;
  contentType: string;
  body: Buffer;
  finalUrl: string;
  /** Caching and back-off headers only (lowercase names). */
  headers?: Partial<Record<'etag' | 'last-modified' | 'cache-control' | 'retry-after', string>>;
}
const KEPT_HEADERS = ['etag', 'last-modified', 'cache-control', 'retry-after'] as const;

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
/** One HTTP hop to an already-vetted, pinned address. Injectable so the guard logic is testable offline. */
export interface TransportResponse {
  status: number;
  header(name: string): string | null;
  body: AsyncIterable<Uint8Array> | null;
  cancel(): Promise<void>;
}
export type Transport = (
  url: URL,
  pinnedIp: string,
  init: {
    signal: AbortSignal;
    headers: Record<string, string>;
    timeoutMs: number;
    method: SafeMethod;
    body?: Buffer | string | undefined;
  },
) => Promise<TransportResponse>;

export const undiciTransport: Transport = async (url, pinnedIp, init) => {
  const agent = new Agent({
    connect: {
      // Pin to the vetted address; TLS still verifies the original hostname (servername).
      lookup: (_h, _o, cb) => cb(null, [{ address: pinnedIp, family: pinnedIp.includes(':') ? 6 : 4 }]),
    },
    headersTimeout: init.timeoutMs,
    bodyTimeout: init.timeoutMs,
  });
  const res = await undiciFetch(url, {
    redirect: 'manual',
    dispatcher: agent,
    signal: init.signal,
    headers: init.headers,
    method: init.method,
    ...(init.body !== undefined ? { body: init.body } : {}),
  }).catch(async (e: unknown) => {
    await agent.close();
    throw e;
  });
  async function* body() {
    try {
      for await (const chunk of res.body ?? []) yield chunk as Uint8Array;
    } finally {
      await agent.close();
    }
  }
  return {
    status: res.status,
    header: (n) => res.headers.get(n),
    body: res.body ? body() : null,
    cancel: async () => {
      await res.body?.cancel();
      await agent.close();
    },
  };
};

/**
 * SSRF-safe GET: validates scheme, host allowlist and every resolved IP, pins the connection to the
 * vetted IP (no DNS-rebinding window), re-validates each redirect hop, and caps time and size.
 * All server-side fetching of user-supplied URLs MUST go through this function.
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions & { transport?: Transport } = {},
): Promise<SafeResponse> {
  const {
    maxBytes = 5 * 1024 * 1024,
    timeoutMs = 10_000,
    maxRedirects = 3,
    resolve = defaultResolve,
    transport = undiciTransport,
  } = opts;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError('Invalid URL');
  }
  const deadline = opts.signal
    ? AbortSignal.any([AbortSignal.timeout(timeoutMs), opts.signal])
    : AbortSignal.timeout(timeoutMs);
  const why = () =>
    opts.signal?.aborted ? 'The request was cancelled' : deadline.aborted ? 'The request timed out' : null;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const http = opts.allowHttp || opts.allowPrivateNetwork;
    if (url.protocol !== 'https:' && !(http && url.protocol === 'http:'))
      throw new SafeFetchError('Only https URLs are allowed');
    if (url.username || url.password) throw new SafeFetchError('Credentials in URLs are not allowed');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!hostAllowed(host, opts.allowHosts)) throw new SafeFetchError('This host is not allowed');
    const ips = ipaddr.isValid(host) ? [host] : await resolve(host).catch(() => []);
    if (!ips.length) throw new SafeFetchError('Could not resolve host');
    if (!opts.allowPrivateNetwork && !ips.every(isPublicAddress))
      throw new SafeFetchError('Destination address is not allowed');

    let res: TransportResponse;
    try {
      res = await transport(url, ips[0] as string, {
        signal: deadline,
        timeoutMs,
        method: opts.method ?? 'GET',
        body: opts.body,
        headers: { 'user-agent': `${APP_NAME}-Fetcher/1.0`, ...opts.headers },
      });
    } catch {
      throw new SafeFetchError(why() ?? 'Could not fetch that URL');
    }
    if (res.status >= 300 && res.status < 400 && (opts.method ?? 'GET') === 'GET') {
      const loc = res.header('location');
      await res.cancel();
      if (!loc) throw new SafeFetchError('Redirect without location');
      url = new URL(loc, url);
      continue;
    }
    if (Number(res.header('content-length') ?? 0) > maxBytes) {
      await res.cancel();
      throw new SafeFetchError('Response is too large');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of res.body ?? []) {
        size += chunk.byteLength;
        if (size > maxBytes) {
          await res.cancel();
          throw new SafeFetchError('Response is too large');
        }
        const piece = Buffer.from(chunk);
        chunks.push(piece);
        opts.onChunk?.(piece, res.status);
      }
    } catch (e) {
      if (e instanceof SafeFetchError) throw e;
      throw new SafeFetchError(why() ?? 'Could not fetch that URL');
    }
    const headers: SafeResponse['headers'] = {};
    for (const h of KEPT_HEADERS) {
      const v = res.header(h);
      if (v) headers[h] = v.slice(0, 500);
    }
    return {
      status: res.status,
      contentType: res.header('content-type') ?? '',
      body: Buffer.concat(chunks),
      finalUrl: url.toString(),
      headers,
    };
  }
  throw new SafeFetchError('Too many redirects');
}
