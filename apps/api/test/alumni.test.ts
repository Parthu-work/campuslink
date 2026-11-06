import { beforeAll, describe, expect, it } from 'vitest';
import { crc32, deflateRawSync } from 'node:zlib';
import { Types } from 'mongoose';
import {
  MICRO_ASKS_PER_WEEK,
  academicYearOf,
  type CertificateView,
  type EventView,
  type FundView,
  type LinkedinPreview,
  type MicroAskInbox,
  type MicroAskView,
  type PledgeView,
} from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { companyKey } from '../src/lib/company.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { XpEventModel } from '../src/modules/gamification/gamification.model.js';
import { EventModel } from '../src/modules/events/event.model.js';
import { BookingModel } from '../src/modules/sessions/booking.model.js';
import { ResumeModel } from '../src/modules/resumes/resume.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { PostModel } from '../src/modules/feed/post.model.js';
import {
  MentorCertificateModel,
  MicroAskModel,
  MicroAskOfferModel,
  PledgeModel,
} from '../src/modules/alumni/alumni.model.js';
import type { MicroAsksService } from '../src/modules/alumni/micro-asks.service.js';
import type { GivingService } from '../src/modules/alumni/giving.service.js';
import type { RecognitionService } from '../src/modules/alumni/recognition.service.js';
import { MICRO_ASK_EXPIRE_JOB } from '../src/modules/alumni/micro-asks.service.js';
import { OFFICE_HOURS_NEXT_JOB } from '../src/modules/events/events.service.js';
import { readZipEntries } from '../src/modules/alumni/linkedin.js';

/**
 * Prompt 2, G6: micro-asks (routing, the weekly cap, hand-overs, XP), weekly office hours and
 * following them, certificates and their public check, the alumnus of the month, giving (pledge
 * statuses, receipt numbers, acknowledgements), LinkedIn import (and the ZIP bomb guard), batch
 * pages and privacy.
 */

const ctx = testApp();
const services = ctx.services as unknown as {
  microAsks: MicroAsksService;
  giving: GivingService;
  recognition: RecognitionService;
};
let T: TestTenant;
let student: TestUser, student2: TestUser, tpo: TestUser, faculty: TestUser;
let nimbusA: TestUser, nimbusB: TestUser, other: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);
const inT = <R>(fn: () => Promise<R>) => runInTenant(T._id, fn);
const DAY = 86_400_000;

async function profile(u: TestUser, set: Record<string, unknown>) {
  await inT(() =>
    ProfileModel.updateOne(
      { userId: u.id },
      {
        $set: { ...set, ...(typeof set.company === 'string' ? { companyKey: companyKey(set.company) } : {}) },
      },
    ),
  );
}

