import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  BatchmatesView,
  CaptainClassView,
  MyPublicPagesView,
  ParentDigestView,
  PublicPageView,
  ReferralImpactView,
} from '@campuslink/shared';
import {
  api,
  makeTenant,
  makeUser,
  phoneCodeFrom,
  testApp,
  type TestTenant,
  type TestUser,
} from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { OfferModel } from '../src/modules/placements/placements.model.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { InviteLinkModel } from '../src/modules/verification/onboarding.model.js';
import { ProductEventModel } from '../src/modules/insights/insights.model.js';
import { PublicPageModel } from '../src/modules/public-pages/public-page.model.js';
import { ParentDigestModel } from '../src/modules/notifications/parent-digest.service.js';
import { shareSvg } from '../src/modules/public-pages/render.js';

/** Prompt 2, G8: public pages (E4), the outcomes page, member and captain invites, referral outcomes, the parent digest. */

const ctx = testApp();
let T: TestTenant, U: TestTenant;
let placed: TestUser,
  minor: TestUser,
  alum: TestUser,
  captain: TestUser,
  other: TestUser,
  tpo: TestUser,
  admin: TestUser,
  foreign: TestUser;
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const page = (host: string, path: string) => request(ctx.app).get(path).set('Host', host);
const inT = <R>(fn: () => Promise<R>) => runInTenant(T._id, fn);
let phoneSeq = 0;
const newPhone = () => `+9198${String(70_000_000 + ++phoneSeq).padStart(8, '0')}`;

beforeAll(async () => {
  T = await makeTenant('growth');
  U = await makeTenant('growthb');
  placed = await makeUser(ctx, T, { roles: ['STUDENT'] });
  minor = await makeUser(ctx, T, { roles: ['STUDENT'] });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  captain = await makeUser(ctx, T, { roles: ['STUDENT'] });
  other = await makeUser(ctx, T, { roles: ['STUDENT'] });
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  foreign = await makeUser(ctx, U, { roles: ['STUDENT'] });
  await inT(() =>
    ProfileModel.updateOne(
      { userId: placed.id },
      { $set: { name: 'Divya Lakshmi Rao', branch: 'CSE', gradYear: 2026 } },
    ),
  );
  await inT(() => ProfileModel.updateOne({ userId: alum.id }, { $set: { branch: 'ECE', gradYear: 2019 } }));
  await inT(() => ProfileModel.updateOne({ userId: captain.id }, { $set: { branch: 'IT', gradYear: 2028 } }));
  await inT(() =>
    OfferModel.create({
      userId: placed.id,
      companyKey: 'nimbus labs',
      companyName: 'Nimbus Labs',
      role: 'Software Engineer',
      type: 'full_time',
      status: 'verified',
      source: 'drive',
      branch: 'CSE',
      gradYear: 2026,
      ctcBand: '5_8',
      ctcLpa: 7.25,
      offerDate: new Date(),
    }),
  );
  await as(placed).post('/me/consents').send({ purpose: 'analytics_aggregate', granted: true }).expect(200);
});

