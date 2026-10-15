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