/** A ZIP with the given files (deflated), as LinkedIn's export is. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const n = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc32(raw), 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    central.push(cd, n);
    offset += 30 + n.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

beforeAll(async () => {
  T = await makeTenant('alumnitest');
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  student2 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  nimbusA = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  nimbusB = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  other = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  await profile(student, { name: 'Asha Student', branch: 'CSE', gradYear: 2027 });
  await profile(student2, { name: 'Bala Student', branch: 'CSE', gradYear: 2027 });
  await profile(nimbusA, {
    name: 'Nimbus Alpha',
    company: 'Nimbus Labs (demo)',
    branch: 'CSE',
    gradYear: 2018,
  });
  await profile(nimbusB, {
    name: 'Nimbus Beta',
    company: 'Nimbus Labs (demo)',
    branch: 'ECE',
    gradYear: 2019,
  });
  await profile(other, { name: 'Other Alumna', company: 'Elsewhere (demo)', branch: 'MECH', gradYear: 2015 });
  for (const u of [student, nimbusA])
    await as(u).post('/me/consents').send({ purpose: 'analytics_aggregate', granted: true }).expect(200);
});

const ask = (u: TestUser, body: Record<string, unknown>) => as(u).post('/micro-asks').send(body);
const intro = {
  kind: 'quick_intro',
  audience: { company: 'Nimbus Labs (demo)' },
  note: 'Could you introduce me to the hiring team?',
};

describe('micro-asks', () => {
  let first: MicroAskView;
  it('routes to an alumnus at the company asked for, once, and tells them (never the note)', async () => {
    const r = await ask(student, intro);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    first = r.body.data as MicroAskView;
    expect(first.status).toBe('assigned');
    const ask1 = await inT(() => MicroAskModel.findById(first.id).lean());
    expect([String(nimbusA.id), String(nimbusB.id)]).toContain(String(ask1?.toUserId));
    const helper = String(ask1?.toUserId);
    const n = await inT(() =>
      NotificationModel.findOne({ userId: helper, type: 'micro_ask_received' }).lean(),
    );
    expect(n?.data).toMatchObject({ name: 'Asha', kind: 'quick_intro', askId: first.id });
    expect(JSON.stringify(n?.data)).not.toContain('hiring team');
    // The asker does not see who has it until they say yes.
    expect(first.helper).toBeNull();
    expect((await as(other).get(`/micro-asks/${first.id}`)).status).toBe(404);
  });

  it('a pass hands it on; silence hands it on; a third try is unmatched', async () => {
    const before = await inT(() => MicroAskModel.findById(first.id).lean());
    const firstHelper = [nimbusA, nimbusB].find((u) => u.id === String(before?.toUserId)) as TestUser;
    const pass = await as(firstHelper).post(`/micro-asks/${first.id}/reply`).send({ action: 'decline' });
    expect(pass.status, JSON.stringify(pass.body)).toBe(200);
    const after = await inT(() => MicroAskModel.findById(first.id).lean());
    const second = [nimbusA, nimbusB].find((u) => u.id === String(after?.toUserId)) as TestUser;
    expect(second.id).not.toBe(firstHelper.id);
    expect(after?.status).toBe('assigned');
    // The second alumnus says nothing: after the reply window, it moves on; nobody else matches.
    await ctx.queue.runDelayed({ name: MICRO_ASK_EXPIRE_JOB });
    const done = await inT(() => MicroAskModel.findById(first.id).lean());
    expect(done?.status).toBe('unmatched');
    expect(
      await inT(() => NotificationModel.countDocuments({ userId: student.id, type: 'micro_ask_unmatched' })),
    ).toBe(1);
  });

  it('caps an alumnus at two hand-overs in a rolling week', async () => {
    // Each Nimbus alumnus already had one hand-over above; one more each reaches the cap.
    const a = await ask(student2, intro);
    const b = await ask(student2, intro);
    expect([a.status, b.status]).toEqual([201, 201]);
    const counts = await inT(async () =>
      Promise.all([nimbusA, nimbusB].map((u) => MicroAskOfferModel.countDocuments({ userId: u.id }))),
    );
    expect(counts).toEqual([MICRO_ASKS_PER_WEEK, MICRO_ASKS_PER_WEEK]);
    // Both are full: the next ask for Nimbus finds nobody.
    const c = await ask(student2, intro);
    expect(c.body.data.status).toBe('unmatched');
    const inbox = (await as(nimbusA).get('/micro-asks/received')).body.data as MicroAskInbox;
    expect(inbox.week).toEqual({ received: MICRO_ASKS_PER_WEEK, cap: MICRO_ASKS_PER_WEEK });
  });

  it('an asker has at most three open; staff and alumni-only permissions hold', async () => {
    const open = await inT(() =>
      MicroAskModel.countDocuments({
        fromUserId: student2.id,
        status: { $in: ['assigned', 'accepted', 'routing'] },
      }),
    );
    expect(open).toBe(2);
    const anyone = {
      kind: 'feedback_on_project',
      audience: {},
      note: 'Feedback on my final-year project, please.',
    };
    expect((await ask(student2, anyone)).status).toBe(201);
    expect((await ask(student2, anyone)).status).toBe(429);
    expect((await ask(faculty, anyone)).status).toBe(403);
    expect((await as(student).get('/micro-asks/received')).status).toBe(403);
    // A résumé review needs the asker's own résumé.
    const theirs = await inT(() =>
      ResumeModel.create({ userId: student2.id, title: 'Theirs', content: { basics: {} } }),
    );
    expect(
      (
        await ask(student, {
          kind: 'review_resume',
          resumeId: String(theirs._id),
          note: 'Please review my résumé.',
        })
      ).status,
    ).toBe(404);
  });

  it('doing it earns impact points once and tells the asker; a résumé helper may read the résumé', async () => {
    const mine = await inT(() =>
      ResumeModel.create({ userId: student.id, title: 'Core IT', content: { basics: {} } }),
    );
    const r = await ask(student, {
      kind: 'review_resume',
      audience: { company: 'Elsewhere (demo)' },
      resumeId: String(mine._id),
      note: 'Please review my résumé for analyst roles.',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.data.id as string;
    expect((await inT(() => MicroAskModel.findById(id).lean()))?.toUserId?.toString()).toBe(other.id);
    expect((await as(other).get(`/resumes/${String(mine._id)}`)).status).toBe(200);
    expect((await as(nimbusA).get(`/resumes/${String(mine._id)}`)).status).toBe(404);
    expect(
      (await as(other).post(`/micro-asks/${id}/reply`).send({ action: 'accept' })).body.data.status,
    ).toBe('accepted');
    expect((await as(student).get(`/micro-asks/${id}`)).body.data.helper.name).toBe('Other Alumna');
    const done = await as(other).post(`/micro-asks/${id}/reply`).send({ action: 'done' });
    expect(done.body.data.status).toBe('done');
    expect((await as(other).post(`/micro-asks/${id}/reply`).send({ action: 'done' })).status).toBe(409);
    expect(await inT(() => XpEventModel.countDocuments({ userId: other.id, kind: 'micro_ask_done' }))).toBe(
      1,
    );
    expect(
      await inT(() => NotificationModel.countDocuments({ userId: student.id, type: 'micro_ask_done' })),
    ).toBe(1);
    // Only the alumnus it is with may answer it.
    expect((await as(nimbusA).post(`/micro-asks/${id}/reply`).send({ action: 'done' })).status).toBe(404);
  });

  it('an alumnus who turned asks off is never asked', async () => {
    expect((await as(other).put('/me/micro-asks/settings').send({ open: false })).body.data).toEqual({
      open: false,
    });
    const r = await ask(student, {
      kind: 'quick_intro',
      audience: { company: 'Elsewhere (demo)' },
      note: 'An intro to your team, please.',
    });
    expect(r.body.data.status).toBe('unmatched');
    await as(other).put('/me/micro-asks/settings').send({ open: true });
  });
});

describe('weekly office hours', () => {
  let ev: EventView;
  it('repeat weekly until a date, made as each one ends; followers hear of each', async () => {
    expect(
      (await as(student).put(`/members/${nimbusA.id}/office-hours/subscription`).send({ on: true })).status,
    ).toBe(400);
    const start = new Date(Date.now() + 2 * DAY);
    const body = {
      title: 'Backend careers office hours (demo)',
      description: 'Bring your questions about backend roles.',
      kind: 'office_hours',
      mode: 'online',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 3600_000).toISOString(),
      onlineUrl: 'https://meet.example.com/demo-office-hours',
      recurrence: { weekly: true, until: new Date(start.getTime() + 15 * DAY).toISOString() },
    };
    expect(
      (
        await as(nimbusA)
          .post('/events')
          .send({ ...body, kind: 'ama' })
      ).status,
    ).toBe(400);
    const r = await as(nimbusA).post('/events').send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    ev = r.body.data as EventView;
    expect(ev.recurrence?.weekly).toBe(true);
    const sub = await as(student).put(`/members/${nimbusA.id}/office-hours/subscription`).send({ on: true });
    expect(sub.body.data.map((s: { host: { userId: string } }) => s.host.userId)).toEqual([nimbusA.id]);
    expect(
      (await as(student).put(`/members/${student.id}/office-hours/subscription`).send({ on: true })).status,
    ).toBe(400);

    await ctx.queue.runDelayed({ name: OFFICE_HOURS_NEXT_JOB });
    const series = await inT(() => EventModel.find({ seriesId: ev.id }).sort({ startsAt: 1 }).lean());
    expect(series.map((e) => e.startsAt.getTime() - start.getTime())).toEqual([0, 7 * DAY]);
    expect(
      await inT(() =>
        NotificationModel.countDocuments({ userId: student.id, type: 'office_hours_scheduled' }),
      ),
    ).toBe(1);
    // A second run of the same job makes nothing new.
    await inT(() =>
      ctx.queue.enqueue(OFFICE_HOURS_NEXT_JOB, {
        tenantId: String(T._id),
        eventId: ev.id,
        endsAt: new Date(start.getTime() + 3600_000).toISOString(),
      }),
    );
    await ctx.queue.drain();
    expect(await inT(() => EventModel.countDocuments({ seriesId: ev.id }))).toBe(2);
    // The third week, then nothing past `until` (15 days).
    await ctx.queue.runDelayed({ name: OFFICE_HOURS_NEXT_JOB });
    await ctx.queue.runDelayed({ name: OFFICE_HOURS_NEXT_JOB });
    expect(await inT(() => EventModel.countDocuments({ seriesId: ev.id }))).toBe(3);
    expect(
      (await as(student).put(`/members/${nimbusA.id}/office-hours/subscription`).send({ on: false })).body
        .data,
    ).toEqual([]);
  });
});

describe('certificates', () => {
  let cert: CertificateView;
  it('need something to certify; render in a job; verify publicly; revoke', async () => {
    const ay = academicYearOf(new Date());
    expect((await as(nimbusB).post('/me/certificates').send({ academicYear: ay })).status).toBe(400);
    await inT(() =>
      BookingModel.create({
        requestId: new Types.ObjectId(),
        mentorId: nimbusB.id,
        menteeId: student.id,
        participants: [nimbusB.id, student.id],
        sessionType: 'quick_chat',
        start: new Date(Date.now() - 2 * 3600_000),
        end: new Date(Date.now() - 3600_000),
        status: 'completed',
        holds: [`${nimbusB.id}|cert`],
        room: 'cert-room',
        completedAt: new Date(Date.now() - 3600_000),
      }),
    );
    const years = (await as(nimbusB).get('/me/certificates')).body.data.years;
    expect(years[0]).toMatchObject({
      academicYear: ay,
      sessions: 1,
      mentees: 1,
      eligible: true,
      certificateId: null,
    });
    const r = await as(nimbusB).post('/me/certificates').send({ academicYear: ay });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    cert = r.body.data as CertificateView;
    expect(cert.code).toMatch(/^[a-f0-9]{32}$/);
    await ctx.queue.drain();
    const issued = await inT(() => MentorCertificateModel.findById(cert.id).lean());
    expect(issued?.status).toBe('issued');
    const file = await as(nimbusB).get(`/me/certificates/${cert.id}/pdf`).buffer(true);
    expect(file.status).toBe(200);
    expect((file.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await as(nimbusA).get(`/me/certificates/${cert.id}/pdf`)).status).toBe(404);
    expect(
      await inT(() => NotificationModel.countDocuments({ userId: nimbusB.id, type: 'certificate_ready' })),
    ).toBe(1);

    const check = await api(ctx, T.host).get(`/verify/certificates/${cert.code}`);
    expect(check.status).toBe(200);
    expect(check.body.data).toMatchObject({
      valid: true,
      name: 'Nimbus Beta',
      academicYear: ay,
      sessions: 1,
    });
    expect((await api(ctx, T.host).get(`/verify/certificates/${'0'.repeat(32)}`)).status).toBe(404);
    expect((await api(ctx, T.host).get('/verify/certificates/not-a-code')).status).toBe(400);
    // A second issue for the year keeps the code.
    const again = await as(nimbusB).post('/me/certificates').send({ academicYear: ay });
    expect(again.body.data.code).toBe(cert.code);
    await ctx.queue.drain();

    expect((await as(faculty).post(`/admin/recognition/certificates/${cert.id}/revoke`)).status).toBe(403);
    expect((await as(tpo).post(`/admin/recognition/certificates/${cert.id}/revoke`)).status).toBe(200);
    expect((await api(ctx, T.host).get(`/verify/certificates/${cert.code}`)).body.data).toMatchObject({
      valid: false,
      status: 'revoked',
    });
    expect((await as(nimbusB).post('/me/certificates').send({ academicYear: ay })).status).toBe(409);
    expect(await inT(() => AuditModel.countDocuments({ action: 'alumni.certificate_revoked' }))).toBe(1);
  });
});

describe('alumnus of the month', () => {
  it('is nominated, accepts, shows on the Wall, and the TPO announces it once', async () => {
    const month = '2026-10';
    const body = {
      userId: nimbusA.id,
      month,
      citation: 'Did twelve résumé reviews for final-years this month.',
    };
    expect(
      (
        await as(tpo)
          .post('/admin/recognition/of-the-month')
          .send({ ...body, userId: student.id })
      ).status,
    ).toBe(400);
    expect((await as(faculty).post('/admin/recognition/of-the-month').send(body)).status).toBe(403);
    const n = await as(tpo).post('/admin/recognition/of-the-month').send(body);
    expect(n.status, JSON.stringify(n.body)).toBe(201);
    expect(
      (
        await as(tpo)
          .post('/admin/recognition/of-the-month')
          .send({ ...body, userId: nimbusB.id })
      ).status,
    ).toBe(409);
    // Nothing shows until they accept, and it cannot be announced before.
    expect((await as(student).get('/alumni/of-the-month')).body.data).toEqual([]);
    expect(
      (
        await as(tpo)
          .post(`/admin/recognition/of-the-month/${n.body.data.id}/announce`)
          .send({ body: 'Our alumnus of the month!' })
      ).status,
    ).toBe(409);
    expect(
      (await as(nimbusB).post(`/me/alumni-of-the-month/${n.body.data.id}`).send({ accept: true })).status,
    ).toBe(404);
    expect(
      (await as(nimbusA).post(`/me/alumni-of-the-month/${n.body.data.id}`).send({ accept: true })).body.data
        .status,
    ).toBe('published');
    const wall = (await as(student).get('/alumni/of-the-month')).body.data;
    expect(wall).toEqual([
      expect.objectContaining({ month, person: expect.objectContaining({ name: 'Nimbus Alpha' }) }),
    ]);
    const a = await as(tpo)
      .post(`/admin/recognition/of-the-month/${n.body.data.id}/announce`)
      .send({ body: 'Nimbus Alpha is our alumnus of the month: twelve résumé reviews!' });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(
      await inT(() => PostModel.countDocuments({ announcement: true, body: /alumnus of the month/ })),
    ).toBe(1);
    expect(
      (
        await as(tpo)
          .post(`/admin/recognition/of-the-month/${n.body.data.id}/announce`)
          .send({ body: 'Again, our alumnus of the month' })
      ).status,
    ).toBe(409);
  });

  it('a declined nomination frees the month', async () => {
    const body = { userId: nimbusB.id, month: '2026-11', citation: 'Hosted weekly office hours all month.' };
    const n = await as(tpo).post('/admin/recognition/of-the-month').send(body);
    await as(nimbusB).post(`/me/alumni-of-the-month/${n.body.data.id}`).send({ accept: false });
    expect(
      (
        await as(tpo)
          .post('/admin/recognition/of-the-month')
          .send({ ...body, userId: other.id })
      ).status,
    ).toBe(201);
  });
});

describe('giving', () => {
  let fund: FundView;
  let pledge: PledgeView;
  it('the college publishes a fund; alumni pledge; students cannot', async () => {
    const f = await as(tpo).post('/admin/giving/funds').send({
      title: 'Scholarships 2026 (demo)',
      purpose: 'scholarship',
      description: 'Fee support for final-year students who need it.',
      targetPaise: 50_000_00,
      payLink: 'https://rzp.io/l/demo-college-fund',
      bankDetails: 'Demo College, A/c 000000 (demo), IFSC DEMO0000000',
    });
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    fund = f.body.data as FundView;
    expect((await as(student).get('/giving/funds')).status).toBe(403);
    expect(
      (await as(student).post('/giving/pledges').send({ fundId: fund.id, amountPaise: 100_00 })).status,
    ).toBe(403);
    const p = await as(nimbusA).post('/giving/pledges').send({ fundId: fund.id, amountPaise: 5_000_00 });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    pledge = p.body.data as PledgeView;
    expect(pledge.status).toBe('pledged');
    expect((await as(nimbusA).get('/giving/funds')).body.data[0]).toMatchObject({
      pledgedPaise: 5_000_00,
      receivedPaise: 0,
    });
  });

  it('statuses: paid → received once (numbered), never cancelled after; acknowledgement PDF', async () => {
    expect(
      (await as(nimbusB).post(`/me/pledges/${pledge.id}/paid`).send({ reference: 'UTR123' })).status,
    ).toBe(404);
    expect(
      (await as(nimbusA).post(`/me/pledges/${pledge.id}/paid`).send({ reference: 'UTR-DEMO-1' })).body.data
        .status,
    ).toBe('paid');
    const receive = { amountPaise: 5_000_00, receivedOn: '2026-11-02', reference: 'Bank statement line 4' };
    expect((await as(faculty).post(`/admin/giving/pledges/${pledge.id}/receive`).send(receive)).status).toBe(
      403,
    );
    const r = await as(tpo).post(`/admin/giving/pledges/${pledge.id}/receive`).send(receive);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'received', receiptNo: 'ACK/2026-27/0001' });
    expect((await as(tpo).post(`/admin/giving/pledges/${pledge.id}/receive`).send(receive)).status).toBe(409);
    expect((await as(nimbusA).post(`/me/pledges/${pledge.id}/cancel`)).status).toBe(409);
    await ctx.queue.drain();
    const ack = await as(nimbusA).get(`/me/pledges/${pledge.id}/acknowledgement`).buffer(true);
    expect(ack.status).toBe(200);
    expect((ack.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      await inT(() => NotificationModel.countDocuments({ userId: nimbusA.id, type: 'pledge_received' })),
    ).toBe(1);
    expect((await as(nimbusA).get('/giving/funds')).body.data[0]).toMatchObject({
      receivedPaise: 5_000_00,
      pledgedPaise: 0,
      donors: '<5',
    });
    expect(await inT(() => AuditModel.countDocuments({ action: 'giving.received' }))).toBe(1);
  });

  it('a registered college issues tax receipts with their own numbers; a cancelled pledge is not received', async () => {
    await as(tpo)
      .put('/admin/giving/settings')
      .send({ taxReceipts: true, registration: '80G demo registration', signatory: 'Demo Principal' });
    const p = (await as(nimbusB).post('/giving/pledges').send({ fundId: fund.id, amountPaise: 1_000_00 }))
      .body.data as PledgeView;
    const r = await as(tpo)
      .post(`/admin/giving/pledges/${p.id}/receive`)
      .send({ amountPaise: 1_000_00, receivedOn: '2026-11-03' });
    expect(r.body.data.receiptNo).toBe('RCPT/2026-27/0002');
    const c = (await as(other).post('/giving/pledges').send({ fundId: fund.id, amountPaise: 500_00 })).body
      .data as PledgeView;
    expect((await as(other).post(`/me/pledges/${c.id}/cancel`)).body.data.status).toBe('cancelled');
    expect(
      (
        await as(tpo)
          .post(`/admin/giving/pledges/${c.id}/receive`)
          .send({ amountPaise: 500_00, receivedOn: '2026-11-03' })
      ).status,
    ).toBe(409);
    const naac = await inT(() =>
      services.giving.receivedBetween(new Date('2026-06-01'), new Date('2027-06-01')),
    );
    expect(naac.reduce((n, x) => n + x.amountPaise, 0)).toBe(6_000_00);
  });
});

describe('LinkedIn import', () => {
  const positions =
    'Company Name,Title,Description,Location,Started On,Finished On\nNimbus Labs (demo),Backend Engineer,,Hyderabad,Jan 2023,\nDemo Startup,Intern,,Pune,Jun 2021,Dec 2021\n';
  const skills = 'Name\nNode.js\nMongoDB\nnode.js\n';
  const education =
    'School Name,Start Date,End Date,Notes,Degree Name,Activities\nDemo Institute of Technology,2018,2022,,B.Tech,\n';

  it('previews positions, education and skills from the ZIP, then applies only what was confirmed', async () => {
    const r = await as(nimbusB)
      .post('/me/linkedin/preview')
      .attach(
        'file',
        zip({
          'Basic_LinkedInDataExport/Positions.csv': positions,
          'Skills.csv': skills,
          'Education.csv': education,
          'Connections.csv': 'secret,stuff',
        }),
        'export.zip',
      );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const p = r.body.data as LinkedinPreview;
    expect(p.positions[0]).toEqual({
      company: 'Nimbus Labs (demo)',
      title: 'Backend Engineer',
      from: '2023-01',
      to: null,
      current: true,
    });
    expect(p.positions[1]).toMatchObject({ from: '2021-06', to: '2021-12', current: false });
    expect(p.skills).toEqual(['Node.js', 'MongoDB']);
    expect(p.education[0]).toMatchObject({ school: 'Demo Institute of Technology', degree: 'B.Tech' });
    expect(p.read.sort()).toEqual(['Education.csv', 'Positions.csv', 'Skills.csv']);
    const a = await as(nimbusB)
      .post('/me/linkedin/apply')
      .send({ company: 'Nimbus Labs (demo)', jobTitle: 'Backend Engineer', skills: ['MongoDB'] });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const prof = await inT(() => ProfileModel.findOne({ userId: nimbusB.id }).lean());
    expect(prof).toMatchObject({ jobTitle: 'Backend Engineer', skills: expect.arrayContaining(['MongoDB']) });
    expect(prof?.skills).not.toContain('Node.js');
  });

  it('reads one CSV; refuses junk; the ZIP bomb guard stops an archive that expands too much', async () => {
    const one = await as(nimbusB)
      .post('/me/linkedin/preview')
      .attach('file', Buffer.from(skills), 'Skills.csv');
    expect(one.body.data.skills).toEqual(['Node.js', 'MongoDB']);
    expect(
      (
        await as(nimbusB)
          .post('/me/linkedin/preview')
          .attach('file', Buffer.from('hello,world\n1,2\n'), 'x.csv')
      ).status,
    ).toBe(400);
    // 20 MB of one character compresses to a few KB: a ratio far over the guard's limit.
    const bomb = zip({ 'Positions.csv': 'A'.repeat(20 * 1024 * 1024) });
    const b = await as(nimbusB).post('/me/linkedin/preview').attach('file', bomb, 'export.zip');
    expect(b.status).toBe(400);
    expect(b.body.error.message).toMatch(/expands too much|too large/);
    expect(() => readZipEntries(bomb, ['Positions.csv'])).toThrow();
    expect(
      (await as(faculty).post('/me/linkedin/preview').attach('file', Buffer.from(skills), 'Skills.csv'))
        .status,
    ).toBe(200);
  });
});

describe('batch pages', () => {
  it('lists the batch, names only companies with five or more, and counts who has not joined (suppressed)', async () => {
    const extra: TestUser[] = [];
    for (let i = 0; i < 5; i++) {
      const u = await makeUser(ctx, T, { roles: ['ALUMNI'] });
      await profile(u, {
        name: `Batchmate ${i}`,
        company: i < 4 ? 'Big Demo Co' : 'Tiny Demo Co',
        branch: 'CSE',
        gradYear: 2018,
      });
      extra.push(u);
    }
    await profile(nimbusA, { company: 'Big Demo Co' });
    await inT(() =>
      WhitelistModel.create({
        rollNumber: '18DEMO0001',
        name: 'Not Joined',
        branch: 'CSE',
        gradYear: 2018,
        kind: 'alumni',
        source: 'import',
      }),
    );
    const r = await as(student).get('/batches/2018/CSE');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.total).toBe(6);
    expect(r.body.data.companies).toEqual([{ company: 'Big Demo Co', count: 5 }]);
    expect(r.body.data.notJoined).toBe('<5');
    expect(r.body.data.members.map((m: { name: string }) => m.name)).toContain('Nimbus Alpha');
    expect((await as(student).get('/batches/2018/NOPE')).status).toBe(400);
  });
});

describe('privacy', () => {
  it('exports and erases asks, subscriptions, certificates and pledges; received money stays, detached', async () => {
    const out = (await inT(() => services.microAsks.exportFor(student.id))) as { sent: unknown[] };
    expect(out.sent.length).toBeGreaterThan(0);
    const giving = (await inT(() => services.giving.exportFor(nimbusA.id))) as unknown[];
    expect(giving).toHaveLength(1);
    await inT(() => services.microAsks.eraseFor(student.id));
    await inT(() => services.giving.eraseFor(nimbusA.id));
    await inT(() => services.recognition.eraseFor(nimbusB.id));
    expect(await inT(() => MicroAskModel.countDocuments({ fromUserId: student.id }))).toBe(0);
    const kept = await inT(() => PledgeModel.findOne({ status: 'received', amountPaise: 5_000_00 }).lean());
    expect(kept).toMatchObject({ userId: null });
    expect(kept?.anonKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(await inT(() => MentorCertificateModel.countDocuments({ userId: nimbusB.id }))).toBe(0);
    // The erased certificate's link no longer checks out.
    const codes = await inT(() => MentorCertificateModel.find({}).select('code').lean());
    expect(codes).toEqual([]);
  });
});
