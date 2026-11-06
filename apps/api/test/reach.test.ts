import request from 'supertest';
import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import type { CalendarFeedLink, RosterSyncView, SsoSettingsView } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { SessionModel } from '../src/modules/auth/session.model.js';
import { BookingModel } from '../src/modules/sessions/booking.model.js';
import { EventModel, EventRsvpModel } from '../src/modules/events/event.model.js';
import { PlacementCompanyModel, PlacementDriveModel } from '../src/modules/placements/placements.model.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { ImportJobModel } from '../src/modules/imports/import-job.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { CalendarFeedModel } from '../src/modules/calendar/calendar.service.js';
import type { RosterSyncService } from '../src/modules/imports/roster-sync.service.js';
import type { SsoService } from '../src/modules/auth/sso/sso.service.js';
import type { SafeResponse } from '../src/lib/safe-fetch.js';

/** Prompt 2, G9: the calendar feed, the scheduled roster sync and single sign-on. */

const remote: { body: string; status?: number | undefined } = { body: '' };
const ctx = testApp({
  fetcher: async (url) =>
    ({
      status: remote.status ?? 200,
      contentType: 'text/csv',
      body: Buffer.from(remote.body),
      finalUrl: url,
    }) satisfies SafeResponse,
});
const services = () => ctx.app.locals.services as { rosterSync: RosterSyncService; sso: SsoService };
let T: TestTenant, U: TestTenant;
let student: TestUser, mentor: TestUser, admin: TestUser, staff: TestUser, foreign: TestUser;
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const inT = <R>(fn: () => Promise<R>) => runInTenant(T._id, fn);
const DAY = 86_400_000;

beforeAll(async () => {
  T = await makeTenant('reach');
  U = await makeTenant('reachb');
  // Before any request reads (and caches) the college.
  await TenantModel.updateOne({ _id: T._id }, { $set: { allowedEmailDomains: ['reach.edu'] } });
  student = await makeUser(ctx, T, { roles: ['STUDENT'], email: 'priya@reach.edu' });
  mentor = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true, email: 'admin@reach.edu' });
  staff = await makeUser(ctx, T, { roles: ['FACULTY'] });
  foreign = await makeUser(ctx, U, { roles: ['STUDENT'] });
});

// ── The calendar feed ─────────────────────────────

