import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { api, makeTenant, makeUser, PASSWORD, testApp, type TestTenant, type TestUser } from './helpers.js';
import { postJob } from './jobs-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import type { PrivacyService } from '../src/modules/privacy/privacy.service.js';
import type { GamificationService } from '../src/modules/gamification/gamification.service.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { PostModel } from '../src/modules/feed/post.model.js';
import { ConversationModel, MessageModel } from '../src/modules/messaging/conversation.model.js';
import { SavedJobModel } from '../src/modules/jobs/job.model.js';
import { XpEventModel } from '../src/modules/gamification/gamification.model.js';
import { ConsentModel } from '../src/modules/consent/consent.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { SubjectEnrollmentModel, SubjectModel } from '../src/modules/study/subject.model.js';
import { MaterialModel } from '../src/modules/study/material.model.js';
import { FileModel } from '../src/modules/files/file.model.js';

const ctx = testApp();
const services = ctx.app.locals.services as {
  privacy: PrivacyService;
  gamification: GamificationService;
  cipher: { encrypt(s: string): string };
};
let T: TestTenant;
let alum: TestUser, other: TestUser, staff: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);
let jobId: string;

beforeAll(async () => {
  T = await makeTenant('privacytest');
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  other = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  staff = await makeUser(ctx, T, { roles: ['FACULTY'] });
  await as(alum).put('/me/profile').send({ headline: 'Demo backend engineer', phone: '+919876543210' });
  await as(alum).post('/posts').send({ kind: 'text', body: 'Privacy demo post from the leaving member' });
  jobId = (await postJob(ctx, T, staff)).id;
  await as(alum).put(`/jobs/${jobId}/track`).send({ status: 'applied', note: 'Private note' });
  await runInTenant(T._id, async () => {
    const subject = await SubjectModel.create({
      name: 'Demo privacy subject',
      code: 'PRV101',
      ownerIds: [new Types.ObjectId(staff.id)],
      contributorIds: [new Types.ObjectId(alum.id)],
      createdBy: new Types.ObjectId(staff.id),
    });
    const file = (purpose: string) =>
      FileModel.create({
        ownerId: new Types.ObjectId(alum.id),
        purpose,
        mime: 'text/plain',
        size: 4,
        storageKey: `k/${purpose}${Math.random()}`,
        sha256: 'x',
      });
    const keep = await file('study_material');
    const drop = await file('study_material');
    const base = {
      subjectId: subject._id,
      type: 'notes',
      category: 'notes',
      uploaderId: new Types.ObjectId(alum.id),
      rightsAttestedAt: new Date(),
    };
    await MaterialModel.create([
      { ...base, title: 'Demo shared notes', fileId: keep._id, visibility: 'published' },
      { ...base, title: 'Demo pending notes', fileId: drop._id, visibility: 'in_review' },
    ]);
    await SubjectEnrollmentModel.create({
      subjectId: subject._id,
      userId: new Types.ObjectId(alum.id),
      kind: 'include',
      by: new Types.ObjectId(staff.id),
    });
    await services.gamification.award(alum.id, 'event_attended', 'privacy-event', { from: staff.id });
    const conv = await ConversationModel.create({
      participants: [new Types.ObjectId(alum.id), new Types.ObjectId(other.id)],
      pairKey: [alum.id, other.id].sort().join('|'),
    });
    await MessageModel.create([
      {
        conversationId: conv._id,
        senderId: new Types.ObjectId(alum.id),
        bodyEnc: services.cipher.encrypt('Mine: hello'),
      },
      {
        conversationId: conv._id,
        senderId: new Types.ObjectId(other.id),
        bodyEnc: services.cipher.encrypt('Theirs: hi back'),
      },
    ]);
  });
});

describe('export', () => {
  it('downloads my data as JSON, only mine, and audits it', async () => {
    expect((await api(ctx, T.host).get('/me/export')).status).toBe(401);
    const r = await as(alum).get('/me/export');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/json');
    expect(r.headers['content-disposition']).toMatch(
      /attachment; filename="my-data-\d{4}-\d{2}-\d{2}\.json"/,
    );
    const d = JSON.parse(r.text);
    expect(d).toMatchObject({ userId: alum.id, college: 'privacytest', deletion: null });
    expect(d.account.account.email).toBe(alum.email);
    expect(d.profile).toMatchObject({ headline: 'Demo backend engineer', phone: '+919876543210' });
    expect(d.profile.phoneEnc).toBeUndefined();
    expect(d.posts.posts[0].body).toBe('Privacy demo post from the leaving member');
    expect(d.messages).toEqual([expect.objectContaining({ body: 'Mine: hello' })]);
    expect(r.text).not.toContain('Theirs: hi back');
    expect(d.jobs.tracker[0]).toMatchObject({ status: 'applied', note: 'Private note' });
    expect(d.points.points[0]).toMatchObject({ kind: 'event_attended', points: 10 });
    expect(Array.isArray(d.consents)).toBe(true);
    expect(d.subjects.subjects).toEqual([
      { subject: 'PRV101 Demo privacy subject', owner: false, contributor: true, created: false },
    ]);
    expect(d.subjects.enrollmentOverrides).toEqual([expect.objectContaining({ kind: 'include' })]);
    expect(d.aiSettings).toEqual([]);
    expect(d.materials.map((m: { title: string }) => m.title).sort()).toEqual([
      'Demo pending notes',
      'Demo shared notes',
    ]);
    // No secrets or other people's data.
    expect(r.text).not.toContain('passwordHash');
    expect(r.text).not.toContain(other.email);
    expect(
      await runInTenant(T._id, () =>
        AuditModel.countDocuments({ action: 'privacy.exported', actorId: alum.id }),
      ),
    ).toBe(1);
  });
});

