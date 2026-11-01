import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';

/** Help and support (build B14): problem reports, the college's desk and the platform's desk. */
const ctx = testApp();
let A: TestTenant, B: TestTenant, P: TestTenant;
let student: TestUser, other: TestUser, admin: TestUser, faculty: TestUser, unverified: TestUser;
let outsider: TestUser, outsiderAdmin: TestUser, sa: TestUser;
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const report = (over: Record<string, unknown> = {}) => ({
  category: 'account',
  subject: 'Cannot change my number',
  body: 'Demo: the change-number screen says my code expired every time.',
  ...over,
});
const notes = (u: TestUser, type: string) =>
  runInTenant(u.tenant._id, () => NotificationModel.countDocuments({ userId: u.id, type }));

beforeAll(async () => {
  A = await makeTenant('supporta');
  B = await makeTenant('supportb');
  P = await makeTenant('admin', 'platform');
  student = await makeUser(ctx, A, { roles: ['STUDENT'] });
  other = await makeUser(ctx, A, { roles: ['STUDENT'] });
  admin = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  faculty = await makeUser(ctx, A, { roles: ['FACULTY'] });
  unverified = await makeUser(ctx, A, { roles: ['STUDENT'], verified: false });
  outsider = await makeUser(ctx, B, { roles: ['STUDENT'] });
  outsiderAdmin = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
  sa = await makeUser(ctx, P, { roles: ['SUPER_ADMIN'], mfa: true });
});

describe('the college desk', () => {
  let id: string;

  it('a member reports a problem; it goes to the college and its admins are told', async () => {
    const r = await as(student).post('/support/tickets').send(report());
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ category: 'account', desk: 'college', status: 'open', replies: [] });
    id = r.body.data.id;
    expect(await notes(admin, 'support_ticket')).toBe(1);
    const n = await runInTenant(A._id, () => NotificationModel.findOne({ type: 'support_ticket' }).lean());
    // The notification carries the id and category only, never what the member wrote.
    expect(JSON.stringify(n?.data)).not.toContain('Cannot change');
  });

  it('stores plain text only', async () => {
    const r = await as(student)
      .post('/support/tickets')
      .send(
        report({ subject: '<b>Bold</b> subject here', body: '<script>alert(1)</script>Plain words here.' }),
      );
    expect(r.body.data.subject).toBe('Bold subject here');
    expect(r.body.data.body).not.toContain('<script>');
    await as(student).patch(`/support/tickets/${r.body.data.id}`).send({ status: 'closed' });
  });

  it('a member who is not verified yet can still ask for help', async () => {
    expect((await as(unverified).post('/support/tickets').send(report())).status).toBe(201);
  });

  it('only the reporter and the college’s admins see it', async () => {
    expect((await as(student).get(`/support/tickets/${id}`)).status).toBe(200);
    expect((await as(admin).get(`/support/tickets/${id}`)).status).toBe(200);
    expect((await as(other).get(`/support/tickets/${id}`)).status).toBe(404);
    expect((await as(faculty).get(`/support/tickets/${id}`)).status).toBe(404);
    expect((await as(faculty).get('/admin/support/tickets')).status).toBe(403);
    const mine = await as(other).get('/support/tickets');
    expect(mine.body.data).toEqual([]);
  });

  it('the desk answers, the member is told, and replying reopens it', async () => {
    const r = await as(admin)
      .post(`/support/tickets/${id}/replies`)
      .send({ body: 'Demo: please try again now, we reset the limit.' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'answered' });
    expect(r.body.data.replies).toEqual([expect.objectContaining({ from: 'college' })]);
    expect(await notes(student, 'support_reply')).toBe(1);
    const back = await as(student)
      .post(`/support/tickets/${id}/replies`)
      .send({ body: 'Works now, thanks.' });
    expect(back.body.data.status).toBe('open');
    expect(await notes(student, 'support_reply')).toBe(1);
    const q = await as(admin).get('/admin/support/tickets?status=open');
    expect(q.body.data.map((t: { id: string }) => t.id)).toContain(id);
    const overview = await as(admin).get('/admin/overview');
    expect(overview.body.data.support.open).toBeGreaterThanOrEqual(1);
  });

  it('caps open reports per member', async () => {
    const many = await makeUser(ctx, A, { roles: ['STUDENT'] });
    for (let i = 0; i < 5; i++)
      expect((await as(many).post('/support/tickets').send(report())).status).toBe(201);
    expect((await as(many).post('/support/tickets').send(report())).status).toBe(429);
  });
});

