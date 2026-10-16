import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  MAX_OPEN_REFERRALS,
  REFERRAL_TTL_DAYS,
  type ReferralPrefsView,
  type ReferralView,
  type ReferrerView,
  type referralPrefsBody,
  type referralRequestBody,
  type referralRespondBody,
  type referralsQuery,
} from '@campuslink/shared';
import {
  ReferralPrefsModel,
  ReferralRequestModel,
  type ReferralDoc,
  type ReferralPrefsDoc,
} from './referral.model.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { plainText } from '../../lib/text.js';
import { requireTenantId } from '../../lib/context.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { JobsService } from '../jobs/jobs.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { SafetyService, ReportTarget } from '../moderation/safety.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { FilesService } from '../files/files.service.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';
import type { AuthState } from '../../types.js';

export const REFERRAL_EXPIRE_JOB = 'referrals.expire';
const DAY = 86_400_000;
const WEEK = 7 * DAY;
/** Résumés stay with a request for 60 days, then the retention job deletes them. */
const RESUME_KEEP = 60 * DAY;
const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;
/** Requests that count against an alumnus's weekly cap. */
const COUNTED = ['pending', 'referred'];

export interface ReferralsDeps {
  listings: JobsService;
  profiles: ProfilesService;
  safety: SafetyService;
  notifications: NotificationsService;
  files: FilesService;
  jobs: JobQueue;
}

/**
 * Referral requests: only to alumni who opted in, within their weekly cap; one-tap for the
 * student, one-tap refer or a kind decline for the alumnus. Requests expire after 14 days.
 */
export class ReferralsService {
  constructor(private readonly d: ReferralsDeps) {}