describe('public pages (prompt 2, G8, E4)', () => {
  let live: PublicPageView;

  it('a member publishes a verified placement: company and role, never the CTC or contact details', async () => {
    const mine = (await as(placed).get('/me/public-pages')).body.data as MyPublicPagesView;
    expect(mine.allowed).toBe(true);
    const option = mine.options.find((o) => o.kind === 'placed');
    expect(option?.headline).toBe('Placed at Nimbus Labs');
    const r = await as(placed)
      .post('/me/public-pages')
      .send({ kind: 'placed', refId: option?.refId, nameStyle: 'first' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    live = r.body.data as PublicPageView;
    expect(live.url).toContain(`/p/${live.slug}`);
    expect(live.content).toMatchObject({
      name: 'Divya',
      headline: 'Placed at Nimbus Labs',
      detail: 'Software Engineer',
    });
    expect(
      await inT(() => ProductEventModel.countDocuments({ name: 'public_page_published', userId: placed.id })),
    ).toBe(1);

    const html = await page(T.host, `/p/${live.slug}`);
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    // Never cached: taking it down works at once, even in a browser that opened it (E4).
    expect(html.headers['cache-control']).toBe('no-store');
    expect(html.text).toContain('Placed at Nimbus Labs');
    expect(html.text).toContain('og:image');
    expect(html.text).toContain('noindex'); // not indexable unless they chose it
    // The exact CTC as a figure on its own (a time such as 07.250Z must not count).
    expect(html.text).not.toMatch(/(?<![\d.])7\.25(?![\d])/);
    expect(html.text).not.toContain('Lakshmi'); // first name only, as chosen
    expect(html.text).not.toContain(placed.email);
    const img = await page(T.host, `/p/${live.slug}/og.png`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    // The same achievement twice is the same page.
    const again = await as(placed).post('/me/public-pages').send({ kind: 'placed', refId: option?.refId });
    expect((again.body.data as PublicPageView).id).toBe(live.id);
  });

  it('the share image carries only the opt-in fields', () => {
    const svg = shareSvg({
      college: 'GROWTH College',
      headline: 'Placed at Nimbus Labs',
      detail: 'Software Engineer',
      name: 'Divya',
    });
    expect(svg).toContain('Placed at Nimbus Labs');
    expect(svg).toContain('Divya');
    for (const leak of ['7.25', 'LPA', '@', '+91']) expect(svg).not.toContain(leak);
  });

  it('pages nobody published, taken down, of another college or after erasure are 404', async () => {
    expect((await page(T.host, '/p/nobody-placed-abc123')).status).toBe(404);
    expect((await page(U.host, `/p/${live.slug}`)).status).toBe(404);
    // Views are counted per page, never per viewer.
    expect((await inT(() => PublicPageModel.findById(live.id).lean()))?.views).toBeGreaterThan(0);
    await as(placed).delete(`/me/public-pages/${live.id}`).expect(200);
    expect((await page(T.host, `/p/${live.slug}`)).status).toBe(404);
    expect((await page(T.host, `/p/${live.slug}/og.png`)).status).toBe(404);
    // A revoked offer takes its page down too.
    const fresh = (
      await as(placed)
        .post('/me/public-pages')
        .send({
          kind: 'placed',
          refId: (await inT(() => OfferModel.findOne({ userId: placed.id }).lean()))?._id.toString(),
        })
    ).body.data as PublicPageView;
    expect((await page(T.host, `/p/${fresh.slug}`)).status).toBe(200);
    await inT(() => OfferModel.updateOne({ userId: placed.id }, { $set: { status: 'rejected' } }));
    expect((await page(T.host, `/p/${fresh.slug}`)).status).toBe(404);
    const svc = ctx.app.locals.services as { publicPages: { eraseFor: (id: string) => Promise<void> } };
    await inT(() => svc.publicPages.eraseFor(placed.id));
    expect(await inT(() => PublicPageModel.countDocuments({ userId: placed.id }))).toBe(0);
  });

  it('minors cannot publish', async () => {
    const adultOn = new Date(Date.now() + 365 * 86_400_000);
    await inT(() => UserModel.updateOne({ _id: minor.id }, { $set: { adultOn } }));
    await inT(() => ProfileModel.updateOne({ userId: minor.id }, { $set: { minorUntil: adultOn } }));
    const mine = (await as(minor).get('/me/public-pages')).body.data as MyPublicPagesView;
    expect(mine).toMatchObject({ allowed: false, options: [] });
    expect((await as(minor).post('/me/public-pages').send({ kind: 'mentored' })).status).toBe(403);
  });
});

describe('the college outcomes page (prompt 2, G8)', () => {
  it('is a 404 until the college publishes it; then aggregates only', async () => {
    expect((await page(T.host, '/p/outcomes')).status).toBe(404);
    expect((await as(tpo).put('/admin/growth/outcomes-page').send({ enabled: true })).status).toBe(403);
    const r = await as(admin).put('/admin/growth/outcomes-page').send({ enabled: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.outcomesPage.url).toContain('/p/outcomes');
    const html = await page(T.host, '/p/outcomes');
    expect(html.status).toBe(200);
    expect(html.text).toContain('Placement outcomes');
    expect(html.text).toContain('&lt;5'); // one verified offer: shown as "<5"
    expect(html.text).not.toContain('Divya');
    expect((await page(T.host, '/p/outcomes/og.png')).headers['content-type']).toBe('image/png');
    expect((await page(U.host, '/p/outcomes')).status).toBe(404);
  });
});

describe('member and Campus Captain invites (prompt 2, G8)', () => {
  const roster = async (o: { branch: string; gradYear: number; kind: 'student' | 'alumni'; n: number }) => {
    const c = (
      ctx.app.locals.services as {
        cipher: { encrypt: (s: string) => string; blindIndex: (s: string) => string };
      }
    ).cipher;
    for (let i = 0; i < o.n; i++) {
      const phone = newPhone();
      await inT(() =>
        WhitelistModel.create({
          rollNumber: `G8${o.branch}${o.gradYear}${String(i).padStart(3, '0')}`,
          name: `Batchmate ${i}`,
          kind: o.kind,
          branch: o.branch,
          gradYear: o.gradYear,
          source: 'import',
          phoneEnc: c.encrypt(phone),
          phoneIndex: c.blindIndex(phone),
        }),
      );
    }
  };
  beforeAll(async () => {
    await roster({ branch: 'ECE', gradYear: 2019, kind: 'alumni', n: 4 });
    await roster({ branch: 'IT', gradYear: 2028, kind: 'student', n: 3 });
  });

  it('members see "N of your batch aren\x27t here yet", but cannot send until the college turns invites on', async () => {
    const v = (await as(alum).get('/me/batchmates')).body.data as BatchmatesView;
    expect(v).toMatchObject({ branch: 'ECE', gradYear: 2019, notHere: 4, invitable: 4, enabled: false });
    expect((await as(alum).post('/me/batchmates/invite').send({ count: 2 })).status).toBe(503);
    expect((await as(tpo).put('/admin/growth/member-invites').send({ enabled: true })).status).toBe(400);
    await as(tpo).put('/admin/growth/member-invites').send({ enabled: true, attestOptIn: true }).expect(200);
  });

  it('an alumnus invites their batch on WhatsApp, within a weekly limit; never another batch', async () => {
    const r = await as(alum).post('/me/batchmates/invite').send({ count: 3 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ sent: 3 });
    const links = await inT(() => InviteLinkModel.find({ createdBy: alum.id }).lean());
    expect(links).toHaveLength(3);
    const recs = await inT(() =>
      WhitelistModel.find({ _id: { $in: links.map((l) => l.whitelistId) } }).lean(),
    );
    expect(recs.every((x) => x.branch === 'ECE' && x.gradYear === 2019)).toBe(true);
    const v = (await as(alum).get('/me/batchmates')).body.data as BatchmatesView;
    expect(v).toMatchObject({ invitable: 1, left: 17 });
    // Students do not invite (captains do, for their class).
    expect((await as(other).get('/me/batchmates')).status).toBe(403);
  });

  it('a Campus Captain sees their own class only, in counts, and invites it', async () => {
    expect((await as(captain).get('/captain/class')).status).toBe(403);
    await inT(() =>
      UserModel.updateOne({ _id: captain.id }, { $addToSet: { capabilities: 'CAMPUS_CAPTAIN' } }),
    );
    const v = (await as(captain).get('/captain/class')).body.data as CaptainClassView;
    expect(v).toMatchObject({
      branch: 'IT',
      gradYear: 2028,
      onList: 3,
      joined: 0,
      invitable: 3,
      broughtIn: 0,
      enabled: true,
    });
    expect(JSON.stringify(v)).not.toContain('Batchmate'); // no names
    const r = await as(captain).post('/captain/invites').send({ count: 5 });
    expect(r.body.data).toMatchObject({ sent: 3 });
    const links = await inT(() => InviteLinkModel.find({ createdBy: captain.id }).lean());
    const recs = await inT(() =>
      WhitelistModel.find({ _id: { $in: links.map((l) => l.whitelistId) } }).lean(),
    );
    expect(recs.every((x) => x.branch === 'IT' && x.gradYear === 2028)).toBe(true);
  });
});

describe('referral outcomes (prompt 2, G8)', () => {
  it('the student reports what happened; the referrer sees what their referrals led to', async () => {
    const svc = ctx.app.locals.services as Record<string, unknown>;
    expect(svc).toBeTruthy();
    const { ReferralRequestModel } = await import('../src/modules/referrals/referral.model.js');
    const ref = await inT(() =>
      ReferralRequestModel.create({
        requesterId: other.id,
        referrerId: alum.id,
        jobId: alum.id,
        jobTitle: 'Data Analyst',
        company: 'Nimbus Labs',
        why: 'I have built three dashboards in my internship and want to apply.',
        status: 'referred',
        respondedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
    expect(
      (
        await as(placed)
          .post(`/referrals/${String(ref._id)}/outcome`)
          .send({ outcome: 'offer' })
      ).status,
    ).toBe(404);
    const r = await as(other)
      .post(`/referrals/${String(ref._id)}/outcome`)
      .send({ outcome: 'offer' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.outcome).toBe('offer');
    const impact = (await as(alum).get('/me/referral-impact')).body.data as ReferralImpactView;
    expect(impact).toEqual({ referred: 1, interviews: 1, offers: 1 });
  });
});

describe('the parent digest (prompt 2, G8)', () => {
  it('is confirmed by the code the parent receives, sends monthly, and stops on request', async () => {
    const parent = newPhone();
    const start = await as(other).post('/me/parent-digest').send({ phone: parent, language: 'te' });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    expect((start.body.data as ParentDigestView).status).toBe('pending');
    expect((await as(other).post('/me/parent-digest/confirm').send({ code: '000000' })).status).toBe(400);
    const { code } = phoneCodeFrom(ctx, parent);
    const ok = await as(other).post('/me/parent-digest/confirm').send({ code });
    expect(ok.body.data).toMatchObject({ status: 'active', phoneLast4: parent.slice(-4), language: 'te' });
    // The month's run sends it once; a second run the same month does not.
    const month = new Date().toISOString().slice(0, 7);
    const svc = ctx.app.locals.services as {
      parentDigest: { run: (j: { tenantId: string; month: string }) => Promise<{ sent: number }> };
    };
    expect((await inT(() => svc.parentDigest.run({ tenantId: String(T._id), month }))).sent).toBe(1);
    expect((await inT(() => svc.parentDigest.run({ tenantId: String(T._id), month }))).sent).toBe(0);
    const msg = ctx.whatsapp.outbox.lastTo(parent);
    expect(msg?.template).toBe('cl_parent_digest');
    // Staff and alumni have no parent digest.
    expect((await as(alum).get('/me/parent-digest')).status).toBe(403);
    await as(other).delete('/me/parent-digest').expect(200);
    expect(await inT(() => ParentDigestModel.countDocuments({ userId: other.id }))).toBe(0);
  });

  it('another college never sees it', async () => {
    expect(((await as(foreign).get('/me/parent-digest')).body.data as ParentDigestView).status).toBe('none');
  });
});
