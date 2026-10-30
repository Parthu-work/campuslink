/**
 * Build B9: first-party product events and the metrics built on them: funnel and cohort maths on
 * fixtures, minors and consent, retention roll-up, the platform's aggregate-only path, isolation.
 */
import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { ProductEventDailyModel, ProductEventModel } from '../src/modules/insights/insights.model.js';
import { dayOf, type InsightsService } from '../src/modules/insights/insights.service.js';

const ctx = testApp();
let T: TestTenant, U: TestTenant;
let tpo: TestUser, faculty: TestUser, adult: TestUser, minor: TestUser, noConsent: TestUser, other: TestUser;
const insights = () => ctx.app.locals.services.productInsights as InsightsService;
const DAY = 86_400_000;

/** Grants (or withdraws) aggregate analytics the way a member does, in Settings. */
async function consent(t: TestTenant, u: TestUser, granted = true) {
  const r = await api(ctx, t.host, u.token)
    .post('/me/consents')
    .send({ purpose: 'analytics_aggregate', granted });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}
const events = (t: TestTenant, filter: Record<string, unknown> = {}) =>
  runInTenant(t._id, () => ProductEventModel.find(filter).lean());

beforeAll(async () => {
  T = await makeTenant('insights-b9');
  U = await makeTenant('insights-b9-other');
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  adult = await makeUser(ctx, T, { roles: ['STUDENT'] });
  minor = await makeUser(ctx, T, { roles: ['STUDENT'] });
  noConsent = await makeUser(ctx, T, { roles: ['STUDENT'] });
  other = await makeUser(ctx, U, { roles: ['STUDENT'] });
  for (const u of [adult, minor]) await consent(T, u);
  await consent(U, other);
  await runInTenant(T._id, () =>
    UserModel.updateOne({ _id: minor.id }, { $set: { adultOn: new Date(Date.now() + 365 * DAY) } }),
  );
});

describe('recording product events (B9)', () => {
  it('records adults who consented, once a day for visits; never minors or the unconsented', async () => {
    for (const u of [adult, minor, noConsent]) {
      await api(ctx, T.host, u.token).get('/me');
      await api(ctx, T.host, u.token).get('/me');
    }
    const visits = await events(T, { name: 'visited' });
    expect(visits.map((e) => String(e.userId))).toEqual([adult.id]);
    expect(visits[0]?.day).toBe(dayOf(new Date()));
  });

  it('keeps only ids and enum values in props', async () => {
    await runInTenant(T._id, () =>
      insights().track(adult.id, 'roadmap_step', {
        roadmapId: '0123456789abcdef01234567',
        outcome: 'accepted',
        note: 'Free text with spaces',
        'bad key': 'x',
      }),
    );
    const [e] = await events(T, { name: 'roadmap_step' });
    expect(e?.props).toEqual({ roadmapId: '0123456789abcdef01234567', outcome: 'accepted' });
  });

  it('withdrawing consent stops recording and detaches past events', async () => {
    const r = await api(ctx, T.host, adult.token)
      .post('/me/consents')
      .send({ purpose: 'analytics_aggregate', granted: false });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await runInTenant(T._id, () => insights().track(adult.id, 'study_question', {}));
    expect(await events(T, { userId: new Types.ObjectId(adult.id) })).toEqual([]);
    const detached = await events(T, { name: 'visited' });
    expect(detached[0]).toMatchObject({ userId: null });
    expect(detached[0]?.anonKey).toMatch(/^[0-9a-f-]{36}$/);
    await consent(T, adult);
  });
});

