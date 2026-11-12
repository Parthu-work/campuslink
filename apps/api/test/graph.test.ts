import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  CompaniesView,
  CompanyGraphView,
  ExperienceView,
  MentorMatch,
  MyExperiencesView,
} from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { makeMentor } from './mentorship-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { invalidateTenant } from '../src/modules/tenants/tenant.cache.js';
import {
  DriveRegistrationModel,
  OfferModel,
  PlacementCompanyModel,
  PlacementDriveModel,
} from '../src/modules/placements/placements.model.js';
import { ReferralRequestModel } from '../src/modules/referrals/referral.model.js';
import { BookingModel } from '../src/modules/sessions/booking.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { InterviewQuestionModel } from '../src/modules/interviews/interview.model.js';
import { ProductEventModel } from '../src/modules/insights/insights.model.js';
import {
  CompanyGraphModel,
  ExperienceModel,
  ExperiencePromptModel,
  MentorOutcomeModel,
} from '../src/modules/graph/graph.model.js';
import { EXPERIENCE_PROMPT_JOB, GraphService } from '../src/modules/graph/graph.service.js';

/** Prompt 2, G10: the Placement Graph, the Interview Experience Bank and outcome-proven matching. */

const ctx = testApp();
let T: TestTenant;
let tpo: TestUser, faculty: TestUser, viewer: TestUser, alumHidden: TestUser, mentor: TestUser;
const placed: TestUser[] = [];
const as = (u: TestUser) => api(ctx, T.host, u.token);
const inT = <R>(fn: () => Promise<R>) => runInTenant(T._id, fn);
const NIMBUS = 'nimbus labs';
/** 03:00 India time today: the nightly run is due. */
const due = () => {
  const d = new Date();
  d.setUTCHours(21, 30, 0, 0);
  return d;
};
const runGraph = async () => {
  await GraphService.enqueueNightly(ctx.queue, due());
  await ctx.queue.drain();
};
const offerOf = (userId: string | null, o: Record<string, unknown> = {}) => ({
  userId,
  companyKey: NIMBUS,
  companyName: 'Nimbus Labs',
  role: 'Software Engineer',
  type: 'full_time',
  status: 'verified',
  source: 'drive',
  branch: 'CSE',
  gradYear: 2025,
  ctcBand: '5_8',
  ctcLpa: 6.5,
  offerDate: new Date(Date.now() - 20 * 86_400_000),
  verifiedAt: new Date(Date.now() - 2 * 86_400_000),
  ...o,
});