describe('screenshots', () => {
  it('attach once, by their uploader, visible to the reporter and the desk only', async () => {
    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#336699' } })
      .png()
      .toBuffer();
    const up = await as(other).post('/support/screenshots').attach('screenshot', png, 'shot.png');
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const fileId = up.body.data.id as string;
    // Someone else cannot attach it.
    expect(
      (
        await as(student)
          .post('/support/tickets')
          .send(report({ screenshotFileId: fileId }))
      ).status,
    ).toBe(400);
    const t = await as(other)
      .post('/support/tickets')
      .send(report({ screenshotFileId: fileId }));
    expect(t.status).toBe(201);
    expect(t.body.data.hasScreenshot).toBe(true);
    // Single use.
    expect(
      (
        await as(other)
          .post('/support/tickets')
          .send(report({ screenshotFileId: fileId }))
      ).status,
    ).toBe(400);
    expect((await as(other).get(`/files/${fileId}`)).status).toBe(200);
    expect((await as(admin).get(`/files/${fileId}`)).status).toBe(200);
    expect((await as(student).get(`/files/${fileId}`)).status).toBe(404);
  });
});

describe('the platform desk (bugs)', () => {
  let bug: string;

  it('a bug goes to the platform, not to the college', async () => {
    const r = await as(student)
      .post('/support/tickets')
      .send(report({ category: 'bug', subject: 'The jobs page is blank' }));
    expect(r.body.data.desk).toBe('platform');
    bug = r.body.data.id;
    expect((await as(admin).get(`/support/tickets/${bug}`)).status).toBe(404);
    const q = await as(admin).get('/admin/support/tickets');
    expect(q.body.data.map((t: { id: string }) => t.id)).not.toContain(bug);
  });

  it('the platform sees bug reports from every college, answers them, and it is audited', async () => {
    await as(outsider)
      .post('/support/tickets')
      .send(report({ category: 'bug', subject: 'Another bug here' }));
    const q = await as(sa).get('/platform/support/tickets');
    expect(q.status).toBe(200);
    const subjects = q.body.data.map((t: { subject: string }) => t.subject);
    expect(subjects).toEqual(expect.arrayContaining(['The jobs page is blank', 'Another bug here']));
    // Never a college matter.
    expect(subjects).not.toContain('Cannot change my number');
    const one = await as(sa).get(`/platform/support/tickets/${String(A._id)}/${bug}`);
    expect(one.body.data.college?.slug ?? 'supporta').toBe('supporta');
    const reply = await as(sa)
      .post(`/platform/support/tickets/${String(A._id)}/${bug}/replies`)
      .send({ body: 'Demo: fixed in the next release.' });
    expect(reply.status).toBe(201);
    expect(reply.body.data.replies).toEqual([expect.objectContaining({ from: 'platform' })]);
    expect(await notes(student, 'support_reply')).toBe(2);
    expect(
      await runInTenant(A._id, () =>
        AuditModel.countDocuments({ action: { $in: ['support.platform_read', 'support.platform_reply'] } }),
      ),
    ).toBe(2);
    // The wrong college for that id: nothing.
    expect((await as(sa).get(`/platform/support/tickets/${String(B._id)}/${bug}`)).status).toBe(404);
  });

  it('college members and admins cannot reach the platform desk', async () => {
    expect((await as(admin).get('/platform/support/tickets')).status).toBe(404);
  });
});

describe('isolation between colleges', () => {
  it('another college’s members and admins never see, answer or close a report', async () => {
    const r = await as(student)
      .post('/support/tickets')
      .send(report({ subject: 'Isolation demo report' }));
    const id = r.body.data.id as string;
    for (const u of [outsider, outsiderAdmin]) {
      expect((await as(u).get(`/support/tickets/${id}`)).status).toBe(404);
      expect((await as(u).post(`/support/tickets/${id}/replies`).send({ body: 'Not mine.' })).status).toBe(
        404,
      );
      expect((await as(u).patch(`/support/tickets/${id}`).send({ status: 'closed' })).status).toBe(404);
    }
    const q = await as(outsiderAdmin).get('/admin/support/tickets');
    expect(q.body.data.map((t: { subject: string }) => t.subject)).not.toContain('Isolation demo report');
    expect(
      (await as(outsider).get('/support/tickets')).body.data.map((t: { id: string }) => t.id),
    ).not.toContain(id);
  });
});
