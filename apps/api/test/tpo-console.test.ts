import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { VerificationRequestModel } from '../src/modules/verification/verification.model.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { InviteLinkModel } from '../src/modules/verification/onboarding.model.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { PostModel } from '../src/modules/feed/post.model.js';
import { UserModel } from '../src/modules/auth/user.model.js';

const ctx = testApp();
let T: TestTenant;
let tpo: TestUser, faculty: TestUser, ece27: TestUser, cse27: TestUser, ece26: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);

async function place(u: TestUser, branch: string, gradYear: number) {
  await runInTenant(T._id, () => ProfileModel.updateOne({ userId: u.id }, { $set: { branch, gradYear } }));
}
const announce = (u: TestUser, body: string, extra: Record<string, unknown> = {}) =>
  as(u)
    .post('/posts')
    .send({ kind: 'text', body, announcement: true, ...extra });
const feedIds = async (u: TestUser) =>
  ((await as(u).get('/feed?tab=for_you')).body.data as { type: string; post?: { id: string } }[])
    .filter((e) => e.type === 'post')
    .map((e) => e.post?.id);

beforeAll(async () => {
  T = await makeTenant('tpoconsole', 'college', { whatsapp: true });
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  ece27 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  cse27 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  ece26 = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  await place(ece27, 'ECE', 2027);
  await place(cse27, 'CSE', 2027);
  await place(ece26, 'ECE', 2026);
});