beforeAll(async () => {
  T = await makeTenant('graph');
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  viewer = await makeUser(ctx, T, { roles: ['STUDENT'] });
  alumHidden = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  for (let i = 0; i < 6; i++) placed.push(await makeUser(ctx, T, { roles: ['STUDENT'] }));
  mentor = await makeMentor(ctx, T, { profile: { company: 'Nimbus Labs' } });
  await as(viewer).post('/me/consents').send({ purpose: 'analytics_aggregate', granted: true }).expect(200);
  await as(placed[0] as TestUser)
    .post('/me/consents')
    .send({ purpose: 'analytics_aggregate', granted: true })
    .expect(200);
  await inT(async () => {
    await ProfileModel.updateMany(
      { userId: { $in: [viewer.id, ...placed.map((p) => p.id)] } },
      { $set: { branch: 'CSE', gradYear: 2025 } },
    );
    // An alumnus who works at Nimbus but hides their company: never counted.
    await ProfileModel.updateOne(
      { userId: alumHidden.id },
      { $set: { company: 'Nimbus Labs', companyKey: NIMBUS, 'visibility.company': 'only_me' } },
    );
    const company = await PlacementCompanyModel.create({ name: 'Nimbus Labs', companyKey: NIMBUS });
    // Six verified offers in 2025 (five or more: the band shows), and one unverified that never counts.
    for (const p of placed) await OfferModel.create(offerOf(p.id));
    await OfferModel.create(offerOf(viewer.id, { status: 'reported', branch: 'CSE', gradYear: 2024 }));
    // Two offers in 2024 from ECE: counted, but suppressed and without a band.
    await OfferModel.create(
      offerOf(null, { branch: 'ECE', gradYear: 2024, anonKey: 'anon-1', ctcLpa: null }),
    );
    await OfferModel.create(
      offerOf(null, { branch: 'ECE', gradYear: 2024, anonKey: 'anon-2', ctcLpa: null }),
    );
    const driveDoc = await PlacementDriveModel.create({
      companyId: company._id,
      title: 'Nimbus campus drive',
      mode: 'on_campus',
      driveDate: new Date(Date.now() - 30 * 86_400_000),
      registrationCloseAt: new Date(Date.now() - 31 * 86_400_000),
      rounds: [
        { name: 'Aptitude', kind: 'aptitude' },
        { name: 'Technical', kind: 'technical' },
      ],
      status: 'completed',
      createdBy: tpo.id,
    });
    for (const [i, p] of placed.entries())
      await DriveRegistrationModel.create({
        driveId: driveDoc._id,
        userId: p.id,
        branch: 'CSE',
        gradYear: 2025,
        roundResults: [
          { round: 0, result: 'cleared' },
          { round: 1, result: i < 4 ? 'cleared' : 'not_cleared' },
        ],
        final: i < 4 ? 'selected' : 'not_selected',
      });
    // The mentor's sessions came before two mentees' Nimbus results (outcome-proven matching).
    for (const p of placed.slice(0, 3))
      await BookingModel.create({
        requestId: new Types.ObjectId(),
        mentorId: mentor.id,
        menteeId: p.id,
        participants: [mentor.id, p.id],
        sessionType: 'quick_chat',
        start: new Date(Date.now() - 60 * 86_400_000),
        end: new Date(Date.now() - 60 * 86_400_000 + 1800_000),
        status: 'completed',
        holds: [`${mentor.id}|g10-${p.id}`],
        room: `g10-${p.id}`,
        completedAt: new Date(Date.now() - 60 * 86_400_000),
      });
    await ReferralRequestModel.create({
      requesterId: placed[5]?.id,
      referrerId: mentor.id,
      jobId: mentor.id,
      jobTitle: 'Engineer',
      company: 'Nimbus Labs',
      why: 'I want to apply to the backend team after my internship there.',
      status: 'referred',
      respondedAt: new Date(Date.now() - 50 * 86_400_000),
      expiresAt: new Date(Date.now() + 86_400_000),
      outcome: 'interview',
    });
  });
});