describe('deletion', () => {
  it('needs the password, signs out everywhere and hides the profile', async () => {
    expect((await as(alum).post('/me/deletion').send({ password: 'wrong-password' })).status).toBe(400);
    expect((await as(alum).get('/me/deletion')).body.data).toEqual({ deletion: null });
    const r = await as(alum).post('/me/deletion').send({ password: PASSWORD });
    expect(r.status).toBe(200);
    const purgeAt = new Date(r.body.data.deletion.purgeAt).getTime();
    expect(purgeAt).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    // The old token no longer works.
    expect((await as(alum).get('/me/deletion')).status).toBe(401);
    expect((await as(other).get(`/profiles/${alum.id}`)).status).toBe(404);
    // Signing in again is allowed, to cancel.
    const login = await api(ctx, T.host).post('/auth/login').send({ email: alum.email, password: PASSWORD });
    expect(login.status).toBe(200);
    alum = { ...alum, token: login.body.data.session.accessToken };
    const st = await as(alum).get('/me/deletion');
    // While deletion is pending the account keeps no permissions.
    expect((await as(alum).get('/jobs')).status).toBe(403);
    expect(st.body.data.deletion).toBeTruthy();
    expect((await as(alum).post('/me/deletion').send({ password: PASSWORD })).status).toBe(409);
    expect((await as(alum).delete('/me/deletion')).body.data).toEqual({ deletion: null });
    expect((await as(alum).delete('/me/deletion')).status).toBe(409);
    expect((await as(other).get(`/profiles/${alum.id}`)).status).toBe(200);
  });

  it('erases the account after the grace period, keeping consent evidence and the audit log', async () => {
    await as(alum).post('/me/deletion').send({ password: PASSWORD });
    const consentsBefore = await runInTenant(T._id, () => ConsentModel.countDocuments({ userId: alum.id }));
    // Nothing happens before the grace period ends.
    expect(await runInTenant(T._id, () => services.privacy.purgeDue())).toBe(0);
    await runInTenant(T._id, () =>
      UserModel.updateOne({ _id: alum.id }, { $set: { deletionPurgeAt: new Date(Date.now() - 1000) } }),
    );
    expect(await runInTenant(T._id, () => services.privacy.purgeDue())).toBe(1);
    await runInTenant(T._id, async () => {
      expect(await UserModel.countDocuments({ _id: alum.id })).toBe(0);
      expect(await ProfileModel.countDocuments({ userId: alum.id })).toBe(0);
      expect(await PostModel.countDocuments({ authorId: alum.id })).toBe(0);
      expect(await SavedJobModel.countDocuments({ userId: alum.id })).toBe(0);
      expect(await XpEventModel.countDocuments({ userId: alum.id })).toBe(0);
      expect(await SubjectModel.countDocuments({ contributorIds: alum.id })).toBe(0);
      expect(await SubjectModel.countDocuments({ code: 'PRV101' })).toBe(1);
      expect(await SubjectEnrollmentModel.countDocuments({ userId: alum.id })).toBe(0);
      // Shared (published) material stays with the college as a former member's; pending uploads go.
      const shared = await MaterialModel.findOne({ title: 'Demo shared notes' }).lean();
      expect(shared?.uploaderId).toBeNull();
      expect((await FileModel.findById(shared?.fileId).lean())?.ownerId).toBeNull();
      expect(await MaterialModel.countDocuments({ title: 'Demo pending notes' })).toBe(0);
      expect(await FileModel.countDocuments({ ownerId: alum.id })).toBe(0);
      const mine = await MessageModel.findOne({ senderId: alum.id }).lean();
      expect(mine?.bodyEnc).toBeNull();
      const theirs = await MessageModel.findOne({ senderId: other.id }).lean();
      expect(theirs?.bodyEnc).toBeTruthy();
      expect(await ConsentModel.countDocuments({ userId: alum.id })).toBe(consentsBefore);
      expect(await AuditModel.countDocuments({ action: 'privacy.erased', targetId: alum.id })).toBe(1);
    });
    expect(
      (await api(ctx, T.host).post('/auth/login').send({ email: alum.email, password: PASSWORD })).status,
    ).toBe(401);
    // The other person's view of the conversation shows a former member.
    expect((await as(other).get(`/profiles/${alum.id}`)).status).toBe(404);
  });

  it('every module with personal data registers an exporter', () => {
    expect(services.privacy.modules).toEqual(
      expect.arrayContaining([
        'account',
        'profile',
        'posts',
        'messages',
        'jobs',
        'referrals',
        'roadmaps',
        'points',
        'events',
        'files',
        'subjects',
        'aiSettings',
        'materials',
      ]),
    );
  });
});
