import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { ctcBand, currentGradYear } from '@campuslink/shared';
import { runInTenant } from '../src/lib/context.js';
import { ProductEventModel } from '../src/modules/insights/insights.model.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import {
  DriveRegistrationModel,
  OfferModel,
  PlacementCompanyModel,
  PlacementDriveModel,
} from '../src/modules/placements/placements.model.js';
import { MentorshipRequestModel } from '../src/modules/mentorship/request.model.js';
import { AiUsageModel } from '../src/modules/study/ai-usage.model.js';
import { ChannelMessageModel } from '../src/modules/notifications/channels/channel.model.js';
import type { YcCollegeMetrics, YcMetricsService } from '../src/modules/insights/yc-metrics.service.js';
import { parseArgs, table } from '../src/scripts/metrics-yc.js';
import { makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';

/**
 * Prompt 2, G13: the YC metrics pack on fixtures. Each metric, suppression under five, nothing that
 * points to a member in the output, and two colleges kept apart.
 */
const ctx = testApp();
const yc = (ctx.app.locals.services as { ycMetrics: YcMetricsService }).ycMetrics;
const DAY = 86_400_000;
const now = new Date();
const dayAgo = (n: number) => new Date(now.getTime() - n * DAY).toISOString().slice(0, 10);
const range = { from: dayAgo(27), to: dayAgo(0) };
const gradYear = currentGradYear(new Date(now.getTime() + DAY));

let A: TestTenant;
let B: TestTenant;
const aStudents: TestUser[] = [];
const bStudents: TestUser[] = [];
const everyone: TestUser[] = [];

async function students(t: TestTenant, n: number, into: TestUser[]) {
  for (let i = 0; i < n; i++) {
    const u = await makeUser(ctx, t, { roles: ['STUDENT'] });
    into.push(u);
    everyone.push(u);
    await runInTenant(t._id, () =>
      ProfileModel.updateOne({ userId: new Types.ObjectId(u.id) }, { $set: { branch: 'CSE', gradYear } }),
    );
  }
}

beforeAll(async () => {
  A = await makeTenant('ycmetrica');
  B = await makeTenant('ycmetricb');
  await students(A, 7, aStudents);
  await students(B, 2, bStudents);
  everyone.push(
    await makeUser(ctx, A, { roles: ['ALUMNI'] }),
    await makeUser(ctx, A, { roles: ['FACULTY'] }),
  );

  await runInTenant(A._id, async () => {
    // Six of seven sign up, verify and send a request within the week; five of those requests end
    // in a session. Everyone also acts in one week (weekly actives).
    const rows = aStudents.slice(0, 6).flatMap((u, i) => {
      const requestId = String(new Types.ObjectId());
      const userId = new Types.ObjectId(u.id);
      return [
        { day: dayAgo(20), userId, name: 'signed_up', props: {} },
        { day: dayAgo(20), userId, name: 'verified', props: {} },
        { day: dayAgo(18), userId, name: 'request_sent', props: { requestId } },
        ...(i < 5 ? [{ day: dayAgo(12), userId, name: 'session_completed', props: { requestId } }] : []),
      ];
    });
    await ProductEventModel.insertMany(rows);
    // Five replies, 2 to 10 hours after the request.
    for (const [i, u] of aStudents.slice(0, 5).entries()) {
      const createdAt = new Date(now.getTime() - 18 * DAY);
      const r = await MentorshipRequestModel.create({
        mentorId: new Types.ObjectId(),
        menteeId: new Types.ObjectId(u.id),
        sessionType: 'quick_chat',
        status: 'accepted',
        respondedAt: new Date(createdAt.getTime() + (2 + i * 2) * 3600_000),
        expiresAt: new Date(createdAt.getTime() + 7 * DAY),
      });
      await MentorshipRequestModel.updateOne(
        { _id: r._id },
        { $set: { createdAt } },
        { timestamps: false, overwriteImmutable: true },
      );
    }
    // A drive held in the range for this batch: five of the seven students registered.
    const company = await PlacementCompanyModel.create({ name: 'Fixture Co', companyKey: 'fixture co' });
    const drive = await PlacementDriveModel.create({
      companyId: company._id,
      title: 'Fixture drive',
      roles: [{ title: 'Engineer', type: 'full_time' }],
      mode: 'on_campus',
      driveDate: new Date(now.getTime() - 5 * DAY),
      registrationCloseAt: new Date(now.getTime() - 8 * DAY),
      eligibility: { branches: [], gradYears: [gradYear] },
      rounds: [],
      status: 'completed',
      createdBy: new Types.ObjectId(),
    });
    for (const u of aStudents.slice(0, 5))
      await DriveRegistrationModel.create({ driveId: drive._id, userId: new Types.ObjectId(u.id), gradYear });
    // The batch: ten on the list, five verified job offers (an internship does not count); last
    // year's batch: ten, with six offers verified by this date a year ago.
    for (const [y, n] of [
      [gradYear, 10],
      [gradYear - 1, 10],
    ] as const)
      for (let i = 0; i < n; i++)
        await WhitelistModel.create({
          rollNumber: `F${y}${String(i).padStart(3, '0')}`,
          name: 'Fixture',
          branch: 'CSE',
          gradYear: y,
          kind: 'student',
          source: 'manual',
        });
    const offer = (y: number, type: string, verifiedAt: Date) =>
      OfferModel.create({
        userId: new Types.ObjectId(),
        companyKey: 'fixture co',
        companyName: 'Fixture Co',
        role: 'Engineer',
        ctcLpa: 6,
        ctcBand: ctcBand(6),
        offerDate: verifiedAt,
        type,
        source: 'drive',
        status: 'verified',
        verifiedAt,
        gradYear: y,
      });
    for (let i = 0; i < 5; i++) await offer(gradYear, 'full_time', new Date(now.getTime() - 3 * DAY));
    await offer(gradYear, 'internship', new Date(now.getTime() - 3 * DAY));
    for (let i = 0; i < 6; i++) await offer(gradYear - 1, 'full_time', new Date(now.getTime() - 380 * DAY));
    await offer(gradYear - 1, 'full_time', new Date(now.getTime() - 300 * DAY));
    // AI: 12 Copilot and 3 study answers in the range; embeddings and older days do not count.
    const usage = (day: string, kind: string, feature: string, requests: number) =>
      AiUsageModel.create({
        day,
        userId: new Types.ObjectId(aStudents[0]?.id),
        kind,
        feature,
        model: 'mock:mock-chat-1',
        requests,
      });
    await usage(dayAgo(4), 'chat', 'copilot', 12);
    await usage(dayAgo(3), 'chat', 'study_chat', 3);
    await usage(dayAgo(3), 'embedding', 'copilot', 40);
    await usage(dayAgo(60), 'chat', 'copilot', 99);
    // WhatsApp: 6 read, 4 delivered, 2 failed.
    const statuses = [
      ...Array(6).fill('read'),
      ...Array(4).fill('delivered'),
      'failed',
      'failed',
    ] as string[];
    await ChannelMessageModel.insertMany(
      statuses.map((status, i) => ({
        userId: new Types.ObjectId(aStudents[i % 7]?.id),
        channel: 'whatsapp',
        template: 'cl_drive_open',
        category: 'placements',
        critical: false,
        providerMessageId: `fixture-${i}`,
        status,
        statusAt: now,
        expiresAt: new Date(now.getTime() + 90 * DAY),
      })),
    );
  });

  await runInTenant(B._id, async () => {
    await ProductEventModel.insertMany(
      bStudents.map((u) => ({
        day: dayAgo(10),
        userId: new Types.ObjectId(u.id),
        name: 'roadmap_step',
        props: {},
      })),
    );
  });
});

const of = (t: TestTenant) => runInTenant(t._id, () => yc.college(range, now));

describe('the YC metrics pack (prompt 2, G13)', () => {
  let a: YcCollegeMetrics;
  let b: YcCollegeMetrics;
  beforeAll(async () => {
    a = await of(A);
    b = await of(B);
  });

  it('counts verified members by role, suppressing fewer than five', () => {
    expect(a.verifiedMembers).toMatchObject({ students: 7, alumni: '<5', faculty: '<5' });
    expect(b.verifiedMembers.students).toBe('<5');
  });

  it('counts weekly active students from meaningful actions in each ISO week', () => {
    const counted = a.weeklyActiveStudents.weeks.filter((w) => w.students !== 0);
    expect(counted.map((w) => w.students)).toContain(6);
    expect(a.weeklyActiveStudents.weeks.every((w) => w.source === 'events')).toBe(true);
  });

  it('follows the activation funnel: signed up, verified, a meaningful action within 7 days', () => {
    expect(a.activation).toMatchObject({
      signedUp: 6,
      verified: 6,
      matured: 6,
      activated: 6,
      activationPct: 100,
    });
  });

  it('works out request to session conversion and the median reply time', () => {
    expect(a.mentorship).toMatchObject({
      requests: 6,
      sessions: 5,
      conversionPct: 83.3,
      medianReplyHours: 6,
    });
  });

  it('works out drives run and the registration rate against eligible students', () => {
    expect(a.drives).toMatchObject({ run: '<5', eligible: 7, registered: 5, registrationPct: 71.4 });
  });

  it('works out verified job offers per 100 final-years and the change against last year at the same point', () => {
    expect(a.offers).toMatchObject({ gradYear, finalYears: 10, jobOffers: 5, per100: 50 });
    expect(a.offers.previous).toMatchObject({
      gradYear: gradYear - 1,
      finalYears: 10,
      jobOffers: 6,
      per100: 60,
    });
    expect(a.offers.change).toBe(-10);
  });

  it('counts AI questions (chat answers of the study assistant and the Copilot) per active student', () => {
    expect(a.ai).toMatchObject({ questions: 15, activeStudents: 6, perActiveStudent: 2.5 });
  });

  it('works out the WhatsApp read rate as read / (delivered + read)', () => {
    expect(a.whatsapp).toEqual({ delivered: '<5', read: 6, readPct: 60 });
  });

  it('suppresses small cells and shows no ratio built on one', () => {
    expect(b.activation.signedUp).toBe(0);
    expect(b.ai.activeStudents).toBe('<5');
    expect(b.ai.perActiveStudent).toBeNull();
    expect(b.drives).toEqual({ run: 0, eligible: 0, registered: 0, registrationPct: null });
    expect(b.offers.per100).toBeNull();
    expect(b.whatsapp.readPct).toBeNull();
  });

  it('keeps the two colleges apart', () => {
    expect(b.mentorship.requests).toBe(0);
    expect(b.offers.jobOffers).toBe(0);
    expect(b.ai.questions).toBe(0);
    expect(a.live).toBe(true);
    expect(b.live).toBe(true);
  });

  it('puts no member id, email or name in the output', () => {
    for (const out of [
      JSON.stringify(a),
      JSON.stringify(b),
      table(
        range,
        [
          ['a', a],
          ['b', b],
        ],
        2,
      ),
    ]) {
      expect(out).not.toMatch(/[a-f0-9]{24}/);
      expect(out).not.toMatch(/@|Test Person|Fixture/);
      for (const u of everyone) expect(out).not.toContain(u.id);
    }
  });

  it('parses the range: the last 28 days by default, dates checked', () => {
    const at = new Date('2026-11-07T12:00:00Z');
    expect(parseArgs([], at)).toEqual({ range: { from: '2026-10-11', to: '2026-11-07' }, json: false });
    expect(parseArgs(['--from', '2026-01-01', '--to', '2026-03-31', '--json'], at)).toEqual({
      range: { from: '2026-01-01', to: '2026-03-31' },
      json: true,
    });
    expect(() => parseArgs(['--from', 'yesterday'], at)).toThrow(/date/);
    expect(() => parseArgs(['--from', '2026-05-01', '--to', '2026-04-01'], at)).toThrow(/after/);
  });
});
