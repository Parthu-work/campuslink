import { beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import {
  FEATURE_KEYS,
  LEGACY_FEATURES,
  NEW_TENANT_FEATURES,
  type Feature,
  type PublicTenant,
} from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { fakeMp4 } from './feed-fixtures.js';
import { runInTenant, withPlatformScope } from '../src/lib/context.js';
import { createLogger } from '../src/lib/logger.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { invalidateTenant } from '../src/modules/tenants/tenant.cache.js';
import { gatedJob } from '../src/modules/tenants/features.js';
import { JobModel } from '../src/modules/jobs/job.model.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { MigrationModel } from '../src/modules/platform/migration.model.js';
import { MIGRATIONS, runMigrations } from '../src/db/migrations.js';
import type { RouteRegistry } from '../src/http/registry.js';

const ctx = testApp();
let T: TestTenant;
let admin: TestUser, student: TestUser, alum: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);

async function setFeatures(features: Partial<Record<Feature, boolean>>) {
  await TenantModel.updateOne(
    { _id: T._id },
    { $set: Object.fromEntries(Object.entries(features).map(([k, v]) => [`features.${k}`, v])) },
  );
  invalidateTenant(T.slug);
}

beforeAll(async () => {
  T = await makeTenant('switches');
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
});

describe('feature switches (B1)', () => {
  it('a new college starts focused; the admin sees and changes every switch', async () => {
    const P = await makeTenant('switchplat', 'platform');
    const sa = await makeUser(ctx, P, { roles: ['SUPER_ADMIN'], mfa: true });
    const created = await api(ctx, P.host, sa.token)
      .post('/platform/tenants')
      .send({
        slug: 'focused',
        branding: {
          displayName: 'Focused College of Engineering',
          shortName: 'FCE',
          primary: '#3fb8e6',
          secondary: '#6d5ae6',
          accent: '#f2b705',
          monogram: 'FC',
        },
        subscription: { plan: 'pilot', seats: 800, renewalDate: null },
        firstAdmin: { name: 'Focused Admin', email: 'admin@focused.example' },
      });
    expect(created.status).toBe(201);
    const pub = (await api(ctx, 'focused.localhost').get('/tenant')).body.data as PublicTenant;
    expect(pub.features).toEqual(NEW_TENANT_FEATURES);

    const settings = await as(admin).get('/tenant/settings');
    expect(Object.keys(settings.body.data.features).sort()).toEqual([...FEATURE_KEYS].sort());
    const off = await as(admin)
      .patch('/tenant/settings')
      .send({ features: { reels: false, study: false } });
    expect(off.body.data.features).toMatchObject({ reels: false, study: false, stories: true });
    await setFeatures({ reels: true, study: true });
    expect(
      (
        await as(student)
          .patch('/tenant/settings')
          .send({ features: { study: false } })
      ).status,
    ).toBe(403);
  });

  it('every route that belongs to a switch answers 403 FEATURE_DISABLED while it is off', async () => {
    const registry = ctx.app.locals.registry as RouteRegistry;
    const gated = registry.filter((r) => r.spec.feature);
    // Each module-level switch covers real routes.
    const covered = new Set(gated.map((r) => r.spec.feature));
    for (const f of [
      'stories',
      'reels',
      'leaderboards',
      'alumniMatch',
      'jobsAggregation',
      'contentSources',
      'study',
    ])
      expect(covered.has(f as Feature), f).toBe(true);
    const id = String(new Types.ObjectId());
    for (const f of covered) {
      await setFeatures({ [f as Feature]: false });
      for (const { spec } of gated.filter((r) => r.spec.feature === f)) {
        const path = spec.path.replace(/:[A-Za-z]+/g, id);
        const r = await as(admin)[spec.method](path).send({});
        expect(r.status, `${spec.method} ${spec.path}`).toBe(403);
        expect(r.body.error.code, `${spec.method} ${spec.path}`).toBe('FEATURE_DISABLED');
      }
      await setFeatures({ [f as Feature]: true });
      // Back on: the same routes get past the switch (whatever they answer next).
      for (const { spec } of gated.filter((r) => r.spec.feature === f).slice(0, 3)) {
        const r = await as(admin)
          [spec.method](spec.path.replace(/:[A-Za-z]+/g, id))
          .send({});
        expect(r.body?.error?.code, `${spec.method} ${spec.path}`).not.toBe('FEATURE_DISABLED');
      }
    }
  });

  it('reels leave the feed, lists and post pages, and cannot be published, while off', async () => {
    const up = await as(alum).post('/media/videos').attach('file', fakeMp4(20), 'tip.mp4');
    expect(up.status).toBe(201);
    const reel = await as(alum)
      .post('/posts')
      .send({
        kind: 'reel',
        body: 'Demo reel',
        media: [{ fileId: up.body.data.id, alt: 'A demo reel' }],
        topics: ['placements'],
      });
    expect(reel.status).toBe(201);
    const reelId = reel.body.data.id as string;
    const text = await as(alum).post('/posts').send({ kind: 'text', body: 'A plain demo post', topics: [] });
    expect(text.status).toBe(201);

    await setFeatures({ reels: false });
    const ids = (r: { body: { data: { type?: string; post?: { id: string }; id?: string }[] } }) =>
      r.body.data.map((e) => e.post?.id ?? e.id);
    expect(ids(await as(student).get('/feed?tab=for_you'))).not.toContain(reelId);
    expect(ids(await as(student).get('/feed?tab=for_you'))).toContain(text.body.data.id);
    expect(ids(await as(student).get(`/posts?author=${alum.id}`))).not.toContain(reelId);
    const list = await as(student).get('/posts?kind=reel');
    expect([list.status, list.body.error.code]).toEqual([403, 'FEATURE_DISABLED']);
    const page = await as(student).get(`/posts/${reelId}`);
    expect([page.status, page.body.error.code]).toEqual([403, 'FEATURE_DISABLED']);
    const again = await as(alum)
      .post('/posts')
      .send({ kind: 'reel', body: 'x', media: [{ fileId: up.body.data.id, alt: 'x' }], topics: [] });
    expect(again.body.error.code).toBe('FEATURE_DISABLED');

    await setFeatures({ reels: true });
    expect(ids(await as(student).get('/feed?tab=for_you'))).toContain(reelId);
  });

  it('outside content: sources cannot be followed and their items leave the feed while off', async () => {
    await setFeatures({ contentSources: false });
    const follow = await as(student)
      .post('/follows')
      .send({ targetType: 'source', targetId: String(new Types.ObjectId()) });
    expect(follow.body.error.code).toBe('FEATURE_DISABLED');
    const feed = await as(student).get('/feed?tab=for_you');
    expect(feed.status).toBe(200);
    expect(feed.body.data.every((e: { type: string }) => e.type !== 'item')).toBe(true);
    await setFeatures({ contentSources: true });
  });

  it('fetched openings drop out of Jobs while automated job sources are off', async () => {
    const make = (origin: string, title: string) =>
      runInTenant(T._id, () =>
        JobModel.create({
          origin,
          title,
          company: 'Demo Fetched Co',
          companyKey: 'demo fetched co',
          applyUrl: 'https://jobs.example.org/1',
          postedAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          purgeAt: new Date(Date.now() + 90 * 86_400_000),
          dedupeKey: `demo-${title}`,
          ...(origin === 'posted' ? { postedBy: alum.id } : { externalId: title }),
        }),
      );
    const fetched = await make('greenhouse', 'Fetched Demo Role');
    await make('posted', 'Posted Demo Role');
    const titles = async () =>
      ((await as(student).get('/jobs?limit=30')).body.data as { title: string }[]).map((j) => j.title);
    expect(await titles()).toEqual(expect.arrayContaining(['Fetched Demo Role', 'Posted Demo Role']));
    await setFeatures({ jobsAggregation: false });
    expect(await titles()).toContain('Posted Demo Role');
    expect(await titles()).not.toContain('Fetched Demo Role');
    const one = await as(student).get(`/jobs/${String(fetched._id)}`);
    expect(one.body.error.code).toBe('FEATURE_DISABLED');
    await setFeatures({ jobsAggregation: true });
  });

  it("a switched-off feature's background jobs do nothing", async () => {
    const handler = vi.fn(async () => undefined);
    const job = gatedJob('study', handler);
    await setFeatures({ study: false });
    await runInTenant(T._id, () => job({ tenantId: String(T._id) }, async () => undefined));
    expect(handler).not.toHaveBeenCalled();
    await setFeatures({ study: true });
    await runInTenant(T._id, () => job({ tenantId: String(T._id) }, async () => undefined));
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('migration: explicit feature switches', () => {
  it('writes what older colleges had, keeps stored values, runs once', async () => {
    const legacyId = new Types.ObjectId();
    // A college stored before B1: only the five original switches, stories on.
    await mongoose.connection.collection('tenants').insertOne({
      _id: legacyId,
      slug: 'legacycollege',
      kind: 'college',
      status: 'active',
      branding: {
        displayName: 'Legacy College',
        shortName: 'LC',
        primary: '#3fb8e6',
        secondary: '#6d5ae6',
        accent: '#f2b705',
        monogram: 'LC',
      },
      features: {
        studentPosting: true,
        stories: true,
        leaderboards: false,
        alumniMatch: false,
        jobsAggregation: true,
      },
    });
    await withPlatformScope('platform:test-reset', () =>
      MigrationModel.deleteMany({ name: { $in: MIGRATIONS.map((m) => m.name) } }),
    );
    await runMigrations(createLogger('silent'));
    const doc = await TenantModel.findById(legacyId).lean();
    expect(doc?.features).toEqual({
      ...LEGACY_FEATURES,
      studentPosting: true,
      alumniMatch: false,
    });
    const ran = await withPlatformScope('platform:test-read', () =>
      MigrationModel.findOne({ name: 'b1-explicit-feature-switches' }).lean(),
    );
    expect(ran?.finishedAt).toBeInstanceOf(Date);
    // A second boot does nothing.
    const spy = vi.spyOn(MIGRATIONS[0]!, 'run');
    await runMigrations(createLogger('silent'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('a failed migration leaves no record, so the next boot retries it', async () => {
    const failing = {
      name: 'test-failing-migration',
      run: vi.fn(async () => Promise.reject(new Error('boom'))),
    };
    await expect(runMigrations(createLogger('silent'), [failing])).rejects.toThrow('boom');
    const row = await withPlatformScope('platform:test-read', () =>
      MigrationModel.findOne({ name: failing.name }).lean(),
    );
    expect(row).toBeNull();
  });
});

describe('admin overview', () => {
  it('leaves out the Study queues while Study is off', async () => {
    await setFeatures({ study: false });
    const v = (await as(admin).get('/admin/overview')).body.data;
    expect(v).toMatchObject({ ai: null, materialReviews: null });
    await setFeatures({ study: true });
    expect((await as(admin).get('/admin/overview')).body.data.ai).not.toBeNull();
  });
});

describe('migration: age checked at', () => {
  it('renames the old declaration date; the old document loads and saves', async () => {
    const T2 = await makeTenant('agemigration');
    const id = new Types.ObjectId();
    const declared = new Date('2026-01-02T03:04:05Z');
    await mongoose.connection.collection('users').insertOne({
      _id: id,
      tenantId: T2._id,
      email: 'old@agemigration.example',
      name: 'Old Member',
      passwordHash: 'x',
      roles: ['STUDENT'],
      status: 'active',
      ageDeclaredAt: declared,
    });
    await withPlatformScope('platform:test-reset', () =>
      MigrationModel.deleteMany({ name: 'b2-age-checked-at' }),
    );
    await runMigrations(createLogger('silent'));
    const raw = await mongoose.connection.collection('users').findOne({ _id: id });
    expect(raw?.ageCheckedAt).toEqual(declared);
    expect(raw).not.toHaveProperty('ageDeclaredAt');
    await runInTenant(T2._id, async () => {
      const doc = await UserModel.findById(id);
      expect(doc?.adultOn).toBeNull();
      doc!.name = 'Renamed';
      await doc!.save();
    });
  });
});