describe('bulk verification decisions (B6)', () => {
  async function pending(n: number) {
    const users = await Promise.all(
      Array.from({ length: n }, () => makeUser(ctx, T, { roles: ['STUDENT'], verified: false })),
    );
    return runInTenant(T._id, async () => {
      const ids: string[] = [];
      for (const [i, u] of users.entries()) {
        const r = await VerificationRequestModel.create({
          userId: u.id,
          method: 'id_card',
          rollNumber: `24BK1A${String(Date.now() % 10_000).padStart(4, '0')}${i}`,
          gradYear: 2027,
        });
        ids.push(String(r._id));
      }
      return { ids, users };
    });
  }

  it('decides each request on its own, reports per-id results and audits every decision', async () => {
    const { ids, users } = await pending(3);
    // One is already decided; one id does not exist.
    await as(tpo)
      .post(`/admin/verification/${ids[2]}/decision`)
      .send({ decision: 'reject', reason: 'Blurred photo' });
    const missing = new Types.ObjectId().toString();
    const r = await as(tpo)
      .post('/admin/verification/bulk-decision')
      .send({ ids: [...ids, missing], decision: 'approve' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.map((x: { ok: boolean }) => x.ok)).toEqual([true, true, false, false]);
    expect(r.body.data[2]).toMatchObject({ id: ids[2], error: 'NOT_FOUND' });
    const approved = await runInTenant(T._id, () =>
      AuditModel.countDocuments({
        action: 'verification.approved',
        actorId: tpo.id,
        targetId: { $in: users.slice(0, 2).map((u) => u.id) },
      }),
    );
    expect(approved).toBe(2);
    const verified = await runInTenant(T._id, () =>
      UserModel.countDocuments({ _id: { $in: users.map((u) => u.id) }, verified: true }),
    );
    expect(verified).toBe(2);
  });

  it('a rejection without a reason fails for each id; members cannot decide; at most 100 ids', async () => {
    const { ids } = await pending(2);
    const r = await as(tpo).post('/admin/verification/bulk-decision').send({ ids, decision: 'reject' });
    expect(
      r.body.data.every((x: { ok: boolean; error: string }) => !x.ok && x.error === 'VALIDATION_FAILED'),
    ).toBe(true);
    expect(
      (await as(ece27).post('/admin/verification/bulk-decision').send({ ids, decision: 'approve' })).status,
    ).toBe(403);
    const many = Array.from({ length: 101 }, () => new Types.ObjectId().toString());
    expect(
      (await as(tpo).post('/admin/verification/bulk-decision').send({ ids: many, decision: 'approve' }))
        .status,
    ).toBe(400);
  });
});

describe('targeted announcements (B6)', () => {
  it('only the audience sees a targeted announcement, in the feed, lists, the post and search', async () => {
    const r = await announce(faculty, 'Placement talk for ECE 2027\nRoom 204 at 3 pm.', {
      audience: { branches: ['ECE'], gradYears: [2027] },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.audience).toEqual({ branches: ['ECE'], gradYears: [2027], roles: [] });
    const id = r.body.data.id as string;
    expect(await feedIds(ece27)).toContain(id);
    expect(await feedIds(cse27)).not.toContain(id);
    expect(await feedIds(ece26)).not.toContain(id);
    expect((await as(cse27).get(`/posts/${id}`)).status).toBe(404);
    expect((await as(ece27).get(`/posts/${id}`)).status).toBe(200);
    const list = (await as(cse27).get(`/posts?author=${faculty.id}`)).body.data.map(
      (p: { id: string }) => p.id,
    );
    expect(list).not.toContain(id);
    // Staff who post announcements see all of them.
    expect(await feedIds(tpo)).toContain(id);
    const roles = await announce(faculty, 'Alumni meet this Saturday', { audience: { roles: ['ALUMNI'] } });
    expect(await feedIds(ece26)).toContain(roles.body.data.id);
    expect(await feedIds(ece27)).not.toContain(roles.body.data.id);
  });

  it('ordinary posts cannot be targeted, pinned or sent on WhatsApp', async () => {
    const r = await as(faculty)
      .post('/posts')
      .send({ kind: 'text', body: 'Hello', audience: { branches: ['ECE'] } });
    expect(r.status).toBe(400);
    expect((await as(faculty).post('/posts').send({ kind: 'text', body: 'Hi', pinDays: 3 })).status).toBe(
      400,
    );
    expect(
      (await as(ece27).post('/posts').send({ kind: 'text', body: 'Hi', announcement: true })).status,
    ).toBe(403);
  });

  it('pinned announcements lead For you, newest first, until the pin ends', async () => {
    const older = await announce(faculty, 'Pinned one', { pinDays: 3 });
    await as(faculty).post('/posts').send({ kind: 'text', body: 'A fresh ordinary post' });
    const newer = await announce(faculty, 'Pinned two', { pinDays: 3 });
    const ids = await feedIds(ece27);
    expect(ids.slice(0, 2)).toEqual([newer.body.data.id, older.body.data.id]);
    expect(newer.body.data.pinnedUntil).toBeTruthy();
    await runInTenant(T._id, () =>
      PostModel.updateOne(
        { _id: newer.body.data.id },
        { $set: { pinnedUntil: new Date(Date.now() - 1000) } },
      ),
    );
    expect((await feedIds(ece27))[0]).toBe(older.body.data.id);
  });

  it('sends the title (not the body) to the audience, and caps urgent ones at four a month', async () => {
    expect((await announce(faculty, 'Urgent without WhatsApp', { urgent: true })).status).toBe(400);
    const r = await announce(faculty, 'Exam hall changed\nThe CSE 2027 exam moves to Block C.', {
      audience: { branches: ['CSE'] },
      sendWhatsApp: true,
      urgent: true,
    });
    expect(r.status).toBe(201);
    await ctx.queue.drain();
    const notes = await runInTenant(T._id, () =>
      NotificationModel.find({ type: 'announcement', 'data.postId': r.body.data.id }).lean(),
    );
    expect(notes.map((n) => String(n.userId))).toEqual([cse27.id]);
    expect((notes[0]?.data as unknown as Record<string, string>).title).toBe('Exam hall changed');
    expect(JSON.stringify(notes)).not.toContain('Block C');
    for (let i = 0; i < 3; i++)
      expect((await announce(faculty, `Urgent ${i}`, { sendWhatsApp: true, urgent: true })).status).toBe(201);
    const fifth = await announce(faculty, 'One too many', { sendWhatsApp: true, urgent: true });
    expect(fifth.status).toBe(409);
    expect((await announce(faculty, 'Not urgent is fine', { sendWhatsApp: true })).status).toBe(201);
  });
});

describe('onboarding progress (B6)', () => {
  it('counts the list, invites, joins, verification and activity per branch and batch', async () => {
    const c = ctx.services.cipher;
    await runInTenant(T._id, async () => {
      for (let i = 0; i < 6; i++)
        await WhitelistModel.create({
          rollNumber: `22PR1A050${i}`,
          name: `Progress Student ${i}`,
          branch: 'MECH',
          gradYear: 2028,
          kind: 'student',
          source: 'import',
          phoneEnc: c.encrypt(`+9196000000${10 + i}`),
          phoneIndex: c.blindIndex(`+9196000000${10 + i}`),
          ...(i < 2
            ? { status: 'claimed', claimedBy: i === 0 ? ece27.id : cse27.id, claimedAt: new Date() }
            : {}),
        });
      const recs = await WhitelistModel.find({ branch: 'MECH', gradYear: 2028 }).lean();
      for (const rec of recs.slice(0, 3))
        await InviteLinkModel.create({
          whitelistId: rec._id,
          tokenHash: `progress-${String(rec._id)}`,
          createdBy: tpo.id,
          channel: 'csv',
          expiresAt: new Date(Date.now() + 86_400_000),
        });
    });
    const r = await as(tpo).get('/admin/onboarding?branch=MECH&gradYear=2028');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([
      { branch: 'MECH', gradYear: 2028, roster: 6, invited: 3, claimed: 2, verified: 2, active7d: '<5' },
    ]);
    expect((await as(ece27).get('/admin/onboarding')).status).toBe(403);
    const overview = await as(tpo).get('/admin/overview');
    expect(overview.body.data.onboarding.notJoined).toBeGreaterThanOrEqual(4);
  });

  it('nudges the not-yet-joined of one batch on WhatsApp, with the opt-in confirmed', async () => {
    expect(
      (await as(tpo).post('/admin/onboarding/nudge').send({ branch: 'MECH', gradYear: 2028 })).status,
    ).toBe(400);
    const r = await as(tpo)
      .post('/admin/onboarding/nudge')
      .send({ branch: 'MECH', gradYear: 2028, attestOptIn: true });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // Four have not joined; one of them was invited in the last 72 hours (skipped).
    expect(r.body.data).toMatchObject({ sent: 3, skipped: 1 });
  });
});