describe('metrics on fixtures (B9)', () => {
  /** A fixed Wednesday, so every week below is whole and known. */
  const NOW = new Date('2026-10-28T12:00:00Z');
  const day = (back: number) => dayOf(new Date(NOW.getTime() - back * DAY));
  let F: TestTenant;

  beforeAll(async () => {
    F = await makeTenant('insights-fixture');
    await runInTenant(F._id, async () => {
      const ids = Array.from({ length: 12 }, () => new Types.ObjectId());
      // Ten sign-ups 30 days ago (a whole week cohort: Monday 28 Sep), two 2 days ago (not mature).
      const rows: Record<string, unknown>[] = [
        ...ids.slice(0, 10).map((u) => ({ userId: u, day: day(30), name: 'signed_up' })),
        ...ids.slice(10).map((u) => ({ userId: u, day: day(2), name: 'signed_up' })),
        // Eight of the first ten verify; six of them act within 7 days, one on day 9 (too late).
        ...ids.slice(0, 8).map((u) => ({ userId: u, day: day(29), name: 'verified' })),
        ...ids.slice(0, 6).map((u) => ({ userId: u, day: day(27), name: 'roadmap_step' })),
        { userId: ids[6], day: day(21), name: 'study_question' },
        // Retention: five of the ten come back the week after, all ten two weeks after.
        ...ids.slice(0, 5).map((u) => ({ userId: u, day: day(23), name: 'visited' })),
        ...ids.slice(0, 10).map((u) => ({ userId: u, day: day(16), name: 'visited' })),
        // Mentorship: six requests sent, five became sessions.
        ...Array.from({ length: 6 }, (_, i) => ({
          userId: ids[i],
          day: day(20),
          name: 'request_sent',
          props: { requestId: `aaaaaaaaaaaaaaaaaaaaaa0${i}` },
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          userId: ids[i],
          day: day(10),
          name: 'session_completed',
          props: { requestId: `aaaaaaaaaaaaaaaaaaaaaa0${i}` },
        })),
      ];
      await ProductEventModel.create(rows);
      await ProfileModel.create(
        ids.map((u, i) => ({
          userId: u,
          name: `Fixture ${i}`,
          roles: i < 9 ? ['STUDENT'] : ['ALUMNI'],
          verified: true,
        })),
      );
    });
  });

  it('activation: invited → signed up → verified → a meaningful action within 7 days', async () => {
    const v = await runInTenant(F._id, () => insights().dashboard(NOW));
    expect(v.activation).toEqual({
      invited: 0,
      signedUp: 12,
      verified: 8,
      matured: 10,
      // Six acted within a week; the seventh acted on day 9.
      activated: 6,
      activationPct: 60,
    });
  });

  it('weekly actives by role, and week-N retention for the signup cohort', async () => {
    const v = await runInTenant(F._id, () => insights().dashboard(NOW));
    const week = (d: string) => v.weeklyActive.find((w) => w.week === d);
    // The week of 12 October (16 days back is 12 Oct): ten members, nine students and one alumnus.
    expect(week('2026-10-12')).toEqual({
      week: '2026-10-12',
      students: 9,
      alumni: '<5',
      staff: 0,
      total: 10,
    });
    const cohort = v.retention.find((c) => c.week === '2026-09-28');
    expect(cohort?.size).toBe(10);
    // Week 1: seven of ten (five visits, one more request, one study question); week 2: all ten;
    // weeks 3 and 4: nobody; later weeks have not happened yet.
    expect(cohort?.retained).toEqual([70, 100, 0, 0, null, null, null]);
    // A cohort under 5 shows no percentages.
    const small = v.retention.find((c) => c.week === '2026-10-26');
    expect(small).toMatchObject({ size: '<5', retained: [null, null, null, null, null, null, null] });
  });

  it('request → session conversion', async () => {
    const v = await runInTenant(F._id, () => insights().dashboard(NOW));
    expect(v.mentorship).toMatchObject({ requests: 6, converted: 5, conversionPct: 83.3 });
  });

  it('rolls events past 13 months into daily counts and deletes them, once', async () => {
    await runInTenant(F._id, () =>
      ProductEventModel.create([
        { userId: new Types.ObjectId(), day: '2025-01-05', name: 'visited' },
        { userId: new Types.ObjectId(), day: '2025-01-05', name: 'visited' },
        { userId: new Types.ObjectId(), day: '2025-01-05', name: 'study_question' },
      ]),
    );
    expect(await runInTenant(F._id, () => insights().rollupExpired(NOW))).toBe(1);
    expect(await runInTenant(F._id, () => insights().rollupExpired(NOW))).toBe(0);
    await runInTenant(F._id, async () => {
      expect(await ProductEventModel.countDocuments({ day: '2025-01-05' })).toBe(0);
      const daily = await ProductEventDailyModel.find({ day: '2025-01-05' }).sort({ name: 1 }).lean();
      expect(daily.map((d) => [d.name, d.count, d.members])).toEqual([
        ['study_question', 1, 1],
        ['visited', 2, 2],
      ]);
    });
  });
});

describe('who sees what (B9)', () => {
  it('the college sees its own metrics with analytics:tenant; faculty do not', async () => {
    expect((await api(ctx, T.host, faculty.token).get('/admin/insights')).status).toBe(403);
    const r = await api(ctx, T.host, tpo.token).get('/admin/insights');
    expect(r.status).toBe(200);
    expect(r.body.data.activation).toBeDefined();
    // College B's events never show at A, and A's never at B.
    await api(ctx, U.host, other.token).get('/me');
    const b = (await api(ctx, U.host, other.token).get('/admin/insights')).status;
    expect(b).toBe(403);
    expect((await events(U, { name: 'visited' })).map((e) => String(e.userId))).toEqual([other.id]);
    expect((await events(T)).some((e) => String(e.userId) === other.id)).toBe(false);
  });

  it('the platform reads per-college aggregates only, audit-logged; colleges cannot', async () => {
    const P = await makeTenant('insights-platform', 'platform');
    const sa = await makeUser(ctx, P, { roles: ['SUPER_ADMIN'], mfa: true });
    expect((await api(ctx, T.host, tpo.token).get('/platform/insights')).status).toBeGreaterThanOrEqual(400);
    const r = await api(ctx, P.host, sa.token).get('/platform/insights');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = r.body.data.colleges.find((c: { slug: string }) => c.slug === T.slug);
    expect(row).toMatchObject({ name: expect.any(String) });
    expect(Object.keys(row).sort()).toEqual(
      [
        'active28d',
        'active7d',
        'driveRegistrations',
        'name',
        'offersVerified',
        'requests',
        'sessions',
        'signUps',
        'slug',
        'studyQuestions',
        'tenantId',
      ].sort(),
    );
    // No member ids anywhere in the answer.
    for (const id of [adult.id, minor.id, other.id, tpo.id]) expect(JSON.stringify(r.body)).not.toContain(id);
    await runInTenant(P._id, async () => {
      expect(await AuditModel.countDocuments({ action: 'platform.insights_viewed', actorId: sa.id })).toBe(1);
    });
  });
});