  // ── Settings ─────────────────────────────
  private async usedThisWeek(referrerIds: Types.ObjectId[]) {
    const rows = await ReferralRequestModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      {
        $match: {
          referrerId: { $in: referrerIds },
          status: { $in: COUNTED },
          createdAt: { $gte: new Date(Date.now() - WEEK) },
        },
      },
      { $group: { _id: '$referrerId', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.n]));
  }

  async prefs(viewer: AuthState): Promise<ReferralPrefsView> {
    const me = new Types.ObjectId(viewer.userId);
    const [p, own, used] = await Promise.all([
      ReferralPrefsModel.findOne({ userId: me }).lean<ReferralPrefsDoc>(),
      this.d.profiles.ownCompany(viewer.userId),
      this.usedThisWeek([me]),
    ]);
    return {
      accepting: p?.accepting ?? false,
      weeklyCap: p?.weeklyCap ?? 3,
      note: p?.note ?? '',
      company: own.company,
      usedThisWeek: used.get(viewer.userId) ?? 0,
    };
  }

  async updatePrefs(viewer: AuthState, body: z.output<typeof referralPrefsBody>) {
    if (body.accepting && !(await this.d.profiles.ownCompany(viewer.userId)).companyKey)
      throw badRequest('Add your current company to your profile first');
    await ReferralPrefsModel.updateOne(
      { userId: new Types.ObjectId(viewer.userId) },
      { $set: { accepting: body.accepting, weeklyCap: body.weeklyCap, note: plainText(body.note ?? '') } },
      { upsert: true },
    );
    return this.prefs(viewer);
  }

  /** For job cards: how many alumni at each company accept referral requests (visible to the viewer). */
  async referrerCounts(keys: string[], viewer: AuthState): Promise<Map<string, number>> {
    const alumni = await this.d.profiles.alumniAtCompanies(viewer, keys);
    const ids = [...alumni.values()].flat();
    if (!ids.length) return new Map();
    const accepting = new Set(
      (
        await ReferralPrefsModel.find({ userId: { $in: ids }, accepting: true })
          .select('userId')
          .lean()
      ).map((p) => String(p.userId)),
    );
    const hidden = await this.d.safety.hiddenFor(viewer.userId);
    return new Map(
      [...alumni].map(([k, v]) => [k, v.filter((id) => accepting.has(id) && !hidden.has(id)).length]),
    );
  }

  /** Alumni at the job's company who accept referral requests, with whether they have room this week. */
  async referrersFor(viewer: AuthState, jobId: string): Promise<ReferrerView[]> {
    const job = await this.d.listings.openJob(jobId);
    const ids = (await this.d.profiles.alumniAtCompanies(viewer, [job.companyKey])).get(job.companyKey) ?? [];
    if (!ids.length) return [];
    const hidden = await this.d.safety.hiddenFor(viewer.userId);
    const prefs = await ReferralPrefsModel.find({
      userId: { $in: ids.filter((id) => !hidden.has(id)).map((id) => new Types.ObjectId(id)) },
      accepting: true,
    }).lean<ReferralPrefsDoc[]>();
    const [cards, used] = await Promise.all([
      this.d.profiles.referrerCards(
        viewer,
        prefs.map((p) => String(p.userId)),
      ),
      this.usedThisWeek(prefs.map((p) => p.userId)),
    ]);
    return prefs.flatMap((p) => {
      const c = cards.get(String(p.userId));
      return c ? [{ ...c, note: p.note, available: (used.get(String(p.userId)) ?? 0) < p.weeklyCap }] : [];
    });
  }

  // ── Requests ─────────────────────────────
  private async views(rows: ReferralDoc[]): Promise<ReferralView[]> {
    const refs = await this.d.profiles.refsFor(rows.flatMap((r) => [r.requesterId, r.referrerId]));
    const ref = (id: Types.ObjectId) =>
      refs.get(String(id)) ?? { userId: String(id), name: '', avatarFileId: null };
    return rows.map((r) => ({
      id: String(r._id),
      status: r.status as ReferralView['status'],
      job: { id: String(r.jobId), title: r.jobTitle, company: r.company },
      requester: ref(r.requesterId),
      referrer: ref(r.referrerId),
      why: r.why,
      resumeFileId: r.resumeFileId ? String(r.resumeFileId) : null,
      responseNote: r.responseNote ?? null,
      declineTemplate: (r.declineTemplate ?? null) as ReferralView['declineTemplate'],
      createdAt: r.createdAt.toISOString(),
      respondedAt: r.respondedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
    }));
  }

  async create(
    viewer: AuthState,
    tenant: TenantRecord,
    body: z.output<typeof referralRequestBody>,
  ): Promise<ReferralView> {
    if (body.referrerId === viewer.userId) throw badRequest('You cannot refer yourself');
    const job = await this.d.listings.openJob(body.jobId);
    const referrers = await this.referrersFor(viewer, body.jobId);
    const target = referrers.find((r) => r.userId === body.referrerId);
    if (!target) throw notFound('Alumnus who refers for this company');
    if (!target.available)
      throw conflict(`${target.name} has reached this week’s referral limit. Try again next week.`);
    const me = new Types.ObjectId(viewer.userId);
    const [open, thisWeek] = await Promise.all([
      ReferralRequestModel.countDocuments({ requesterId: me, status: 'pending' }),
      ReferralRequestModel.countDocuments({
        requesterId: me,
        createdAt: { $gte: new Date(Date.now() - WEEK) },
      }),
    ]);
    if (open >= MAX_OPEN_REFERRALS)
      throw conflict(
        `You can have ${MAX_OPEN_REFERRALS} open referral requests at a time. Withdraw one or wait for replies.`,
      );
    const weekly = tenant.limits?.referralRequestsPerWeek ?? 5;
    if (thisWeek >= weekly)
      throw conflict(`Your college allows ${weekly} referral requests a week. Try again later.`);
    const why = plainText(body.why);
    if (why.length < 30) throw badRequest('Say a little more about why you fit (at least 30 characters)');
    const expiresAt = new Date(Date.now() + REFERRAL_TTL_DAYS * DAY);
    const resume = body.resumeFileId
      ? await this.d.files.pending(body.resumeFileId, viewer.userId, 'referral_resume')
      : null;
    if (body.resumeFileId && !resume)
      throw badRequest('Upload your résumé again (it expired or is already used)');
    let doc;
    try {
      doc = await ReferralRequestModel.create({
        requesterId: me,
        referrerId: new Types.ObjectId(body.referrerId),
        jobId: job._id,
        jobTitle: job.title,
        company: job.company,
        why,
        resumeFileId: resume ? new Types.ObjectId(resume.id) : null,
        expiresAt,
      });
    } catch (e) {
      if (isDuplicate(e)) throw conflict('You already asked this alumnus about this job');
      throw e;
    }
    if (resume)
      await this.d.files.claim(
        resume.id,
        viewer.userId,
        'referral_resume',
        new Date(Date.now() + RESUME_KEEP),
      );
    const id = String(doc._id);
    await this.d.jobs.enqueue(
      REFERRAL_EXPIRE_JOB,
      { tenantId: String(requireTenantId()), referralId: id },
      { jobId: `refexp-${id}`, delayMs: REFERRAL_TTL_DAYS * DAY },
    );
    const name = (await this.d.profiles.refsFor([viewer.userId])).get(viewer.userId)?.name ?? '';
    await this.d.notifications.notify(body.referrerId, 'referral_received', {
      name,
      company: job.company,
      referralId: id,
    });
    return (await this.views([doc.toObject() as ReferralDoc]))[0] as ReferralView;
  }

  private async expireDue(scope: Record<string, unknown>) {
    const due = await ReferralRequestModel.find({
      ...scope,
      status: 'pending',
      expiresAt: { $lte: new Date() },
    })
      .select('_id')
      .lean();
    for (const r of due) await this.expireOne(String(r._id));
  }

  private async expireOne(id: string) {
    const r = await ReferralRequestModel.findOneAndUpdate(
      { _id: id, status: 'pending', expiresAt: { $lte: new Date() } },
      { $set: { status: 'expired' } },
      { returnDocument: 'after' },
    ).lean<ReferralDoc>();
    if (!r) return;
    const name = (await this.d.profiles.refsFor([r.referrerId])).get(String(r.referrerId))?.name ?? '';
    await this.d.notifications.notify(r.requesterId, 'referral_expired', {
      name,
      company: r.company,
      referralId: id,
    });
  }

  async onExpire(job: TenantJob) {
    await this.expireOne(String(job.referralId));
  }

  async list(viewer: AuthState, q: z.output<typeof referralsQuery>) {
    const filter: Record<string, unknown> = {
      [q.box === 'received' ? 'referrerId' : 'requesterId']: new Types.ObjectId(viewer.userId),
      ...(q.status ? { status: q.status } : {}),
      ...(q.cursor ? { _id: { $lt: new Types.ObjectId(q.cursor) } } : {}),
    };
    await this.expireDue({
      [q.box === 'received' ? 'referrerId' : 'requesterId']: new Types.ObjectId(viewer.userId),
    });
    const hidden = await this.d.safety.hiddenFor(viewer.userId);
    const rows = (
      await ReferralRequestModel.find(filter).sort({ _id: -1 }).limit(31).lean<ReferralDoc[]>()
    ).filter((r) => !hidden.has(String(q.box === 'received' ? r.requesterId : r.referrerId)));
    const page = rows.slice(0, 30);
    return { items: await this.views(page), nextCursor: rows.length > 30 ? String(page.at(-1)?._id) : null };
  }

  private async mine(viewer: AuthState, id: string) {
    await this.expireDue({ _id: new Types.ObjectId(id) });
    const me = new Types.ObjectId(viewer.userId);
    const r = await ReferralRequestModel.findOne({
      _id: id,
      $or: [{ requesterId: me }, { referrerId: me }],
    }).lean<ReferralDoc>();
    if (!r) throw notFound('Referral request');
    return r;
  }

  async get(viewer: AuthState, id: string) {
    return (await this.views([await this.mine(viewer, id)]))[0] as ReferralView;
  }

  async respond(viewer: AuthState, id: string, body: z.output<typeof referralRespondBody>) {
    const r = await this.mine(viewer, id);
    if (String(r.referrerId) !== viewer.userId) throw notFound('Referral request');
    if (r.status !== 'pending') throw conflict(`This request is already ${r.status}`);
    const done = await ReferralRequestModel.findOneAndUpdate(
      { _id: r._id, status: 'pending' },
      {
        $set: {
          status: body.action === 'refer' ? 'referred' : 'declined',
          declineTemplate: body.action === 'decline' ? body.template : null,
          responseNote: body.note ? plainText(body.note) : null,
          respondedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    ).lean<ReferralDoc>();
    if (!done) throw conflict('This request just changed. Refresh and try again.');
    await this.d.jobs.cancel(REFERRAL_EXPIRE_JOB, `refexp-${id}`);
    const name = (await this.d.profiles.refsFor([viewer.userId])).get(viewer.userId)?.name ?? '';
    await this.d.notifications.notify(
      r.requesterId,
      body.action === 'refer' ? 'referral_referred' : 'referral_declined',
      {
        name,
        company: r.company,
        referralId: id,
      },
    );
    return (await this.views([done]))[0] as ReferralView;
  }

  async withdraw(viewer: AuthState, id: string) {
    const r = await this.mine(viewer, id);
    if (String(r.requesterId) !== viewer.userId) throw notFound('Referral request');
    const done = await ReferralRequestModel.findOneAndUpdate(
      { _id: r._id, status: 'pending' },
      { $set: { status: 'withdrawn' } },
      { returnDocument: 'after' },
    ).lean<ReferralDoc>();
    if (!done) throw conflict(`This request is already ${r.status}`);
    await this.d.jobs.cancel(REFERRAL_EXPIRE_JOB, `refexp-${id}`);
    return (await this.views([done]))[0] as ReferralView;
  }

  // ── Hooks ─────────────────────────────
  /** Files hook: a résumé is readable by the two people on its request. */
  async resumeAccess(fileId: string, viewer: AuthState): Promise<{ name: string } | null> {
    const me = new Types.ObjectId(viewer.userId);
    const r = await ReferralRequestModel.findOne({
      resumeFileId: new Types.ObjectId(fileId),
      $or: [{ requesterId: me }, { referrerId: me }],
    })
      .select('_id')
      .lean();
    return r ? { name: 'resume.pdf' } : null;
  }

  /** Reports: the alumnus who received a request can report it (the moderator sees the message). */
  async reportTarget(viewer: AuthState, id: string): Promise<ReportTarget | null> {
    const r = await ReferralRequestModel.findOne({
      _id: id,
      referrerId: new Types.ObjectId(viewer.userId),
    }).lean<ReferralDoc>();
    return r
      ? { subjectUserId: String(r.requesterId), snapshot: `${r.jobTitle} at ${r.company}\n${r.why}` }
      : null;
  }

  /** Blocks withdraw open requests between the two people. */
  async onBlock(a: string, b: string) {
    const A = new Types.ObjectId(a);
    const B = new Types.ObjectId(b);
    await ReferralRequestModel.updateMany(
      {
        status: 'pending',
        $or: [
          { requesterId: A, referrerId: B },
          { requesterId: B, referrerId: A },
        ],
      },
      { $set: { status: 'withdrawn' } },
    );
  }

  /** Referrals made (Impact Score, Phase 7). */
  async referredCount(userId: string) {
    return ReferralRequestModel.countDocuments({
      referrerId: new Types.ObjectId(userId),
      status: 'referred',
    });
  }
}
