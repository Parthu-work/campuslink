import { describe, expect, it } from 'vitest';
import { isPublicAddress, safeFetch } from '../src/lib/safe-fetch.js';

describe('isPublicAddress', () => {
  it.each([
    ['8.8.8.8', true],
    ['142.250.183.14', true],
    ['2404:6800:4007:80a::200e', true],
    ['127.0.0.1', false],
    ['10.0.0.5', false],
    ['172.16.3.4', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['::1', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:10.1.1.1', false],
    ['not-an-ip', false],
  ])('%s → %s', (ip, ok) => expect(isPublicAddress(ip)).toBe(ok));
});

describe('safeFetch guards (no network needed)', () => {
  const resolveTo = (ip: string) => async () => [ip];
  it.each([
    ['http://example.com/x', {}, /Only https/],
    ['https://user:pass@example.com/x', {}, /Credentials/],
    ['https://127.0.0.1/x', {}, /not allowed/],
    ['https://[::1]/x', {}, /not allowed/],
    ['https://metadata.internal/x', { resolve: resolveTo('169.254.169.254') }, /not allowed/],
    ['https://rebind.example/x', { resolve: async () => ['93.184.216.34', '10.0.0.1'] }, /not allowed/],
    ['https://evil.example/x', { allowHosts: ['docs.google.com'] }, /host is not allowed/],
    ['not a url', {}, /Invalid URL/],
  ] as const)('%s is refused', async (url, opts, msg) => {
    await expect(safeFetch(url, opts)).rejects.toThrow(msg);
  });
  it('allows suffix host rules', async () => {
    await expect(
      safeFetch('https://x.googleusercontent.com/a', {
        allowHosts: ['.googleusercontent.com'],
        resolve: resolveTo('10.1.1.1'),
      }),
    ).rejects.toThrow(/address is not allowed/);
  });
});

describe('safeFetch with a fake transport (redirects, size caps, pinning)', () => {
  const PUBLIC = '93.184.216.34';
  const resolve = async (h: string) => (h === 'internal.example' ? ['10.0.0.7'] : [PUBLIC]);
  const reply = (status: number, headers: Record<string, string>, body = '') => ({
    status,
    header: (n: string) => headers[n.toLowerCase()] ?? null,
    body: (async function* () {
      if (body) yield new TextEncoder().encode(body);
    })(),
    cancel: async () => undefined,
  });

  it('returns the body and pins the vetted IP', async () => {
    const seen: string[] = [];
    const r = await safeFetch('https://data.example/x.csv', {
      resolve,
      transport: async (u, ip) => (
        seen.push(`${u.host}@${ip}`),
        reply(200, { 'content-type': 'text/csv' }, 'a,b')
      ),
    });
    expect(r).toMatchObject({ status: 200, contentType: 'text/csv', finalUrl: 'https://data.example/x.csv' });
    expect(r.body.toString()).toBe('a,b');
    expect(seen).toEqual([`data.example@${PUBLIC}`]);
  });

  it('re-validates every redirect hop (redirect to a private host is refused)', async () => {
    const transport = async (u: URL) =>
      u.host === 'start.example'
        ? reply(302, { location: 'https://internal.example/secret' })
        : reply(200, {}, 'leak');
    await expect(safeFetch('https://start.example/', { resolve, transport })).rejects.toThrow(
      /address is not allowed/,
    );
    const toHttp = async () => reply(301, { location: 'http://plain.example/' });
    await expect(safeFetch('https://start.example/', { resolve, transport: toHttp })).rejects.toThrow(
      /Only https/,
    );
  });

  it('follows a bounded number of safe redirects', async () => {
    let n = 0;
    const loop = async () => reply(302, { location: `https://hop${++n}.example/` });
    await expect(
      safeFetch('https://start.example/', { resolve, transport: loop, maxRedirects: 2 }),
    ).rejects.toThrow(/Too many redirects/);
    await expect(
      safeFetch('https://start.example/', { resolve, transport: async () => reply(302, {}) }),
    ).rejects.toThrow(/without location/);
  });

  it('caps size by header and by streamed bytes', async () => {
    await expect(
      safeFetch('https://big.example/', {
        resolve,
        maxBytes: 10,
        transport: async () => reply(200, { 'content-length': '999' }),
      }),
    ).rejects.toThrow(/too large/);
    await expect(
      safeFetch('https://big.example/', {
        resolve,
        maxBytes: 10,
        transport: async () => reply(200, {}, 'x'.repeat(50)),
      }),
    ).rejects.toThrow(/too large/);
  });

  it('reaches a private address only when the platform allowlisted the endpoint', async () => {
    const transport = async () => reply(200, { 'content-type': 'application/json' }, '{}');
    await expect(safeFetch('http://internal.example/v1/models', { resolve, transport })).rejects.toThrow(
      /Only https/,
    );
    await expect(safeFetch('https://internal.example/v1/models', { resolve, transport })).rejects.toThrow(
      /address is not allowed/,
    );
    const r = await safeFetch('http://internal.example/v1/models', {
      resolve,
      transport,
      allowPrivateNetwork: true,
    });
    expect(r.status).toBe(200);
  });

  it('hands each piece of the body over as it arrives, with the status, under the size cap', async () => {
    const pieces: string[] = [];
    const r = await safeFetch('https://api.example/stream', {
      resolve,
      method: 'POST',
      transport: async () => ({
        status: 200,
        header: () => null,
        body: (async function* () {
          yield new TextEncoder().encode('data: 1\n\n');
          yield new TextEncoder().encode('data: 2\n\n');
        })(),
        cancel: async () => undefined,
      }),
      onChunk: (c, status) => pieces.push(`${status}:${c.toString()}`),
    });
    expect(pieces).toEqual(['200:data: 1\n\n', '200:data: 2\n\n']);
    expect(r.body.toString()).toBe('data: 1\n\ndata: 2\n\n');
  });

  it('a cancelled request says so (the member pressed Stop)', async () => {
    const ac = new AbortController();
    const slow = async (_u: URL, _ip: string, init: { signal: AbortSignal }) => ({
      status: 200,
      header: () => null,
      body: (async function* () {
        yield new TextEncoder().encode('first');
        ac.abort();
        await new Promise((resolveWait) => setTimeout(resolveWait, 5));
        if (init.signal.aborted) throw new Error('aborted');
        yield new TextEncoder().encode('never');
      })(),
      cancel: async () => undefined,
    });
    await expect(
      safeFetch('https://api.example/stream', { resolve, transport: slow, signal: ac.signal }),
    ).rejects.toThrow('The request was cancelled');
  });

  it('maps transport failures to a safe message', async () => {
    await expect(
      safeFetch('https://down.example/', {
        resolve,
        transport: async () => {
          throw new Error('ECONNRESET 10.0.0.1');
        },
      }),
    ).rejects.toThrow('Could not fetch that URL');
  });
});
