import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { PRIVACY_NOTICE_VERSION } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { SessionModel } from '../src/modules/auth/session.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { SupportTicketModel } from '../src/modules/support/support.model.js';
import { DriveRegistrationModel, PlacementDriveModel } from '../src/modules/placements/placements.model.js';
import { findTenantById } from '../src/modules/tenants/tenant.cache.js';
import { addMonths, type InactivityService } from '../src/modules/privacy/inactivity.service.js';

/** The inactive-account purge (prompt 1b, R7). */
const ctx = testApp();
const inactivity = () => (ctx.app.locals.services as { inactivity: InactivityService }).inactivity;
const DAY = 86_400_000;
let T: TestTenant;
let admin: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);

/** Makes a member look away since `last` (sign-in and every session). */
async function awaySince(u: TestUser, last: Date) {
  await runInTenant(T._id, async () => {
    await UserModel.updateOne({ _id: u.id }, { $set: { lastLoginAt: last } });
    await SessionModel.updateMany({ userId: new Types.ObjectId(u.id) }, { $set: { lastUsedAt: last } });
  });
}
const run = async (now: Date) => {
  const t = await findTenantById(T._id);
  if (!t) throw new Error('tenant');
  return runInTenant(T._id, () => inactivity().run(t, now));
};
const warnings = (u: TestUser) =>
  runInTenant(T._id, () => NotificationModel.countDocuments({ userId: u.id, type: 'account_inactive' }));
const statusOf = async (u: TestUser) =>
  (await runInTenant(T._id, () => UserModel.findById(u.id).select('status deletionPurgeAt').lean())) ?? null;

beforeAll(async () => {
  T = await makeTenant('inactive');
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
});

describe('the setting (prompt 1b, R7)', () => {
  it('is off by default, and only the college’s admins change it (24 to 120 months), audited', async () => {
    expect((await as(admin).get('/admin/retention')).body.data).toEqual({
      inactiveAccountMonths: null,
      deletedAccountGraceDays: 30,
    });
    const student = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
    for (const u of [student, faculty])
      expect((await as(u).put('/admin/retention').send({ inactiveAccountMonths: 36 })).status).toBe(403);
    for (const bad of [
      { inactiveAccountMonths: 12 },
      { inactiveAccountMonths: 121 },
      {},
      { inactiveAccountMonths: 30.5 },
    ])
      expect((await as(admin).put('/admin/retention').send(bad)).status, JSON.stringify(bad)).toBe(400);
  });

  it('the policy states it only while it is on, and each change is a new notice to accept', async () => {
    const page = async () => (await api(ctx, T.host).get('/legal/privacy')).body.data;
    const off = await page();
    expect(off.body).not.toContain('If you do not sign in');
    const on = await as(admin).put('/admin/retention').send({ inactiveAccountMonths: 24 });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.data.inactiveAccountMonths).toBe(24);
    const stated = await page();
    expect(stated.body).toContain('If you do not sign in for 24 months, your account is deleted');
    expect(stated.version).not.toBe(off.version);
    expect(stated.version.startsWith(PRIVACY_NOTICE_VERSION)).toBe(true);
    // Saving the same value again changes nothing.
    await as(admin).put('/admin/retention').send({ inactiveAccountMonths: 24 }).expect(200);
    expect((await page()).version).toBe(stated.version);
    const audits = await runInTenant(T._id, () =>
      AuditModel.find({ action: 'tenant.retention_changed' }).lean(),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.meta).toMatchObject({ inactiveMonthsBefore: null, inactiveMonthsAfter: 24 });
  });
});

