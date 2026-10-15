import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import {
  api,
  jpegWithExif,
  makeTenant,
  makeUser,
  testApp,
  type TestTenant,
  type TestUser,
} from './helpers.js';
import { acceptedSession, makeMentor, sendRequest } from './mentorship-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { MessageModel } from '../src/modules/messaging/conversation.model.js';

const ctx = testApp();
let T: TestTenant;
let mentor: TestUser, mentee: TestUser, outsider: TestUser, moderator: TestUser;
let convId: string;
const as = (u: TestUser) => api(ctx, T.host, u.token);

async function pdfWithSecrets(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  page.drawText('Resume of a fictional student', { x: 20, y: 150, size: 12 });
  doc.setTitle('SECRET-PDF-TITLE');
  doc.setAuthor('Secret Author Name');
  const js = doc.context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of('app.alert("pwned")') });
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.register(js));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

beforeAll(async () => {
  T = await makeTenant('msgalpha');
  mentor = await makeMentor(ctx, T);
  mentee = await makeUser(ctx, T, { roles: ['STUDENT'] });
  outsider = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  moderator = await makeUser(ctx, T, { roles: ['FACULTY'] });
  convId = (await acceptedSession(ctx, T, mentee, mentor, 'quick_chat')).conversationId;
});

describe('conversations', () => {
  it('exist only between accepted pairs and are invisible to everyone else', async () => {
    expect((await as(outsider).get('/conversations')).body.data).toEqual([]);
    expect((await as(outsider).get(`/conversations/${convId}`)).status).toBe(404);
    expect((await as(outsider).get(`/conversations/${convId}/messages`)).status).toBe(404);
    expect((await as(outsider).post(`/conversations/${convId}/messages`).send({ body: 'hi' })).status).toBe(
      404,
    );
    // A college admin is not a participant either.
    const admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
    expect((await as(admin).get(`/conversations/${convId}/messages`)).status).toBe(404);
    // Unverified members cannot message at all.
    const pending = await makeUser(ctx, T, { roles: ['STUDENT'], verified: false });
    expect((await as(pending).get('/conversations')).status).toBe(403);
  });

  it('sends, pages, stores encrypted and tracks read receipts and unread counts', async () => {
    for (let i = 1; i <= 3; i++)
      expect(
        (
          await as(mentee)
            .post(`/conversations/${convId}/messages`)
            .send({ body: `Question ${i}` })
        ).status,
      ).toBe(201);
    const stored = await runInTenant(T._id, () => MessageModel.findOne({ conversationId: convId }).lean());
    expect(stored?.bodyEnc).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain('Question 1');
    expect((await as(mentor).get('/conversations/unread')).body.data.total).toBe(3);
    const page = await as(mentor).get(`/conversations/${convId}/messages?limit=2`);
    expect(page.body.data.map((m: { body: string }) => m.body)).toEqual(['Question 2', 'Question 3']);
    const older = await as(mentor).get(
      `/conversations/${convId}/messages?limit=2&before=${page.body.meta.nextCursor}`,
    );
    expect(older.body.data.map((m: { body: string }) => m.body)).toEqual(['Question 1']);
    const lastId = page.body.data[1].id;
    expect((await as(mentor).post(`/conversations/${convId}/read`).send({ messageId: lastId })).status).toBe(
      200,
    );
    expect((await as(mentor).get('/conversations/unread')).body.data.total).toBe(0);
    const menteeView = (await as(mentee).get(`/conversations/${convId}`)).body.data;
    expect(menteeView.otherReadAt).toBeTruthy();
    expect((await as(mentee).post(`/conversations/${convId}/messages`).send({ body: '   ' })).status).toBe(
      400,
    );
    expect(
      (
        await as(mentee)
          .post(`/conversations/${convId}/messages`)
          .send({ body: 'x'.repeat(2001) })
      ).status,
    ).toBe(400);
  });

  it('accepts images (metadata stripped) and PDFs (scripts and metadata removed), refuses other files', async () => {
    const img = await as(mentee)
      .post(`/conversations/${convId}/attachments`)
      .attach('file', await jpegWithExif(), 'photo.jpg');
    expect(img.status).toBe(201);
    expect(img.body.data.attachment).toMatchObject({ mime: 'image/webp', name: 'photo.webp' });
    const pdf = await as(mentee)
      .post(`/conversations/${convId}/attachments`)
      .field('body', 'My resume for the review')
      .attach('file', await pdfWithSecrets(), '../../etc/My "Resume".pdf');
    expect(pdf.status).toBe(201);
    expect(pdf.body.data.body).toBe('My resume for the review');
    expect(pdf.body.data.attachment.name).toBe('My _Resume_.pdf');
    const dl = await as(mentor).get(`/files/${pdf.body.data.attachment.fileId}`).buffer(true);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['content-security-policy']).toContain('sandbox');
    const bytes = Buffer.from(dl.body as Buffer).toString('latin1');
    expect(bytes.startsWith('%PDF-')).toBe(true);
    expect(bytes).not.toContain('SECRET-PDF-TITLE');
    expect(bytes).not.toContain('Secret Author');
    expect(bytes).not.toContain('JavaScript');
    expect(bytes).not.toContain('OpenAction');
    const clean = await PDFDocument.load(dl.body as Buffer);
    expect(clean.getPageCount()).toBe(1);
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
    expect(
      (await as(mentee).post(`/conversations/${convId}/attachments`).attach('file', exe, 'cv.pdf')).status,
    ).toBe(415);
    expect(
      (
        await as(mentee)
          .post(`/conversations/${convId}/attachments`)
          .attach('file', Buffer.from('%PDF-1.7 garbage'), 'x.pdf')
      ).status,
    ).toBe(415);
    // Attachments are for participants only.
    expect((await as(outsider).get(`/files/${pdf.body.data.attachment.fileId}`)).status).toBe(404);
  });
});

