import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { FieldCipher, randomToken, safeEqual, sha256 } from '../src/lib/crypto.js';
import { checkStrength, isBreached, verifyPassword, hashPassword } from '../src/lib/passwords.js';
import { ipPrefix, deviceLabel } from '../src/lib/request-meta.js';
import { TokenService } from '../src/lib/jwt.js';
import { renderEmail, MemoryMailProvider } from '../src/lib/mailer.js';
import { slugFromHost } from '../src/http/tenant.middleware.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('FieldCipher', () => {
  const c = new FieldCipher(KEY);
  it('round-trips and uses a fresh IV each time', () => {
    const a = c.encrypt('+91 98480 22338');
    expect(a).not.toBe(c.encrypt('+91 98480 22338'));
    expect(c.decrypt(a)).toBe('+91 98480 22338');
  });
  it('detects tampering and unknown formats', () => {
    const parts = c.encrypt('secret').split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => c.decrypt(parts.join('.'))).toThrow();
    expect(() => c.decrypt('v0.a.b.c')).toThrow(/Unsupported/);
  });
  it('blind index is deterministic and normalised', () => {
    expect(c.blindIndex(' A@B.com ')).toBe(c.blindIndex('a@b.com'));
    expect(c.blindIndex('a@b.com')).not.toBe(
      new FieldCipher(Buffer.alloc(32, 8).toString('base64')).blindIndex('a@b.com'),
    );
  });
  it('rejects short keys', () => {
    expect(() => new FieldCipher(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });
  it('helpers', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sha256('x')).toBe(sha256('x'));
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('passwords', () => {
  it('argon2id hash verifies and never throws on garbage', async () => {
    const h = await hashPassword('lantern-river-quiet-91');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'lantern-river-quiet-91')).toBe(true);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
  it('strength uses personal inputs', () => {
    expect(checkStrength('ananya1234', ['Ananya']).ok).toBe(false);
    expect(checkStrength('dpitcollege1', ['DPIT College']).ok).toBe(false);
    expect(checkStrength('violet-harbour-compass-73', []).ok).toBe(true);
  });
  it('HIBP: only the 5-char prefix leaves the server; matches suffix; fails open', async () => {
    const sha1 = createHash('sha1').update('hunter2').digest('hex').toUpperCase();
    let requested = '';
    const fake = (async (url: string) => {
      requested = url;
      return new Response(`${sha1.slice(5)}:42\r\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0`);
    }) as unknown as typeof fetch;
    expect(await isBreached('hunter2', fake)).toBe(true);
    expect(requested.endsWith(`/range/${sha1.slice(0, 5)}`)).toBe(true);
    expect(await isBreached('something-else-entirely', fake)).toBe(false);
    expect(
      await isBreached('x', (async () => new Response('', { status: 503 })) as unknown as typeof fetch),
    ).toBe(false);
    expect(
      await isBreached('x', (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch),
    ).toBe(false);
  });
});

describe('request metadata minimisation', () => {
  it.each([
    ['203.0.113.77', '203.0.113.0/24'],
    ['::ffff:198.51.100.9', '198.51.100.0/24'],
    ['2001:db8:abcd:12::1', '2001:db8:abcd::/48'],
    [undefined, null],
    ['garbage', null],
  ])('ipPrefix(%s) → %s', (ip, out) => expect(ipPrefix(ip)).toBe(out));
  it.each([
    ['Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/130 Mobile Safari/537', 'Chrome on Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Version/18 Mobile Safari/604', 'Safari on iOS'],
    ['Mozilla/5.0 (Windows NT 10.0) Gecko Firefox/131', 'Firefox on Windows'],
    ['Mozilla/5.0 (Macintosh; Mac OS X 14) Chrome/130 Edg/130', 'Edge on macOS'],
    [undefined, 'Unknown device'],
  ])('deviceLabel', (ua, out) => expect(deviceLabel(ua)).toBe(out));
});

describe('host → tenant slug', () => {
  it.each([
    ['dpit.localhost', 'dpit'],
    ['DPIT.localhost.', 'dpit'],
    ['localhost', null],
    ['a.b.localhost', null],
    ['evil.com', null],
    ['-bad.localhost', null],
    [undefined, null],
  ])('%s → %s', (h, out) => expect(slugFromHost(h, 'localhost')).toBe(out));
});

describe('TokenService', () => {
  const t = new TokenService('a'.repeat(40), 'b'.repeat(40), 900);
  it('access tokens and MFA tickets are not interchangeable', async () => {
    const access = await t.signAccess({ sub: 'u', tid: 't', sid: 's', ver: 0 });
    const ticket = await t.signMfaTicket({ sub: 'u', tid: 't' });
    expect(await t.verifyAccess(access)).toMatchObject({ sub: 'u', tid: 't' });
    expect(await t.verifyAccess(ticket)).toBeNull();
    expect(await t.verifyMfaTicket(access)).toBeNull();
    expect(await t.verifyMfaTicket(ticket)).toMatchObject({ sub: 'u' });
    expect(await new TokenService('c'.repeat(40), 'b'.repeat(40), 900).verifyAccess(access)).toBeNull();
  });
});

describe('email rendering', () => {
  it('escapes every interpolated value', async () => {
    const r = renderEmail({
      college: '<b>X</b>',
      heading: 'Hi "there"',
      body: "a & b's",
      cta: { label: '<go>', url: 'https://x.test/?a=1&b=<2>' },
      footer: 'f',
    });
    expect(r.html).not.toContain('<b>X</b>');
    expect(r.html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(r.html).toContain('a &amp; b&#39;s');
    expect(r.text).toContain('https://x.test/?a=1&b=<2>');
    const m = new MemoryMailProvider();
    await m.send({ to: 'a@b.c', subject: 's', text: 't' });
    expect(m.lastTo('a@b.c')?.subject).toBe('s');
    expect(m.lastTo('nobody@b.c')).toBeUndefined();
  });
});
