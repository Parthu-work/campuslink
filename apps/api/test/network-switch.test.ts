import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { gstinCheckDigit } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { loadEnv } from '../src/config/env.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { NetworkService } from '../src/modules/network/network.service.js';
import { NETWORK_PERMISSIONS, setNetworkEnabled } from '../src/lib/network-switch.js';
import { collegeTasks } from '../src/lib/scheduler.js';
import { InlineJobQueue } from '../src/lib/jobs.js';

/**
 * Prompt 4, P0: NETWORK_ENABLED=false (ADR 0014 not approved for production). The employer host
 * and every employer route answer 404, the network modules answer 404, nobody holds a network
 * permission (so navigation hides the network), and the reconcile timer queues nothing.
 */
const ctx = testApp({}, { NETWORK_ENABLED: 'false' });
let A: TestTenant, P: TestTenant, E: TestTenant;
let student: TestUser, tpo: TestUser, superAdmin: TestUser, recruiter: TestUser;
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const registry = () =>
  ctx.app.locals.registry as { module: string; spec: { method: string; path: string; scope?: string } }[];

beforeAll(async () => {
  A = await makeTenant('nsw-a');
  P = await makeTenant('nsw-admin', 'platform');
  const stem = '36AABCD1234E1Z';
  const e = await TenantModel.create({
    slug: 'emp-nsw',
    kind: 'employer',
    branding: {
      displayName: 'Switch Employer (test)',
      shortName: 'Switch',
      primary: '#3b5bdb',
      secondary: '#1e293b',
      accent: '#0ea5e9',
      monogram: 'SE',
    },
    employer: {
      legalName: 'Switch Employer Private Limited (fictional)',
      domain: 'switch-employer.example',
      gstin: stem + gstinCheckDigit(stem),
      status: 'approved',
      dnsToken: 'token',
    },
  });
  E = { _id: e._id, slug: 'emp-nsw', host: 'emp-nsw.localhost' };
  await TenantModel.updateOne({ _id: A._id }, { $set: { 'network.alumniDiscovery': true } });
  student = await makeUser(ctx, A, { roles: ['STUDENT'] });
  tpo = await makeUser(ctx, A, { roles: ['TPO'], mfa: true });
  superAdmin = await makeUser(ctx, P, { roles: ['SUPER_ADMIN'], mfa: true });
  recruiter = await makeUser(ctx, E, { roles: ['RECRUITER'], mfa: true });
});
// Other files in this worker build their own app; leave the switch as they expect it.
afterAll(() => setNetworkEnabled(true));

describe('NETWORK_ENABLED (prompt 4, P0)', () => {
  it('is off by default in production and on elsewhere; production turns it on explicitly', () => {
    const prod = {
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      JWT_TICKET_SECRET: 'b'.repeat(40),
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      MALWARE_SCANNER: 'clamav',
      APP_ROOT_DOMAIN: 'campus.example',
      MONGODB_URI: 'mongodb://app:pw@mongo:27017/campuslink',
    };
    expect(loadEnv(prod).NETWORK_ENABLED).toBe(false);
    expect(loadEnv({ ...prod, NETWORK_ENABLED: 'true' }).NETWORK_ENABLED).toBe(true);
    expect(loadEnv({ NODE_ENV: 'development' }).NETWORK_ENABLED).toBe(true);
    expect(loadEnv({ NODE_ENV: 'test', NETWORK_ENABLED: 'false' }).NETWORK_ENABLED).toBe(false);
  });

  it('the employer host does not exist: every request on it is a 404', async () => {
    // (Liveness, /health, answers on any host for the load balancer and names no tenant.)
    for (const path of ['/tenant', '/me', '/employer/me', '/auth/sessions']) {
      const res = await api(ctx, E.host, recruiter.token).get(path);
      expect(res.status, path).toBe(404);
      expect(res.body.ok).toBe(false);
    }
  });

  it('every employer-scope route and every network module route answers 404, even to a super admin', async () => {
    const gated = registry().filter(
      (r) =>
        r.spec.scope === 'employer' ||
        ['network', 'employers', 'credentials', 'credentials-public'].includes(r.module),
    );
    expect(gated.length).toBeGreaterThan(20);
    const id = '6'.repeat(24);
    for (const { module, spec } of gated) {
      const path = spec.path.replace(/:[A-Za-z]+(\([^)]*\))?/g, id);
      const who = spec.scope === 'platform' ? superAdmin : spec.scope === 'employer' ? recruiter : tpo;
      const method = spec.method as 'get' | 'post' | 'patch' | 'put' | 'delete';
      // The public credential pages are mounted at the root (/{college}/verify/{id}), not under /api/v1.
      const res =
        module === 'credentials-public'
          ? await request(ctx.app).get(path).set('Host', A.host)
          : await as(who)[method](path);
      expect(res.status, `${spec.method} ${spec.path}`).toBe(404);
    }
  });

  it('nobody holds a network permission, so navigation hides the network', async () => {
    for (const u of [student, tpo, superAdmin]) {
      const me = await as(u).get('/me');
      expect(me.status).toBe(200);
      const held = (me.body.data.permissions as string[]).filter((p) =>
        (NETWORK_PERMISSIONS as readonly string[]).includes(p),
      );
      expect(held).toEqual([]);
      // Everything else is untouched.
      expect((me.body.data.permissions as string[]).length).toBeGreaterThan(3);
    }
  });

  it('the reconcile timer queues nothing while the switch is off, and only opted-in colleges when on', async () => {
    const seen: string[] = [];
    const queue = new InlineJobQueue();
    queue.enqueue = async (name: string) => {
      seen.push(name);
    };
    expect(await collegeTasks.network(queue)).toBe(0);
    setNetworkEnabled(true);
    await makeTenant('nsw-idle');
    const n = await collegeTasks.network(queue);
    setNetworkEnabled(false);
    // A (a switch on) is queued; the idle college (no switch) is not.
    expect(n).toBe(1);
    expect(seen).toHaveLength(1);
    // The old entry point still exists for the job's own tests.
    expect(typeof NetworkService.enqueueReconcile).toBe('function');
  });
});