describe('the Placement Graph (G10)', () => {
  it('is built nightly per college: due from 02:00 India time, one job id per college and day', async () => {
    const early = new Date(due());
    early.setUTCHours(20, 0, 0, 0); // 01:30 IST
    expect(await GraphService.enqueueNightly(ctx.queue, early)).toBe(0);
    await runGraph();
    const rows = await inT(() => CompanyGraphModel.find().lean());
    expect(rows.map((r) => r.companyKey)).toContain(NIMBUS);
    // A second run on the same day replaces, never duplicates.
    await runGraph();
    expect(await inT(() => CompanyGraphModel.countDocuments({ companyKey: NIMBUS }))).toBe(1);
  });

  it('company pages show only verified records, every count suppressed, shares from five up', async () => {
    const list = (await as(viewer).get('/companies')).body.data as CompaniesView;
    const nimbus = list.items.find((c) => c.key === NIMBUS);
    // 6 verified CSE 2025 + 2 anonymised ECE 2024; the reported (unverified) offer never counts.
    expect(nimbus).toMatchObject({ name: 'Nimbus Labs', offers: 8, batches: [2025, 2024] });
    const r = await as(viewer).get(`/companies/${encodeURIComponent(NIMBUS)}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const page = r.body.data as CompanyGraphView;
    expect(page.batches).toEqual([
      { gradYear: 2025, offers: 6, band: '5_8' },
      { gradYear: 2024, offers: '<5', band: null },
    ]);
    expect(page.branches).toEqual([
      { branch: 'CSE', offers: 6 },
      { branch: 'ECE', offers: '<5' },
    ]);
    expect(page.yourBranch).toEqual({ branch: 'CSE', offers: 6 });
    expect(page.drives).toBe('<5');
    expect(page.rounds).toEqual([
      { kind: 'aptitude', appeared: 6, passRate: 100 },
      { kind: 'technical', appeared: 6, passRate: 67 },
    ]);
    // Referrals: one, so the count is "<5" and no rate.
    expect(page.referrals).toEqual({ referred: '<5', converted: '<5', rate: null });
    // Never the exact CTC, never a member id. The timestamp is left out of the searched text: a
    // time such as 05:58:06.557Z contains "6.5" and made this check depend on the clock.
    const text = JSON.stringify({ ...page, computedAt: undefined });
    expect(text).not.toContain('6.5');
    expect(text).not.toMatch(/ctc/i);
    for (const p of placed) expect(text).not.toContain(p.id);
    expect((await as(viewer).get('/companies/unknown%20co')).status).toBe(404);
  });

  it('alumni there respect field visibility: a hidden company is never counted', async () => {
    const page = (await as(viewer).get(`/companies/${encodeURIComponent(NIMBUS)}`)).body
      .data as CompanyGraphView;
    // The mentor shows Nimbus; the other alumnus hid it.
    expect(page.alumni).toBe('<5');
    expect(page.mentors).toBe('<5');
    const row = await inT(() => CompanyGraphModel.findOne({ companyKey: NIMBUS }).lean());
    expect(row).toMatchObject({ alumni: 1, mentors: 1, sessions: 3 });
  });

  it('a page view is recorded once a day for members who allowed analytics', async () => {
    await as(viewer)
      .get(`/companies/${encodeURIComponent(NIMBUS)}`)
      .expect(200);
    expect(
      await inT(() => ProductEventModel.countDocuments({ name: 'company_page_viewed', userId: viewer.id })),
    ).toBe(1);
  });

  it('permissions: unverified members and other roles without companies:view are refused', async () => {
    const unverified = await makeUser(ctx, T, { roles: ['STUDENT'], verified: false });
    expect((await as(unverified).get('/companies')).status).toBe(403);
    expect((await as(tpo).get('/companies')).status).toBe(200);
  });

  it('is off with the placements switch (data kept)', async () => {
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'features.placements': false } });
    invalidateTenant(T.slug);
    expect((await as(viewer).get('/companies')).body.error.code).toBe('FEATURE_DISABLED');
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'features.placements': true } });
    invalidateTenant(T.slug);
    expect(await inT(() => CompanyGraphModel.countDocuments())).toBeGreaterThan(0);
  });
});

describe('outcome-proven matching (G10)', () => {
  it('mentors whose mentees from your branch reached interviews rank with a plain reason', async () => {
    const out = await inT(() => MentorOutcomeModel.findOne({ mentorId: mentor.id }).lean());
    expect(out?.mentees).toHaveLength(3);
    const matches = (await as(viewer).get('/mentors/match')).body.data as MentorMatch[];
    const m = matches.find((x) => x.mentor.userId === mentor.id);
    expect(m?.reasons).toContainEqual({ kind: 'outcomes', count: 3, scope: 'branch' });
    // One converted referral is below the minimum: no referral reason.
    expect(m?.reasons.some((r) => r.kind === 'referrals')).toBe(false);
  });
});

const SHARE = {
  company: 'Nimbus Labs',
  role: 'Software Engineer',
  year: 2025,
  rounds: [
    {
      kind: 'aptitude',
      name: 'Online test',
      questions: ['Time and work: two pipes fill a tank…'],
      notes: '',
    },
    {
      kind: 'technical',
      name: 'Technical 1',
      questions: ['Explain how a hash map handles collisions.', 'Reverse a linked list in place.'],
      notes: 'Friendly panel; asked about my project.',
    },
    { kind: 'hr', questions: ['Why Nimbus?'] },
  ],
  tips: 'Revise DBMS joins and practise explaining your project in two minutes.',
  difficulty: 'medium',
  result: 'selected',
  named: false,
};

describe('the Interview Experience Bank (G10)', () => {
  let shared: ExperienceView;

  it('only college-verified authors with an offer or a drive at that company (or alumni) may share', async () => {
    const author = placed[0] as TestUser;
    const mine = (await as(author).get('/me/experiences')).body.data as MyExperiencesView;
    expect(mine.companies).toEqual([{ key: NIMBUS, name: 'Nimbus Labs' }]);
    expect(mine.anyCompany).toBe(false);
    expect(
      (
        await as(author)
          .post('/me/experiences')
          .send({ ...SHARE, company: 'Orbit Systems' })
      ).status,
    ).toBe(403);
    expect((await as(faculty).post('/me/experiences').send(SHARE)).status).toBe(403);
    const r = await as(author).post('/me/experiences').send(SHARE);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    shared = r.body.data as ExperienceView;
    expect(shared).toMatchObject({ status: 'pending', mine: true, company: { key: NIMBUS } });
    expect(shared.author.basis).toBe('verified_offer');
    expect(
      await inT(() => ProductEventModel.countDocuments({ name: 'experience_shared', userId: author.id })),
    ).toBe(1);
    // Waiting for review: nobody else reads it yet.
    const page = (await as(viewer).get(`/companies/${encodeURIComponent(NIMBUS)}`)).body
      .data as CompanyGraphView;
    expect(page.experiences).toEqual([]);
  });

  it('Admin › Overview counts write-ups waiting for review, for reviewers only', async () => {
    const ov = (await as(faculty).get('/admin/overview')).body.data as {
      queues: { id: string; pending: number }[];
    };
    expect(ov.queues).toEqual(
      expect.arrayContaining([
        { id: 'experiences', pending: 1 },
        { id: 'interviewQuestions', pending: expect.any(Number) },
        { id: 'practiceBank', pending: expect.any(Number) },
      ]),
    );
    expect((await as(viewer).get('/admin/overview')).status).toBe(403);
  });

  it('reviewers publish it and send picked questions to the interview bank (pending faculty review)', async () => {
    expect((await as(viewer).get('/admin/experiences')).status).toBe(403);
    const queue = (await as(faculty).get('/admin/experiences')).body.data as ExperienceView[];
    expect(queue.map((e) => e.id)).toContain(shared.id);
    expect(
      (await as(faculty).post(`/admin/experiences/${shared.id}/decision`).send({ decision: 'reject' }))
        .status,
    ).toBe(400);
    const r = await as(faculty)
      .post(`/admin/experiences/${shared.id}/decision`)
      .send({
        decision: 'approve',
        bank: [
          { round: 1, question: 0 },
          { round: 2, question: 0 },
          { round: 9, question: 0 },
        ],
      });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.status).toBe('published');
    const bank = await inT(() =>
      InterviewQuestionModel.find({ source: 'interview_bank' }).sort({ _id: 1 }).lean(),
    );
    expect(bank.map((q) => [q.track, q.status, q.text])).toEqual([
      ['technical', 'pending', 'Explain how a hash map handles collisions.'],
      ['hr', 'pending', 'Why Nimbus?'],
    ]);
    expect(
      await inT(() =>
        NotificationModel.countDocuments({
          userId: (placed[0] as TestUser).id,
          type: 'experience_published',
        }),
      ),
    ).toBe(1);
    expect(
      (await as(faculty).post(`/admin/experiences/${shared.id}/decision`).send({ decision: 'approve' }))
        .status,
    ).toBe(409);
    // A practice question written from the aptitude question (G4).
    await as(faculty)
      .post(`/admin/experiences/${shared.id}/practice`)
      .send({ round: 0, question: 0 })
      .expect(204);
    const page = (await as(viewer).get(`/companies/${encodeURIComponent(NIMBUS)}`)).body
      .data as CompanyGraphView;
    expect(page.experiences).toHaveLength(1);
    const e = page.experiences[0] as ExperienceView;
    // The author chose not to show their name; branch and batch stay; reviewers' notes do not show.
    expect(e.author).toEqual({ name: null, branch: 'CSE', gradYear: 2025, basis: 'verified_offer' });
    expect(e.rounds[1]?.questions.map((q) => q.sent)).toEqual([null, null]);
    expect(e.mine).toBe(false);
  });

  it('is moderated after publishing: reported, removed with a reason the author sees', async () => {
    const report = await as(viewer)
      .post('/reports')
      .send({ targetType: 'experience', targetId: shared.id, reason: 'inappropriate' });
    expect(report.status, JSON.stringify(report.body)).toBe(201);
    const act = await as(faculty).post('/admin/moderation/actions').send({
      targetType: 'experience',
      targetId: shared.id,
      action: 'remove',
      reason: 'privacy',
      note: 'Names an interviewer',
    });
    expect(act.status, JSON.stringify(act.body)).toBe(200);
    const page = (await as(viewer).get(`/companies/${encodeURIComponent(NIMBUS)}`)).body
      .data as CompanyGraphView;
    expect(page.experiences).toEqual([]);
    const mine = (await as(placed[0] as TestUser).get('/me/experiences')).body.data as MyExperiencesView;
    expect(mine.items[0]).toMatchObject({ removed: true });
    expect(
      await inT(() =>
        NotificationModel.countDocuments({ userId: (placed[0] as TestUser).id, type: 'content_removed' }),
      ),
    ).toBe(1);
  });

  it('a write-up sent back carries the reason; the author can withdraw it', async () => {
    const author = placed[1] as TestUser;
    const r = (
      await as(author)
        .post('/me/experiences')
        .send({ ...SHARE, named: true })
    ).body.data as ExperienceView;
    expect(r.author.basis).toBe('verified_offer');
    await as(faculty)
      .post(`/admin/experiences/${r.id}/decision`)
      .send({ decision: 'reject', reason: 'Please remove the interviewer’s name.' })
      .expect(200);
    const mine = (await as(author).get('/me/experiences')).body.data as MyExperiencesView;
    expect(mine.items[0]).toMatchObject({
      status: 'rejected',
      reason: 'Please remove the interviewer’s name.',
    });
    expect((await as(viewer).delete(`/me/experiences/${r.id}`)).status).toBe(404);
    await as(author).delete(`/me/experiences/${r.id}`).expect(204);
    expect(await inT(() => ExperienceModel.countDocuments({ _id: r.id }))).toBe(0);
  });
});

describe('the 7-day prompt to offer holders (G10)', () => {
  it('is a delayed job per verified offer, sent once, and skipped when they already shared', async () => {
    const prompts = await inT(() => ExperiencePromptModel.find().lean());
    expect(prompts.length).toBe(placed.length);
    const jobs = ctx.queue.delayed.filter((j) => j.name === EXPERIENCE_PROMPT_JOB);
    expect(jobs).toHaveLength(placed.length);
    const job = jobs[0];
    // Due 7 days after verification (2 days ago): about 5 days from now.
    expect((job?.dueAt ?? 0) - Date.now()).toBeGreaterThan(4.9 * 86_400_000);
    expect((job?.dueAt ?? 0) - Date.now()).toBeLessThan(5.1 * 86_400_000);
    // Another nightly run schedules nothing new.
    await runGraph();
    expect(ctx.queue.delayed.filter((j) => j.name === EXPERIENCE_PROMPT_JOB)).toHaveLength(placed.length);
    await ctx.queue.runDelayed({ name: EXPERIENCE_PROMPT_JOB });
    const sent = await inT(() => NotificationModel.find({ type: 'experience_prompt' }).lean());
    // placed[0] already shared about Nimbus: no prompt for them.
    expect(sent.map((n) => String(n.userId)).sort()).toEqual(
      placed
        .slice(1)
        .map((p) => p.id)
        .sort(),
    );
    expect(sent[0]?.data).toMatchObject({ company: 'Nimbus Labs', companyKey: NIMBUS });
  });
});

describe('privacy (G10)', () => {
  it('export has the write-ups and the mentor’s outcomes; erasure deletes drafts and detaches published ones', async () => {
    const author = placed[2] as TestUser;
    const draft = (await as(author).post('/me/experiences').send(SHARE)).body.data as ExperienceView;
    const pub = (
      await as(author)
        .post('/me/experiences')
        .send({ ...SHARE, named: true })
    ).body.data as ExperienceView;
    await as(faculty).post(`/admin/experiences/${pub.id}/decision`).send({ decision: 'approve' }).expect(200);
    const exp = await as(author).get('/me/export');
    expect(exp.status).toBe(200);
    expect(JSON.stringify(JSON.parse(exp.text).interviewExperiences)).toContain('Nimbus Labs');
    const mExp = JSON.parse((await as(mentor).get('/me/export')).text);
    expect(mExp.mentorOutcomes.mentorOutcomes.mentees).toHaveLength(3);

    const svc = ctx.app.locals.services as {
      experiences: { eraseFor(u: string): Promise<void> };
      graph: { eraseFor(u: string): Promise<void> };
    };
    await inT(() => svc.experiences.eraseFor(author.id));
    await inT(() => svc.graph.eraseFor(mentor.id));
    expect(await inT(() => ExperienceModel.countDocuments({ _id: draft.id }))).toBe(0);
    const kept = await inT(() => ExperienceModel.findById(pub.id).lean());
    expect(kept).toMatchObject({ authorId: null, named: false, status: 'published' });
    expect(await inT(() => ExperiencePromptModel.countDocuments({ userId: author.id }))).toBe(0);
    expect(await inT(() => MentorOutcomeModel.countDocuments({ mentorId: mentor.id }))).toBe(0);
  });
});
