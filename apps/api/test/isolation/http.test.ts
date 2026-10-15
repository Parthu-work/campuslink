/**
 * MANDATORY tenant-isolation suite (HTTP layer). Blocks CI.
 * A user, token, cookie, ticket or link from college A must never read or change college B.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { generate } from 'otplib';
import {
  api,
  cookiesFrom,
  makeTenant,
  makeUser,
  testApp,
  PASSWORD,
  type TestTenant,
  type TestUser,
} from '../helpers.js';
import { runInTenant } from '../../src/lib/context.js';
import { AuditModel } from '../../src/modules/audit/audit.model.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let adminA: TestUser, adminB: TestUser, studentA: TestUser, studentB: TestUser;

beforeAll(async () => {
  A = await makeTenant('alpha');
  B = await makeTenant('bravo');
  adminA = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  adminB = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
  studentA = await makeUser(ctx, A, { roles: ['STUDENT'], email: 'same.person@example.com' });
  studentB = await makeUser(ctx, B, { roles: ['STUDENT'], email: 'same.person@example.com' });
});

describe('tokens are bound to their college', () => {
  it('rejects an access token from A on B’s subdomain', async () => {
    const r = await api(ctx, B.host, studentA.token).get('/me');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('TENANT_MISMATCH');
  });
  it('rejects an admin token from A on B’s admin routes', async () => {
    const r = await api(ctx, B.host, adminA.token).get('/admin/users');
    expect(r.body.error.code).toBe('TENANT_MISMATCH');
  });
  it('the same email in two colleges is two separate accounts', async () => {
    const a = await api(ctx, A.host, studentA.token).get('/me');
    const b = await api(ctx, B.host, studentB.token).get('/me');
    expect(a.body.data.id).not.toBe(b.body.data.id);
  });
  it('a password valid in A does not sign in to B', async () => {
    const solo = await makeUser(ctx, A, { roles: ['ALUMNI'] });
    const r = await api(ctx, B.host).post('/auth/login').send({ email: solo.email, password: PASSWORD });
    expect(r.status).toBe(401);
  });
  it('a refresh cookie from A cannot refresh on B', async () => {
    const login = await api(ctx, A.host)
      .post('/auth/login')
      .send({ email: studentA.email, password: PASSWORD });
    const c = cookiesFrom(login);
    const r = await api(ctx, B.host)
      .post('/auth/refresh')
      .set('Cookie', c.cookie)
      .set('X-CSRF-Token', c.csrf);
    expect(r.status).toBe(401);
    // and the A session is untouched (no false reuse detection)
    expect(
      (await api(ctx, A.host).post('/auth/refresh').set('Cookie', c.cookie).set('X-CSRF-Token', c.csrf))
        .status,
    ).toBe(200);
  });
  it('an MFA ticket from A cannot be redeemed on B', async () => {
    const step1 = await api(ctx, A.host)
      .post('/auth/login')
      .send({ email: adminA.email, password: PASSWORD });
    const r = await api(ctx, B.host)
      .post('/auth/login/mfa')
      .send({ ticket: step1.body.data.ticket, code: await generate({ secret: adminA.mfaSecret! }) });
    expect(r.status).toBe(401);
  });
  it('email links from A do not work on B', async () => {
    await api(ctx, A.host).post('/auth/password/forgot').send({ email: studentA.email });
    const token = /token=([A-Za-z0-9_-]+)/.exec(ctx.mailer.lastTo(studentA.email)?.text ?? '')![1]!;
    expect(ctx.mailer.lastTo(studentA.email)?.text).toContain('alpha.localhost');
    const r = await api(ctx, B.host)
      .post('/auth/password/reset')
      .send({ token, password: 'violet-harbour-compass-73' });
    expect(r.status).toBe(400);
  });
});

describe('object-level access across colleges (IDOR)', () => {
  it('admin A cannot read, change roles, capabilities or status of a user in B', async () => {
    const list = await api(ctx, A.host, adminA.token).get('/admin/users?limit=50');
    expect(list.body.data.map((u: { id: string }) => u.id)).not.toContain(studentB.id);
    for (const [path, body] of [
      [`/admin/users/${studentB.id}/roles`, { roles: ['ALUMNI'] }],
      [`/admin/users/${studentB.id}/capabilities`, { capabilities: ['CERTIFIED_CONTRIBUTOR'] }],
      [`/admin/users/${studentB.id}/status`, { status: 'suspended' }],
    ] as const) {
      const r = await api(ctx, A.host, adminA.token).patch(path).send(body);
      expect(r.status, path).toBe(404);
    }
    expect((await api(ctx, B.host, studentB.token).get('/me')).status).toBe(200);
  });
  it('search in A never returns B’s users', async () => {
    const r = await api(ctx, A.host, adminA.token).get('/admin/users?q=same.person');
    expect(r.body.data.map((u: { id: string }) => u.id)).toEqual([studentA.id]);
  });
  it('A cannot revoke a session that belongs to B', async () => {
    const sessionsB = await api(ctx, B.host, studentB.token).get('/auth/sessions');
    const r = await api(ctx, A.host, studentA.token).delete(`/auth/sessions/${sessionsB.body.data[0].id}`);
    expect(r.status).toBe(404);
    expect((await api(ctx, B.host, studentB.token).get('/me')).status).toBe(200);
  });
  it('audit logs are separate per college', async () => {
    await api(ctx, B.host, adminB.token)
      .patch(`/admin/users/${studentB.id}/capabilities`)
      .send({ capabilities: ['CERTIFIED_CONTRIBUTOR'] });
    const logA = await api(ctx, A.host, adminA.token).get('/admin/audit?limit=100');
    expect(logA.body.data.some((e: { targetId: string }) => e.targetId === studentB.id)).toBe(false);
    const inA = await runInTenant(A._id, () => AuditModel.countDocuments({ targetId: studentB.id }));
    expect(inA).toBe(0);
  });
  it('branding changes in A do not affect B', async () => {
    const r = await api(ctx, A.host, adminA.token).put('/tenant/branding').send({
      displayName: 'Alpha Institute',
      shortName: 'ALPHA',
      primary: '#22b07d',
      secondary: '#0e7c86',
      accent: '#ff7a59',
      monogram: 'AI',
    });
    expect(r.status).toBe(200);
    const b = await api(ctx, B.host).get('/tenant');
    expect(b.body.data.branding.primary).toBe('#3fb8e6');
    expect((await api(ctx, A.host).get('/tenant')).body.data.branding.primary).toBe('#22b07d');
  });
});
