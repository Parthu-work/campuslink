import { describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, PASSWORD, testApp } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { SessionModel } from '../src/modules/auth/session.model.js';

/**
 * Prompt 4, P3: behind Cloudflare and the origin's nginx, the API must see the member's address
 * (rate limits, audit rows, session records) and must never believe an address the client typed.
 * The edge overwrites X-Forwarded-For with the address it verified (deploy/nginx), so the API
 * trusts exactly one hop: TRUST_PROXY_HOPS=1.
 */
async function prefixSeen(hops: string, forwardedFor: string | null) {
  const ctx = testApp({}, { TRUST_PROXY_HOPS: hops });
  const slug = `tp${hops}${forwardedFor ? forwardedFor.length : 0}`;
  const tenant = await makeTenant(slug);
  const user = await makeUser(ctx, tenant, { roles: ['STUDENT'] });
  await runInTenant(tenant._id, () => SessionModel.deleteMany({}));
  const req = api(ctx, tenant.host).post('/auth/login');
  if (forwardedFor) req.set('X-Forwarded-For', forwardedFor);
  const res = await req.send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  const session = await runInTenant(tenant._id, () => SessionModel.findOne({}).lean());
  return session?.createdIpPrefix ?? null;
}

describe('the forwarded address is read only through the configured hops', () => {
  it('with no trusted proxy (the default), X-Forwarded-For is ignored', async () => {
    const seen = await prefixSeen('0', '203.0.113.9');
    expect(seen).not.toBe('203.0.113.0/24');
    // The socket's own address (loopback in this test).
    expect(seen).toMatch(/^(127\.0\.0\.0\/24|::1.*|0:0:0::\/48)$/);
  });

  it('with one hop (the edge), the address the edge set is used', async () => {
    expect(await prefixSeen('1', '203.0.113.9')).toBe('203.0.113.0/24');
  });

  it('with one hop, an address the client put in front is not believed', async () => {
    // "client-typed, edge-appended": only the last entry, added by the trusted hop, counts.
    expect(await prefixSeen('1', '198.51.100.77, 203.0.113.9')).toBe('203.0.113.0/24');
  });
});
