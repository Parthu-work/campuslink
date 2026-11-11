import { Schema, Types } from 'mongoose';
import type { z } from 'zod';
import type { ParentDigestView, ParentLanguage, parentDigestBody } from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { requireTenantId, withPlatformScope } from '../../lib/context.js';
import type { FieldCipher } from '../../lib/crypto.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { Logger } from '../../lib/logger.js';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { TenantModel } from '../tenants/tenant.model.js';
import { UserModel } from '../auth/user.model.js';
import type { OtpService } from '../verification/otp.service.js';
import type { ChannelService } from './channels/channel.service.js';

export const PARENT_DIGEST_JOB = 'notifications.parent_digest';
const IST_MS = 5.5 * 3600_000;
const monthOf = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 7);

/**
 * A student's parent digest (prompt 2, G8): the parent's number (encrypted), confirmed by a code
 * the parent receives, and what to include. Student-initiated and revocable: stopping deletes it.
 */
interface ParentDigestDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  phoneEnc: string;
  phoneLast4: string;
  language: ParentLanguage;
  includeGrades: boolean;
  status: 'pending' | 'active';
  challengeId: string | null;
  confirmedAt: Date | null;
  lastMonth: string | null;
  lastSentAt: Date | null;
  lastScore: number | null;
}
const schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    phoneEnc: { type: String, required: true },
    phoneLast4: { type: String, required: true },
    language: { type: String, enum: ['en', 'te', 'hi'], default: 'en' },
    includeGrades: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'active'], default: 'pending' },
    challengeId: { type: String, default: null },
    confirmedAt: { type: Date, default: null },
    lastMonth: { type: String, default: null },
    lastSentAt: { type: Date, default: null },
    lastScore: { type: Number, default: null },
  },
  baseSchemaOptions,
);
schema.index({ tenantId: 1, userId: 1 }, { unique: true });
schema.index({ tenantId: 1, status: 1, lastMonth: 1 });
export const ParentDigestModel = defineTenantModel('ParentDigest', schema);

export interface ParentDigestDeps {
  otp: OtpService;
  cipher: FieldCipher;
  channels: ChannelService;
  logger: Logger;
  /** This month's counts for the student, from the modules that own them. */
  facts: (
    userId: string,
    since: Date,
  ) => Promise<{ drives: number; sessions: number; score: number | null; cgpa: number | null }>;
}

/**
 * The monthly parent digest (prompt 2, G8): a student adds a parent's number and language; the
 * parent gets a code and the student enters it, so nothing is sent to a number that did not agree.
 * Once a month (from the 1st, India time) the parent gets the student's drive registrations,
 * sessions attended and readiness trend on WhatsApp: no messages, and grades only if the student
 * chose to include them. The student can stop it at any time (the number is then deleted).
 */
export class ParentDigestService {
  constructor(private readonly d: ParentDigestDeps) {}

  private view(doc: ParentDigestDoc | null): ParentDigestView {
    return {
      status: doc?.status ?? 'none',
      phoneLast4: doc?.phoneLast4 ?? null,
      language: doc?.language ?? 'en',
      includeGrades: doc?.includeGrades ?? false,
      lastSentAt: doc?.lastSentAt?.toISOString() ?? null,
    };
  }

  private load(userId: string) {
    return ParentDigestModel.findOne({ userId: new Types.ObjectId(userId) }).lean<ParentDigestDoc>();
  }

  async get(viewer: AuthState): Promise<ParentDigestView> {
    return this.view(await this.load(viewer.userId));
  }

  /** Starts (or restarts) with a number: a code goes to the parent, and nothing else until it is entered. */
  async start(
    viewer: AuthState,
    body: z.output<typeof parentDigestBody>,
    meta: RequestMetaLite,
  ): Promise<ParentDigestView> {
    if (!(await this.d.channels.invitesUsable()))
      throw badRequest('WhatsApp is not set up for this college, so the parent summary cannot be sent');
    const ch = await this.d.otp.issue({ purpose: 'parent_digest', userId: viewer.userId, phone: body.phone });
    await this.d.otp.sendToPhone(ch.id, body.phone, ch.code, body.language);
    await ParentDigestModel.updateOne(
      { userId: new Types.ObjectId(viewer.userId) },
      {
        $set: {
          phoneEnc: this.d.cipher.encrypt(body.phone),
          phoneLast4: body.phone.slice(-4),
          language: body.language,
          includeGrades: body.includeGrades,
          status: 'pending',
          challengeId: ch.id,
          confirmedAt: null,
        },
      },
      { upsert: true },
    );
    await audit.record(
      { action: 'parent_digest.started', actorId: viewer.userId, meta: { language: body.language } },
      meta,
    );
    return this.get(viewer);
  }

