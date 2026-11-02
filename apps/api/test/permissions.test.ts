/**
 * MANDATORY permission suite. Blocks CI.
 * The matrix is driven by the route registry, so every new endpoint is covered automatically.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { ROLE_PERMISSIONS, TENANT_ROLES, resolvePermissions, type Role } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import type { RouteRegistry } from '../src/http/registry.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { clearTenantCache } from '../src/modules/tenants/tenant.cache.js';
import { runInTenant } from '../src/lib/context.js';
import { RoadmapModel } from '../src/modules/roadmaps/roadmap.model.js';
import { LIBRARY } from '../src/modules/roadmaps/library/index.js';

const ctx = testApp();
let T: TestTenant;
const users = {} as Record<Role, TestUser>;
const registry = () => ctx.app.locals.registry as RouteRegistry;
const fakeId = new Types.ObjectId().toString();
const call = (method: string, path: string, token: string) => {
  const a = api(ctx, T.host, token);
  const p = path.replace(/:\w+/g, fakeId);
  return (a as unknown as Record<string, (p: string) => ReturnType<typeof a.get>>)[method]!(p).send({});
};

beforeAll(async () => {
  // Every module on, so each route is reached (feature switches have their own suite).
  T = await makeTenant('perm', 'college', { leaderboards: true });
  for (const role of TENANT_ROLES)
    users[role] = await makeUser(ctx, T, { roles: [role], mfa: role === 'COLLEGE_ADMIN' });
});

describe('vertical access: every permission-guarded college route × every role', () => {
  it('matches ROLE_PERMISSIONS exactly (deny by default)', async () => {
    const routes = registry().filter(
      (r) => r.spec.access.kind === 'permission' && (r.spec.scope ?? 'college') !== 'platform',
    );
    expect(routes.length).toBeGreaterThan(5);
    const mismatches: string[] = [];
    for (const { spec } of routes) {
      const perm = (spec.access as { permission: string }).permission;
      // Every role at once per route (the same calls; the suite grows with each new route).
      await Promise.all(
        TENANT_ROLES.map(async (role) => {
          const r = await call(spec.method, spec.path, users[role].token);
          const allowed = (ROLE_PERMISSIONS[role] as readonly string[]).includes(perm);
          const denied = r.status === 403;
          if (allowed === denied)
            mismatches.push(`${role} ${spec.method.toUpperCase()} ${spec.path} → ${r.status}`);
        }),
      );
    }
    expect(mismatches).toEqual([]);
    // Exhaustive by design: it grows with every permission route (about 1,400 calls today).
  }, 60_000);

  it('every non-public route rejects anonymous callers', async () => {
    for (const { spec } of registry().filter((r) => r.spec.access.kind !== 'public')) {
      const host = spec.scope === 'platform' ? 'admin.localhost' : T.host;
      const a = api(ctx, host);
      const r = await (a as unknown as Record<string, (p: string) => ReturnType<typeof a.get>>)[spec.method]!(
        spec.path.replace(/:\w+/g, fakeId),
      ).send({});
      expect([401, 404], `${spec.method} ${spec.path}`).toContain(r.status);
    }
  });
});

describe('vertical escalation guards', () => {
  it('a student cannot grant themselves roles', async () => {
    const r = await api(ctx, T.host, users.STUDENT.token)
      .patch(`/admin/users/${users.STUDENT.id}/roles`)
      .send({ roles: ['COLLEGE_ADMIN'] });
    expect(r.status).toBe(403);
  });
  it('SUPER_ADMIN cannot be assigned through the college API', async () => {
    const r = await api(ctx, T.host, users.COLLEGE_ADMIN.token)
      .patch(`/admin/users/${users.STUDENT.id}/roles`)
      .send({ roles: ['SUPER_ADMIN'] });
    expect(r.status).toBe(400);
  });
  it('TPO granted users:manage by override still cannot suspend a college admin', async () => {
    const tenant = await TenantModel.findById(T._id);
    tenant!.set('permissionOverrides', { grant: { TPO: ['users:manage', 'roles:assign'] }, revoke: {} });
    await tenant!.save();
    clearTenantCache();
    const r = await api(ctx, T.host, users.TPO.token)
      .patch(`/admin/users/${users.COLLEGE_ADMIN.id}/status`)
      .send({ status: 'suspended' });
    expect(r.status).toBe(403);
    const roles = await api(ctx, T.host, users.TPO.token)
      .patch(`/admin/users/${users.STUDENT.id}/roles`)
      .send({ roles: ['COLLEGE_ADMIN'] });
    expect(roles.status).toBe(403); // TPO has no assignable roles
    tenant!.set('permissionOverrides', { grant: {}, revoke: {} });
    await tenant!.save();
    clearTenantCache();
  });
  it('platform permissions can never be granted to a college role', async () => {
    const r = await api(ctx, T.host, users.COLLEGE_ADMIN.token)
      .patch('/tenant/settings')
      .send({ permissionOverrides: { grant: { FACULTY: ['platform:tenants'] } } });
    expect(r.status).toBe(400);
    expect(
      resolvePermissions(
        { roles: ['FACULTY'], verified: true, mfaEnabled: false },
        { grant: { FACULTY: ['platform:tenants'] } },
      ).has('platform:tenants'),
    ).toBe(false);
  });
  it('the last college admin cannot be demoted', async () => {
    const r = await api(ctx, T.host, users.COLLEGE_ADMIN.token)
      .patch(`/admin/users/${users.COLLEGE_ADMIN.id}/roles`)
      .send({ roles: ['FACULTY'] });
    expect(r.status).toBe(409);
  });
  it('contributor capability only goes to students, and grants roadmaps:write', async () => {
    const bad = await api(ctx, T.host, users.COLLEGE_ADMIN.token)
      .patch(`/admin/users/${users.ALUMNI.id}/capabilities`)
      .send({ capabilities: ['CERTIFIED_CONTRIBUTOR'] });
    expect(bad.status).toBe(400);
    const ok = await api(ctx, T.host, users.COLLEGE_ADMIN.token)
      .patch(`/admin/users/${users.STUDENT.id}/capabilities`)
      .send({ capabilities: ['CERTIFIED_CONTRIBUTOR'] });
    expect(ok.status).toBe(200);
    const me = await api(ctx, T.host, users.STUDENT.token).get('/me');
    expect(me.body.data.permissions).toContain('roadmaps:write');
  });
  it('role changes take effect on the next request (no stale permissions in tokens)', async () => {
    const u = await makeUser(ctx, T, { roles: ['STUDENT'] });
    expect((await api(ctx, T.host, u.token).post('/tenant/settings')).status).toBe(404); // unknown method/path
    await api(ctx, T.host, users.COLLEGE_ADMIN.token)
      .patch(`/admin/users/${u.id}/roles`)
      .send({ roles: ['FACULTY'] });
    const me = await api(ctx, T.host, u.token).get('/me');
    expect(me.body.data.roles).toEqual(['FACULTY']);
    expect(me.body.data.permissions).toContain('roadmaps:review');
  });
  it('suspending a user revokes their sessions; admins cannot suspend themselves', async () => {
    const u = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    await api(ctx, T.host, users.COLLEGE_ADMIN.token)
      .patch(`/admin/users/${u.id}/status`)
      .send({ status: 'suspended' });
    expect((await api(ctx, T.host, u.token).get('/me')).status).toBe(401);
    const self = await api(ctx, T.host, users.COLLEGE_ADMIN.token)
      .patch(`/admin/users/${users.COLLEGE_ADMIN.id}/status`)
      .send({ status: 'suspended' });
    expect(self.status).toBe(400);
  });
});

describe('super admin is platform-only', () => {
  let P: TestTenant;
  let sa: TestUser;
  beforeAll(async () => {
    P = await makeTenant('admin', 'platform');
    sa = await makeUser(ctx, P, { roles: ['SUPER_ADMIN'], mfa: true });
  });
  it('can list and create colleges on the platform host', async () => {
    const created = await api(ctx, P.host, sa.token)
      .post('/platform/tenants')
      .send({
        slug: 'newcollege',
        branding: {
          displayName: 'New College of Engineering',
          shortName: 'NCE',
          primary: '#3fb8e6',
          secondary: '#6d5ae6',
          accent: '#f2b705',
          monogram: 'NC',
        },
        subscription: { plan: 'pilot', seats: 800, renewalDate: null },
        firstAdmin: { name: 'Priya Admin', email: 'priya@newcollege.example' },
      });
    expect(created.status).toBe(201);
    expect(ctx.mailer.lastTo('priya@newcollege.example')?.text).toContain(
      'http://newcollege.localhost:5173/reset-password?token=',
    );
    const list = await api(ctx, P.host, sa.token).get('/platform/tenants');
    expect(list.body.data.find((t: { slug: string }) => t.slug === 'newcollege')).toMatchObject({
      users: 1,
      status: 'active',
    });
    // New colleges start with the researched roadmap library installed.
    const t = await TenantModel.findOne({ slug: 'newcollege' }).lean();
    expect(await runInTenant(t?._id as Types.ObjectId, () => RoadmapModel.countDocuments({}))).toBe(
      LIBRARY.length,
    );
  });
  it('a super-admin token is rejected on a college host', async () => {
    const r = await api(ctx, T.host, sa.token).get('/admin/users');
    expect(r.body.error.code).toBe('TENANT_MISMATCH');
  });
  it('college users cannot reach platform routes', async () => {
    const r = await api(ctx, T.host, users.COLLEGE_ADMIN.token).get('/platform/tenants');
    expect(r.status).toBe(404);
  });
  it('suspending a college blocks it and signs everyone out; resuming restores access', async () => {
    const list = await api(ctx, P.host, sa.token).get('/platform/tenants');
    const id = list.body.data.find((t: { slug: string }) => t.slug === T.slug).id;
    const victim = await makeUser(ctx, T, { roles: ['STUDENT'] });
    expect(
      (await api(ctx, P.host, sa.token).patch(`/platform/tenants/${id}`).send({ status: 'suspended' }))
        .status,
    ).toBe(200);
    const blocked = await api(ctx, T.host, victim.token).get('/me');
    expect(blocked.body.error.code).toBe('TENANT_SUSPENDED');
    await api(ctx, P.host, sa.token).patch(`/platform/tenants/${id}`).send({ status: 'active' });
    expect((await api(ctx, T.host, victim.token).get('/me')).status).toBe(401); // session was revoked
    // Everyone was signed out, including the college admin; a fresh admin session can see what the platform did.
    const freshAdmin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
    const log = await api(ctx, T.host, freshAdmin.token).get('/admin/audit?action=platform.tenant_suspended');
    expect(log.body.data).toHaveLength(1);
  });
  it('platform health returns aggregates only', async () => {
    const r = await api(ctx, P.host, sa.token).get('/platform/health');
    expect(Object.keys(r.body.data).sort()).toEqual([
      'activeSessions',
      'dependencies',
      'memoryMb',
      'suspended',
      'tenants',
      'uptimeSec',
      'users',
    ]);
  });
});