describe('the purge (prompt 1b, R7)', () => {
  it('warns 60 and 14 days ahead (once each), then schedules erasure with the grace period, never at once', async () => {
    const now = new Date();
    const away = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    await awaySince(away, addMonths(now, -25));
    const recent = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    await awaySince(recent, addMonths(now, -6));

    await run(now);
    await run(now); // a second run the same day sends nothing new
    expect(await warnings(away)).toBe(1);
    expect(await warnings(recent)).toBe(0);
    // Long past the deadline already, the second warning still waits 46 days after the first …
    await run(new Date(now.getTime() + 30 * DAY));
    expect(await warnings(away)).toBe(1);
    await run(new Date(now.getTime() + 46 * DAY));
    expect(await warnings(away)).toBe(2);
    await run(new Date(now.getTime() + 50 * DAY));
    expect(await warnings(away)).toBe(2);
    expect((await statusOf(away))?.status).toBe('active');
    // … and the erasure is scheduled 14 days after the second, with the college's grace period.
    await run(new Date(now.getTime() + 60 * DAY));
    const s = await statusOf(away);
    expect(s?.status).toBe('deleting');
    expect(s?.deletionPurgeAt?.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(
      await runInTenant(T._id, () =>
        AuditModel.countDocuments({ action: 'privacy.inactive_deletion_scheduled', targetId: away.id }),
      ),
    ).toBe(1);
    expect(await runInTenant(T._id, () => UserModel.exists({ _id: away.id }))).not.toBeNull();
  });

  it('signing in starts the clock again', async () => {
    const now = new Date();
    const back = await makeUser(ctx, T, { roles: ['STUDENT'] });
    await awaySince(back, addMonths(now, -25));
    await run(now);
    expect(await warnings(back)).toBe(1);
    // They sign in after the first warning: nothing more, and no deletion.
    await runInTenant(T._id, () =>
      UserModel.updateOne({ _id: back.id }, { $set: { lastLoginAt: new Date(now.getTime() + DAY) } }),
    );
    for (const d of [46, 60, 90]) await run(new Date(now.getTime() + d * DAY));
    expect(await warnings(back)).toBe(1);
    expect((await statusOf(back))?.status).toBe('active');
  });

  it('a recent session refresh counts as activity', async () => {
    const now = new Date();
    const u = await makeUser(ctx, T, { roles: ['STUDENT'] });
    await awaySince(u, addMonths(now, -30));
    await runInTenant(T._id, () =>
      SessionModel.updateMany(
        { userId: new Types.ObjectId(u.id) },
        { $set: { lastUsedAt: addMonths(now, -1) } },
      ),
    );
    await run(now);
    expect(await warnings(u)).toBe(0);
  });

  it('never staff, nor members with an open report or a placement in progress', async () => {
    const now = new Date();
    const long = addMonths(now, -40);
    const tpo = await makeUser(ctx, T, { roles: ['TPO'] });
    const faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
    const reporter = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    const candidate = await makeUser(ctx, T, { roles: ['STUDENT'] });
    for (const u of [tpo, faculty, admin, reporter, candidate]) await awaySince(u, long);
    await runInTenant(T._id, async () => {
      await SupportTicketModel.collection.insertOne({
        tenantId: T._id,
        userId: new Types.ObjectId(reporter.id),
        status: 'answered',
        desk: 'college',
      });
      const drive = await PlacementDriveModel.collection.insertOne({
        tenantId: T._id,
        status: 'in_progress',
      });
      await DriveRegistrationModel.collection.insertOne({
        tenantId: T._id,
        driveId: drive.insertedId,
        userId: new Types.ObjectId(candidate.id),
        status: 'registered',
      });
    });
    for (const d of [0, 46, 60, 120]) await run(new Date(now.getTime() + d * DAY));
    for (const u of [tpo, faculty, admin, reporter, candidate]) {
      expect(await warnings(u)).toBe(0);
      expect((await statusOf(u))?.status).toBe('active');
    }
  });

  it('does nothing while the college has it off', async () => {
    const now = new Date();
    await as(admin).put('/admin/retention').send({ inactiveAccountMonths: null }).expect(200);
    const u = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    await awaySince(u, addMonths(now, -60));
    expect(await run(now)).toEqual({ warned: 0, scheduled: 0 });
    expect(await warnings(u)).toBe(0);
    expect((await api(ctx, T.host).get('/legal/privacy')).body.data.body).not.toContain(
      'If you do not sign in',
    );
  });
});