  /** The student enters the code the parent received: the digest is on. */
  async confirm(viewer: AuthState, code: string, meta: RequestMetaLite): Promise<ParentDigestView> {
    const doc = await this.load(viewer.userId);
    if (!doc?.challengeId || doc.status !== 'pending') throw notFound('Parent summary');
    await this.d.otp.check(doc.challengeId, ['parent_digest'], code, { userId: viewer.userId });
    await ParentDigestModel.updateOne(
      { _id: doc._id },
      { $set: { status: 'active', confirmedAt: new Date(), challengeId: null } },
    );
    await audit.record({ action: 'parent_digest.confirmed', actorId: viewer.userId }, meta);
    return this.get(viewer);
  }

  async setGrades(viewer: AuthState, includeGrades: boolean): Promise<ParentDigestView> {
    const r = await ParentDigestModel.updateOne(
      { userId: new Types.ObjectId(viewer.userId) },
      { $set: { includeGrades } },
    );
    if (!r.matchedCount) throw notFound('Parent summary');
    return this.get(viewer);
  }

  /** Stops it: the number is deleted. */
  async stop(viewer: AuthState, meta: RequestMetaLite): Promise<ParentDigestView> {
    await ParentDigestModel.deleteOne({ userId: new Types.ObjectId(viewer.userId) });
    await audit.record({ action: 'parent_digest.stopped', actorId: viewer.userId }, meta);
    return this.view(null);
  }

  /** The scheduler (prompt 4, P5): colleges with at least one confirmed parent digest. */
  static async activeTenantIds(): Promise<Set<string>> {
    const ids = await withPlatformScope('scheduler:parent-digest-active', () =>
      ParentDigestModel.distinct('tenantId', { status: 'active' }),
    );
    return new Set(ids.map(String));
  }

  /** Queues this month's run per college (from the 1st, India time; job ids dedupe per month). */
  static async enqueueMonthly(jobs: JobQueue, now = new Date(), only?: ReadonlySet<string>): Promise<number> {
    const month = monthOf(now);
    const tenants = (
      await TenantModel.find({ kind: 'college', status: 'active' }).select('_id').lean()
    ).filter((t) => !only || only.has(String(t._id)));
    for (const t of tenants)
      await jobs.enqueue(
        PARENT_DIGEST_JOB,
        { tenantId: String(t._id), month },
        { jobId: `parent-digest-${String(t._id)}-${month.replace('-', '')}` },
      );
    return tenants.length;
  }

  /** Job: this month's digest for every active one not yet sent this month (claimed before sending). */
  async run(job: TenantJob): Promise<{ sent: number }> {
    const month = typeof job.month === 'string' ? job.month : monthOf(new Date());
    const since = new Date(`${month}-01T00:00:00+05:30`);
    // Last month's figures, sent at the start of this month.
    const from = new Date(since);
    from.setUTCMonth(from.getUTCMonth() - 1);
    let sent = 0;
    const docs = await ParentDigestModel.find({ status: 'active', lastMonth: { $ne: month } })
      .limit(20_000)
      .lean<ParentDigestDoc[]>();
    for (const doc of docs) {
      const claim = await ParentDigestModel.updateOne(
        { _id: doc._id, status: 'active', lastMonth: { $ne: month } },
        { $set: { lastMonth: month } },
      );
      if (!claim.modifiedCount) continue;
      const user = await UserModel.findById(doc.userId)
        .select('name status')
        .lean<{ name: string; status: string }>();
      if (!user || user.status !== 'active') continue;
      const f = await this.d.facts(String(doc.userId), from);
      const trend =
        f.score === null
          ? ''
          : doc.lastScore === null
            ? `${f.score}/100`
            : `${f.score}/100 (${f.score - doc.lastScore >= 0 ? '+' : ''}${f.score - doc.lastScore})`;
      const outcome = await this.d.channels.sendParentDigest(
        this.d.cipher.decrypt(doc.phoneEnc),
        {
          name: user.name.trim().split(/\s+/)[0] ?? '',
          drives: String(f.drives),
          sessions: String(f.sessions),
          trend,
          grades: doc.includeGrades && f.cgpa !== null ? `CGPA ${f.cgpa.toFixed(2)}` : '',
        },
        doc.language,
      );
      if (outcome === 'sent') {
        sent++;
        await ParentDigestModel.updateOne(
          { _id: doc._id },
          { $set: { lastSentAt: new Date(), lastScore: f.score } },
        );
      } else {
        // Not sent (the allowance, WhatsApp off): tried again next month, not twice this month.
        this.d.logger.info({ outcome, tenantId: String(requireTenantId()) }, 'parent digest not sent');
      }
    }
    return { sent };
  }

  async exportFor(userId: string) {
    const doc = await this.load(userId);
    return {
      parentDigest: doc
        ? {
            phoneLast4: doc.phoneLast4,
            language: doc.language,
            includeGrades: doc.includeGrades,
            status: doc.status,
            lastSentAt: doc.lastSentAt,
          }
        : null,
    };
  }

  async eraseFor(userId: string) {
    await ParentDigestModel.deleteMany({ userId: new Types.ObjectId(userId) });
  }
}