describe('the calendar feed (prompt 2, G9)', () => {
  let link: CalendarFeedLink;
  const tokenOf = (l: CalendarFeedLink) => /\/calendar\/([A-Za-z0-9_-]{43})\.ics$/.exec(l.url)?.[1] ?? '';
  const feed = (host: string, token: string) =>
    request(ctx.app).get(`/api/v1/calendar/${token}.ics`).set('Host', host);

  beforeAll(async () => {
    const soon = new Date(Date.now() + 2 * DAY);
    await inT(() =>
      BookingModel.create({
        requestId: new Types.ObjectId(),
        mentorId: mentor.id,
        menteeId: student.id,
        participants: [mentor.id, student.id],
        sessionType: 'mock_interview',
        start: soon,
        end: new Date(soon.getTime() + 30 * 60_000),
        holds: [`${student.id}|cal-test`],
        room: 'cal-room',
      }),
    );
    const ev = await inT(() =>
      EventModel.create({
        title: 'Resume clinic, room 204',
        description: 'Bring a printout',
        kind: 'workshop',
        mode: 'in_person',
        location: 'Block B',
        startsAt: new Date(Date.now() + 3 * DAY),
        endsAt: new Date(Date.now() + 3 * DAY + 3600_000),
        hostId: staff.id,
      }),
    );
    await inT(() =>
      EventRsvpModel.create({ eventId: ev._id, userId: student.id, status: 'going', queuedAt: new Date() }),
    );
    const skipped = await inT(() =>
      EventModel.create({
        title: 'An event I did not join',
        description: 'x',
        kind: 'talk',
        mode: 'online',
        startsAt: new Date(Date.now() + 4 * DAY),
        endsAt: new Date(Date.now() + 4 * DAY + 3600_000),
        hostId: staff.id,
      }),
    );
    expect(skipped).toBeTruthy();
    const company = await inT(() =>
      PlacementCompanyModel.create({ name: 'Kestrel Analytics', companyKey: 'kestrel analytics' }),
    );
    await inT(() =>
      PlacementDriveModel.create({
        companyId: company._id,
        title: 'Analyst campus drive',
        createdBy: staff.id,
        roles: [{ title: 'Data analyst', type: 'full_time' }],
        mode: 'on_campus',
        status: 'open',
        driveDate: new Date(Date.now() + 20 * DAY),
        registrationCloseAt: new Date(Date.now() + 5 * DAY),
      }),
    );
  });

  it('a member makes a secret address; only its hash is kept', async () => {
    expect((await as(student).get('/me/calendar-feed')).body.data).toMatchObject({ enabled: false });
    const r = await as(student).post('/me/calendar-feed');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    link = r.body.data as CalendarFeedLink;
    expect(link.url).toMatch(/^http:\/\/reach\.localhost.*\/api\/v1\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    expect(link.webcal).toMatch(/^webcal:\/\//);
    expect(link.google).toContain('calendar.google.com');
    const doc = await inT(() => CalendarFeedModel.findOne({ userId: student.id }).lean());
    expect(doc?.tokenHash).toBeTruthy();
    expect(doc?.tokenHash).not.toBe(tokenOf(link));
  });

  it('serves sessions, the events I am going to and drive deadlines, as ICS', async () => {
    const r = await feed(T.host, tokenOf(link));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/calendar');
    const ics = r.text;
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain('SUMMARY:Mentorship session with Test');
    expect(ics).toContain('SUMMARY:Resume clinic\\, room 204');
    expect(ics).not.toContain('An event I did not join');
    expect(ics).toContain('SUMMARY:Registration closes: Kestrel Analytics');
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect((await as(student).get('/me/calendar-feed')).body.data.lastFetchedAt).toBeTruthy();
  });

  it('speaks the member\x27s language', async () => {
    await inT(() => UserModel.updateOne({ _id: student.id }, { $set: { locale: 'te' } }));
    expect((await feed(T.host, tokenOf(link))).text).toContain('మెంటర్‌షిప్ సెషన్');
    await inT(() => UserModel.updateOne({ _id: student.id }, { $set: { locale: 'en' } }));
  });

  it('a new address replaces the old one; another college never serves it; off is off', async () => {
    expect((await feed(U.host, tokenOf(link))).status).toBe(404);
    const next = (await as(student).post('/me/calendar-feed')).body.data as CalendarFeedLink;
    expect((await feed(T.host, tokenOf(link))).status).toBe(404);
    expect((await feed(T.host, tokenOf(next))).status).toBe(200);
    await inT(() => UserModel.updateOne({ _id: student.id }, { $set: { status: 'suspended' } }));
    expect((await feed(T.host, tokenOf(next))).status).toBe(404);
    await inT(() => UserModel.updateOne({ _id: student.id }, { $set: { status: 'active' } }));
    await as(student).delete('/me/calendar-feed').expect(200);
    expect((await feed(T.host, tokenOf(next))).status).toBe(404);
    expect((await feed(T.host, 'not-a-token')).status).toBe(400);
  });
});

// ── The scheduled roster sync ─────────────────────────────

describe('the scheduled roster sync (prompt 2, G9)', () => {
  const SHEET = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit';
  const csv = (rows: [string, string][]) =>
    ['Roll No,Student Name,Batch', ...rows.map(([roll, name]) => `${roll},${name},2027`)].join('\n');
  const base: [string, string][] = Array.from({ length: 40 }, (_, i) => [
    `21RS1A${String(i).padStart(4, '0')}`,
    `Student ${String.fromCharCode(65 + (i % 26))}${i}`,
  ]);
  const MAPPING = {
    columns: { rollNumber: 'Roll No', name: 'Student Name', gradYear: 'Batch' },
    defaultKind: 'derive',
  };
  const run = (day: number) =>
    inT(() =>
      services().rosterSync.run({ tenantId: String(T._id) }, new Date(Date.UTC(2026, 10, 2 + day, 6))),
    );
  let jobId = '';

  beforeAll(async () => {
    remote.body = csv(base);
    const pre = await as(admin).post('/admin/imports/preview/remote').send({ kind: 'gsheet', url: SHEET });
    expect(pre.status, JSON.stringify(pre.body)).toBe(201);
    const start = await as(admin)
      .post('/admin/imports')
      .send({ previewId: pre.body.data.previewId, mapping: MAPPING, dryRun: false });
    expect(start.status, JSON.stringify(start.body)).toBe(202);
    jobId = start.body.data.id;
    await ctx.queue.drain();
    expect(await inT(() => WhitelistModel.countDocuments({}))).toBe(40);
  });

  it('is set up from a completed import of the source; members cannot see it', async () => {
    expect((await as(student).get('/admin/roster-sync')).status).toBe(403);
    const r = await as(admin)
      .put('/admin/roster-sync')
      .send({ source: { kind: 'gsheet', url: SHEET }, fromJobId: jobId, frequency: 'daily' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({
      configured: true,
      enabled: true,
      frequency: 'daily',
      source: { kind: 'gsheet' },
    });
    const other = await api(
      ctx,
      U.host,
      (await makeUser(ctx, U, { roles: ['COLLEGE_ADMIN'], mfa: true })).token,
    ).get('/admin/roster-sync');
    expect((other.body.data as RosterSyncView).configured).toBe(false);
  });

  it('applies a small change (5% or less) as an ordinary import', async () => {
    remote.body = csv(base.map(([r, n], i) => [r, i === 0 ? 'Renamed Student' : n]));
    expect(await run(0)).toBe('applied');
    await ctx.queue.drain();
    expect((await inT(() => WhitelistModel.findOne({ rollNumber: base[0]![0] }).lean()))?.name).toBe(
      'Renamed Student',
    );
    const v = (await as(admin).get('/admin/roster-sync')).body.data as RosterSyncView;
    expect(v).toMatchObject({ lastStatus: 'applied', pending: null });
    expect(await inT(() => ImportJobModel.countDocuments({ status: 'completed' }))).toBe(2);
    // The same day again does nothing.
    expect(await run(0)).toBe('skipped');
  });

  it('a larger change waits for an admin, who sees the diff, then applies exactly those rows', async () => {
    const more: [string, string][] = Array.from({ length: 5 }, (_, i) => [
      `21RS1B${String(i).padStart(4, '0')}`,
      `New Joiner ${i}`,
    ]);
    remote.body = csv([
      ...base.map(([r, n], i) => [r, i === 0 ? 'Renamed Student' : n] as [string, string]),
      ...more,
    ]);
    expect(await run(1)).toBe('waiting');
    expect(await inT(() => WhitelistModel.countDocuments({}))).toBe(40);
    const v = (await as(admin).get('/admin/roster-sync')).body.data as RosterSyncView;
    expect(v.lastStatus).toBe('waiting');
    expect(v.pending).toMatchObject({ total: 45, created: 5, updated: 0, changedShare: 0.111 });
    expect(v.pending?.sample[0]).toMatchObject({ change: 'new', fields: [] });
    expect(JSON.stringify(v.pending)).not.toContain('New Joiner');
    expect(
      await inT(() => NotificationModel.countDocuments({ userId: admin.id, type: 'roster_sync_review' })),
    ).toBe(1);
    // The source changes again before approval: the approved rows are the ones shown.
    remote.body = csv(base);
    const ok = await as(admin).post('/admin/roster-sync/approve');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await ctx.queue.drain();
    expect(await inT(() => WhitelistModel.countDocuments({}))).toBe(45);
    expect((await as(admin).post('/admin/roster-sync/approve')).status).toBe(404);
  });

  it('a rejected change is discarded; a source that fails is reported', async () => {
    remote.body = csv(base.map(([r]) => [r, 'Everyone Renamed'] as [string, string]));
    expect(await run(2)).toBe('waiting');
    await as(admin).post('/admin/roster-sync/reject').expect(200);
    const v = (await as(admin).get('/admin/roster-sync')).body.data as RosterSyncView;
    expect(v).toMatchObject({ lastStatus: 'rejected', pending: null });
    expect((await inT(() => WhitelistModel.findOne({ rollNumber: base[3]![0] }).lean()))?.name).not.toBe(
      'Everyone Renamed',
    );
    remote.status = 500;
    expect(await run(3)).toBe('failed');
    remote.status = undefined;
    expect(((await as(admin).get('/admin/roster-sync')).body.data as RosterSyncView).lastError).toContain(
      '500',
    );
  });

  it('weekly runs only on their day; paused runs do nothing', async () => {
    await as(admin).patch('/admin/roster-sync').send({ frequency: 'weekly', weekday: 0 }).expect(200);
    // 2026-11-06 is a Friday (weekday 5) in India.
    expect(await run(4)).toBe('skipped');
    await as(admin).patch('/admin/roster-sync').send({ enabled: false }).expect(200);
    expect(await run(5)).toBe('off');
  });
});

// ── Single sign-on ─────────────────────────────

describe('single sign-on (prompt 2, G9)', () => {
  const CLIENT = 'reach-client-id.apps.googleusercontent.com';
  const DIRECTORY = '6f4b2c1a-1111-4222-8333-944455556666';
  let jwks: ReturnType<typeof createLocalJWKSet>;
  let sign: (
    claims: Record<string, unknown>,
    o?: { iss?: string; aud?: string; exp?: number },
  ) => Promise<string>;
  let nextIdToken = '';
  const tokenRequests: string[] = [];

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' } as JWK;
    jwks = createLocalJWKSet({ keys: [jwk] });
    sign = (claims, o = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(o.iss ?? 'https://accounts.google.com')
        .setAudience(o.aud ?? CLIENT)
        .setIssuedAt()
        .setExpirationTime(o.exp ?? Math.floor(Date.now() / 1000) + 600)
        .sign(privateKey);
    const sso = services().sso;
    sso.keys = () => jwks;
    sso.fetchImpl = async (url, init) => {
      tokenRequests.push(`${String(url)} ${String(init?.body ?? '')}`);
      return new Response(JSON.stringify({ id_token: nextIdToken }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
  });

  /** Starts a sign-in and returns the state, nonce and the browser's state cookie. */
  async function start(provider = 'google') {
    const r = await request(ctx.app).get(`/api/v1/auth/sso/${provider}/start?next=/jobs`).set('Host', T.host);
    expect(r.status, JSON.stringify(r.body)).toBe(302);
    const loc = new URL(r.headers.location as string);
    const cookie = ((r.headers['set-cookie'] as unknown as string[]) ?? []).find((c) =>
      c.startsWith('cl_sso='),
    );
    return {
      loc,
      state: loc.searchParams.get('state') ?? '',
      nonce: loc.searchParams.get('nonce') ?? '',
      cookie: cookie?.split(';')[0] ?? '',
    };
  }
  async function callback(s: { state: string; cookie: string }, provider = 'google', extra = '') {
    return request(ctx.app)
      .get(`/api/v1/auth/sso/${provider}/callback?code=the-code&state=${s.state}${extra}`)
      .set('Host', T.host)
      .set('Cookie', s.cookie);
  }
  const googleClaims = (nonce: string, email = 'priya@reach.edu', sub = 'g-priya') => ({
    sub,
    nonce,
    email,
    email_verified: true,
    hd: email.split('@')[1],
    name: 'Priya R',
  });

  it('is off until the college sets it up; settings never return the secret', async () => {
    expect(
      (await request(ctx.app).get('/api/v1/auth/sso/providers').set('Host', T.host)).body.data.providers,
    ).toEqual([]);
    expect((await request(ctx.app).get('/api/v1/auth/sso/google/start').set('Host', T.host)).status).toBe(
      404,
    );
    expect((await as(staff).get('/admin/sign-in')).status).toBe(403);
    expect(
      (await as(admin).put('/admin/sign-in/google').send({ enabled: true, clientId: CLIENT })).status,
    ).toBe(400);
    const r = await as(admin)
      .put('/admin/sign-in/google')
      .send({ enabled: true, clientId: CLIENT, clientSecret: 'google-secret-value' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const v = r.body.data as SsoSettingsView;
    expect(v.providers.find((p) => p.provider === 'google')).toMatchObject({
      enabled: true,
      hasSecret: true,
      redirectUri: 'http://reach.localhost:5173/api/v1/auth/sso/google/callback',
    });
    expect(JSON.stringify(v)).not.toContain('google-secret-value');
    await as(admin)
      .put('/admin/sign-in/microsoft')
      .send({
        enabled: true,
        clientId: 'reach-entra-client',
        clientSecret: 'entra-secret-value',
        directoryId: DIRECTORY,
      })
      .expect(200);
    expect(
      (await request(ctx.app).get('/api/v1/auth/sso/providers').set('Host', T.host)).body.data.providers,
    ).toEqual(['google', 'microsoft']);
    expect(
      (await request(ctx.app).get('/api/v1/auth/sso/providers').set('Host', U.host)).body.data.providers,
    ).toEqual([]);
  });

  it('sends the browser to Google with PKCE, state, nonce and the college domain', async () => {
    const s = await start();
    expect(s.loc.origin + s.loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(s.loc.searchParams)).toMatchObject({
      client_id: CLIENT,
      response_type: 'code',
      code_challenge_method: 'S256',
      hd: 'reach.edu',
    });
    expect(s.loc.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.cookie).toMatch(/^cl_sso=/);
  });

  it('signs an existing member in, links the account, and returns to where they were going', async () => {
    const s = await start();
    nextIdToken = await sign(googleClaims(s.nonce));
    const r = await callback(s);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/jobs');
    expect(((r.headers['set-cookie'] as unknown as string[]) ?? []).some((c) => c.startsWith('cl_rt='))).toBe(
      true,
    );
    expect(tokenRequests.at(-1)).toContain('code_verifier=');
    expect(tokenRequests.at(-1)).toContain('client_secret=google-secret-value');
    const u = await inT(() => UserModel.findById(student.id).lean());
    expect(u?.ssoIdentities).toMatchObject([{ provider: 'google', subject: 'g-priya' }]);
  });

  it('refuses a wrong issuer, audience or nonce, an expired token, another domain, an unconfirmed address', async () => {
    const cases: [string, (n: string) => Promise<string>, string][] = [
      ['issuer', (n) => sign(googleClaims(n), { iss: 'https://evil.example' }), 'failed'],
      ['audience', (n) => sign(googleClaims(n), { aud: 'someone-else' }), 'failed'],
      ['nonce', () => sign(googleClaims('not-the-nonce')), 'failed'],
      ['expired', (n) => sign(googleClaims(n), { exp: Math.floor(Date.now() / 1000) - 3600 }), 'failed'],
      ['domain', (n) => sign(googleClaims(n, 'priya@gmail.com', 'g-other')), 'domain'],
      ['unconfirmed', (n) => sign({ ...googleClaims(n), email_verified: false }), 'failed'],
    ];
    for (const [label, make, reason] of cases) {
      const s = await start();
      nextIdToken = await make(s.nonce);
      const r = await callback(s);
      expect(r.headers.location, label).toBe(`/sign-in#sso_error=${reason}`);
      expect(
        ((r.headers['set-cookie'] as unknown as string[]) ?? []).some((c) => c.startsWith('cl_rt=')),
        label,
      ).toBe(false);
    }
  });

  it('a callback without this browser\x27s state, or a second time, is refused', async () => {
    const s = await start();
    nextIdToken = await sign(googleClaims(s.nonce));
    expect((await callback({ state: s.state, cookie: '' })).headers.location).toBe(
      '/sign-in#sso_error=expired',
    );
    const fresh = await start();
    nextIdToken = await sign(googleClaims(fresh.nonce));
    expect((await callback(fresh)).headers.location).toBe('/jobs');
    expect((await callback(fresh)).headers.location).toBe('/sign-in#sso_error=expired');
    // The member cancelled at Google.
    const c = await start();
    expect((await callback(c, 'google', '&error=access_denied')).headers.location).toBe(
      '/sign-in#sso_error=cancelled',
    );
  });

  it('admins still enter their two-factor code', async () => {
    const s = await start();
    nextIdToken = await sign(googleClaims(s.nonce, 'admin@reach.edu', 'g-admin'));
    const r = await callback(s);
    expect(r.headers.location).toMatch(/^\/sign-in#mfa=/);
    expect(((r.headers['set-cookie'] as unknown as string[]) ?? []).some((c) => c.startsWith('cl_rt='))).toBe(
      false,
    );
  });

  it('someone new finishes sign-up (terms, birth month, role); roster verification still applies', async () => {
    const s = await start();
    nextIdToken = await sign(googleClaims(s.nonce, 'arjun.k@reach.edu', 'g-arjun'));
    const r = await callback(s);
    const ticket = /^\/sign-up\/sso#ticket=([A-Za-z0-9_-]+)$/.exec(r.headers.location as string)?.[1] ?? '';
    expect(ticket).toBeTruthy();
    const who = await request(ctx.app).post('/api/v1/auth/sso/pending').set('Host', T.host).send({ ticket });
    expect(who.body.data).toEqual({ provider: 'google', email: 'arjun.k@reach.edu', name: 'Priya R' });
    const bad = await request(ctx.app)
      .post('/api/v1/auth/sso/complete')
      .set('Host', T.host)
      .send({ ticket, intent: 'STUDENT', birthMonth: '2004-05', consents: [] });
    expect(bad.status).toBe(400);
    const ok = await request(ctx.app)
      .post('/api/v1/auth/sso/complete')
      .set('Host', T.host)
      .send({ ticket, intent: 'STUDENT', birthMonth: '2004-05', consents: ['account'] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.session.accessToken).toBeTruthy();
    const u = await inT(() =>
      UserModel.findOne({ email: 'arjun.k@reach.edu' }).select('+passwordHash').lean(),
    );
    expect(u).toMatchObject({ verified: false, roles: ['STUDENT'] });
    expect(u?.emailVerifiedAt).toBeTruthy();
    expect(u?.passwordHash).toBeUndefined();
    // The ticket is single use.
    expect(
      (await request(ctx.app).post('/api/v1/auth/sso/pending').set('Host', T.host).send({ ticket })).status,
    ).toBe(404);
  });

  it('an address registered in advance by someone else loses its password and sessions', async () => {
    const squatter = await makeUser(ctx, T, {
      roles: ['STUDENT'],
      email: 'kiran@reach.edu',
      emailVerified: false,
    });
    const s = await start();
    nextIdToken = await sign(googleClaims(s.nonce, 'kiran@reach.edu', 'g-kiran'));
    expect((await callback(s)).headers.location).toBe('/jobs');
    const u = await inT(() => UserModel.findById(squatter.id).select('+passwordHash').lean());
    expect(u?.passwordHash).toBeUndefined();
    expect(u?.emailVerifiedAt).toBeTruthy();
    expect(await inT(() => SessionModel.countDocuments({ userId: squatter.id, revokedAt: null }))).toBe(1);
  });

  it('Microsoft: only the college\x27s own directory', async () => {
    const s = await start('microsoft');
    expect(s.loc.origin + s.loc.pathname).toBe(
      `https://login.microsoftonline.com/${DIRECTORY}/oauth2/v2.0/authorize`,
    );
    const iss = `https://login.microsoftonline.com/${DIRECTORY}/v2.0`;
    nextIdToken = await sign(
      { sub: 'm-priya', nonce: s.nonce, tid: 'another-directory', preferred_username: 'priya@reach.edu' },
      { iss, aud: 'reach-entra-client' },
    );
    expect((await callback(s, 'microsoft')).headers.location).toBe('/sign-in#sso_error=failed');
    const ok = await start('microsoft');
    nextIdToken = await sign(
      {
        sub: 'm-priya',
        nonce: ok.nonce,
        tid: DIRECTORY,
        preferred_username: 'Priya@Reach.edu',
        name: 'Priya R',
      },
      { iss, aud: 'reach-entra-client' },
    );
    expect((await callback(ok, 'microsoft')).headers.location).toBe('/jobs');
    const u = await inT(() => UserModel.findById(student.id).lean());
    expect(u?.ssoIdentities.map((i: { provider: string }) => i.provider)).toEqual(['google', 'microsoft']);
  });

  it('a suspended member is refused', async () => {
    await inT(() => UserModel.updateOne({ _id: student.id }, { $set: { status: 'suspended' } }));
    const s = await start();
    nextIdToken = await sign(googleClaims(s.nonce));
    expect((await callback(s)).headers.location).toBe('/sign-in#sso_error=suspended');
    await inT(() => UserModel.updateOne({ _id: student.id }, { $set: { status: 'active' } }));
  });
});

describe('privacy (prompt 2, G9)', () => {
  it('export carries the calendar feed; erasure removes it', async () => {
    await as(student).post('/me/calendar-feed').expect(200);
    const svc = ctx.app.locals.services as {
      calendar: { exportFor: (id: string) => Promise<unknown>; eraseFor: (id: string) => Promise<void> };
    };
    expect(await inT(() => svc.calendar.exportFor(student.id))).toMatchObject({
      calendarFeed: { createdAt: expect.any(Date) },
    });
    await inT(() => svc.calendar.eraseFor(student.id));
    expect(await inT(() => CalendarFeedModel.countDocuments({ userId: student.id }))).toBe(0);
    expect(foreign).toBeTruthy();
  });
});