describe('safety', () => {
  it('reports a received message with a snapshot that moderators see (without the conversation)', async () => {
    const sent = await as(mentor)
      .post(`/conversations/${convId}/messages`)
      .send({ body: 'Rude message for the report test' });
    expect(
      (
        await as(mentor)
          .post('/reports')
          .send({ targetType: 'message', targetId: sent.body.data.id, reason: 'harassment' })
      ).status,
    ).toBe(404);
    expect(
      (
        await as(outsider)
          .post('/reports')
          .send({ targetType: 'message', targetId: sent.body.data.id, reason: 'harassment' })
      ).status,
    ).toBe(404);
    const rep = await as(mentee)
      .post('/reports')
      .send({ targetType: 'message', targetId: sent.body.data.id, reason: 'harassment', note: 'Unkind' });
    expect(rep.status).toBe(201);
    expect(
      (
        await as(mentee)
          .post('/reports')
          .send({ targetType: 'message', targetId: sent.body.data.id, reason: 'spam' })
      ).status,
    ).toBe(409);
    const queue = await as(moderator).get('/admin/reports');
    expect(queue.status).toBe(200);
    expect(queue.body.data[0]).toMatchObject({
      targetType: 'message',
      snapshot: 'Rude message for the report test',
      subject: { userId: mentor.id },
    });
    expect((await as(mentee).get('/admin/reports')).status).toBe(403);
    const resolved = await as(moderator)
      .post(`/admin/reports/${rep.body.data.id}/resolve`)
      .send({ outcome: 'dismissed' });
    expect(resolved.body.data).toMatchObject({ status: 'resolved', outcome: 'dismissed' });
    expect(
      (await as(moderator).post(`/admin/reports/${rep.body.data.id}/resolve`).send({ outcome: 'dismissed' }))
        .status,
    ).toBe(404);
  });

  it('reports people and requests', async () => {
    expect(
      (await as(mentee).post('/reports').send({ targetType: 'user', targetId: mentee.id, reason: 'spam' }))
        .status,
    ).toBe(404);
    expect(
      (
        await as(mentee)
          .post('/reports')
          .send({ targetType: 'user', targetId: outsider.id, reason: 'impersonation' })
      ).status,
    ).toBe(201);
    const m2 = await makeMentor(ctx, T);
    const s2 = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const r = await sendRequest(ctx, T, s2, m2, 'quick_chat');
    const rep = await as(m2)
      .post('/reports')
      .send({ targetType: 'request', targetId: r.body.data.id, reason: 'spam' });
    expect(rep.status).toBe(201);
    const queue = (await as(moderator).get('/admin/reports')).body.data;
    expect(queue.find((x: { id: string }) => x.id === rep.body.data.id).snapshot).toMatch(/^Goal: /);
  });

  it('blocking closes the chat, withdraws requests, cancels sessions and hides the mentor', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const session = await acceptedSession(ctx, T, s, m, 'video_1on1');
    const pending = await sendRequest(ctx, T, s, m, 'quick_chat');
    expect(pending.status).toBe(201);
    expect((await as(s).post('/me/blocks').send({ userId: m.id })).status).toBe(200);
    expect((await as(s).post('/me/blocks').send({ userId: s.id })).status).toBe(400);
    expect(
      (await as(m).post(`/conversations/${session.conversationId}/messages`).send({ body: 'hello?' })).status,
    ).toBe(409);
    expect((await as(s).get(`/mentorship/requests/${pending.body.data.id}`)).body.data.status).toBe(
      'withdrawn',
    );
    expect((await as(m).get(`/bookings/${session.bookingId}`)).body.data.status).toBe('cancelled');
    expect((await as(s).get('/mentors')).body.data.some((c: { userId: string }) => c.userId === m.id)).toBe(
      false,
    );
    expect((await as(s).get(`/mentors/${m.id}`)).status).toBe(404);
    expect((await sendRequest(ctx, T, s, m, 'quick_chat')).status).toBe(404);
    // The blocked mentor cannot see or contact the student either (both directions).
    expect((await as(s).get('/me/blocks')).body.data[0].user.userId).toBe(m.id);
    expect((await as(s).delete(`/me/blocks/${m.id}`)).status).toBe(200);
    expect(
      (await as(m).post(`/conversations/${session.conversationId}/messages`).send({ body: 'hello again' }))
        .status,
    ).toBe(201);
  });
});
