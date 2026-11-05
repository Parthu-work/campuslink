import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  MICRO_ASKS_OPEN_MAX,
  MICRO_ASKS_PER_WEEK,
  MICRO_ASK_MAX_TRIES,
  MICRO_ASK_REPLY_HOURS,
  type MicroAskInbox,
  type MicroAskView,
  type PersonRef,
  type microAskBody,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { conflict, forbidden, notFound, tooMany } from '../../lib/errors.js';
import { requireTenantId } from '../../lib/context.js';
import { companyKey } from '../../lib/company.js';
import { plainText } from '../../lib/text.js';
import { noAward, type Award } from '../../lib/awards.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import { MicroAskModel, MicroAskOfferModel, type MicroAskDoc } from './alumni.model.js';
import { MicroAskOptOutModel } from './opt-out.model.js';

export const MICRO_ASK_EXPIRE_JOB = 'alumni.micro_ask_expire';
const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;
const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;
const FORMER = (id: string): PersonRef => ({ userId: id, name: 'Former member', avatarFileId: null });
const OPEN = ['routing', 'assigned', 'accepted'] as const;

export interface MicroAsksDeps {
  profiles: ProfilesService;
  notifications: NotificationsService;
  jobs: JobQueue;
  /** Either member blocked the other (safety). */
  blocked: (a: string, b: string) => Promise<boolean>;
  /** The asker owns this résumé (résumés). */
  ownsResume: (userId: string, resumeId: string) => Promise<boolean>;
  /** The asker may see this Q&A question (Q&A). */
  seesQuestion: (viewer: AuthState, questionId: string) => Promise<boolean>;
}

/**
 * Micro-asks (prompt 2, G6): small favours (review a résumé, answer a question, a quick intro,
 * feedback on a project) routed to one matching alumnus at a time. An alumnus is handed at most
 * MICRO_ASKS_PER_WEEK asks in a rolling week; one who passes or does not reply in
 * MICRO_ASK_REPLY_HOURS hands it on, up to MICRO_ASK_MAX_TRIES alumni. Doing one earns impact XP.
 */
export class MicroAsksService {
  award: Award = noAward;
  track: Track = noTrack;
  constructor(private readonly d: MicroAsksDeps) {}

  // ── Views ─────────────────────────────

  private async views(viewer: AuthState, rows: MicroAskDoc[]): Promise<MicroAskView[]> {
    const refs = await this.d.profiles.refsFor(
      rows.flatMap((r) => [r.fromUserId, r.toUserId].filter((x): x is Types.ObjectId => !!x)),
    );
    return rows.map((r) => {
      const asker = r.fromUserId ? String(r.fromUserId) : '';
      const mine = asker === viewer.userId;
      return {
        id: String(r._id),
        kind: r.kind,
        status: r.status,
        role: mine ? 'asker' : 'helper',
        asker: refs.get(asker) ?? FORMER(asker),
        // The asker sees who has it once they said yes; the helper is the viewer.
        helper:
          r.toUserId && (!mine || r.status === 'accepted' || r.status === 'done')
            ? (refs.get(String(r.toUserId)) ?? FORMER(String(r.toUserId)))
            : null,
        audience: {
          ...(r.audience?.company ? { company: r.audience.company } : {}),
          ...(r.audience?.branch ? { branch: r.audience.branch } : {}),
          ...(r.audience?.topic ? { topic: r.audience.topic } : {}),
        },
        note: r.note,
        resumeId: r.resumeId ? String(r.resumeId) : null,
        questionId: r.questionId ? String(r.questionId) : null,
        expiresAt: r.status === 'assigned' && r.expiresAt ? r.expiresAt.toISOString() : null,
        doneAt: r.doneAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /** The asker's own ask, or one handed to the viewer (now, or done by them). */
  private async readable(viewer: AuthState, id: string): Promise<MicroAskDoc> {
    const r = await MicroAskModel.findById(id).lean<MicroAskDoc>();
    if (!r) throw notFound('Ask');
    if (String(r.fromUserId) === viewer.userId || String(r.toUserId) === viewer.userId) return r;
    throw notFound('Ask');
  }

  async get(viewer: AuthState, id: string): Promise<MicroAskView> {
    return (await this.views(viewer, [await this.readable(viewer, id)]))[0] as MicroAskView;
  }

  async list(viewer: AuthState, box: 'sent' | 'received'): Promise<MicroAskInbox> {
    const me = oid(viewer.userId);
    const rows = await MicroAskModel.find(box === 'sent' ? { fromUserId: me } : { toUserId: me })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<MicroAskDoc[]>();
    const received = await MicroAskOfferModel.countDocuments({
      userId: me,
      createdAt: { $gte: new Date(Date.now() - WEEK) },
    });
    return { asks: await this.views(viewer, rows), week: { received, cap: MICRO_ASKS_PER_WEEK } };
  }

  // ── Asking ─────────────────────────────

  async create(viewer: AuthState, body: z.output<typeof microAskBody>): Promise<MicroAskView> {
    const me = oid(viewer.userId);
    const open = await MicroAskModel.countDocuments({ fromUserId: me, status: { $in: [...OPEN] } });
    if (open >= MICRO_ASKS_OPEN_MAX)
      throw tooMany(`You can have ${MICRO_ASKS_OPEN_MAX} asks open at once. Wait for one to finish.`);
    if (body.resumeId && !(await this.d.ownsResume(viewer.userId, body.resumeId))) throw notFound('Résumé');
    if (body.questionId && !(await this.d.seesQuestion(viewer, body.questionId))) throw notFound('Question');
    const company = body.audience.company ? plainText(body.audience.company) : undefined;
    const ask = await MicroAskModel.create({
      kind: body.kind,
      fromUserId: me,
      audience: {
        ...(company ? { company, companyKey: companyKey(company) } : {}),
        ...(body.audience.branch ? { branch: body.audience.branch } : {}),
        ...(body.audience.topic ? { topic: plainText(body.audience.topic) } : {}),
      },
      resumeId: body.resumeId ? oid(body.resumeId) : null,
      questionId: body.questionId ? oid(body.questionId) : null,
      note: plainText(body.note),
    });
    await this.track(viewer.userId, 'micro_ask_sent', { kind: body.kind });
    await this.route(String(ask._id));
    return this.get(viewer, String(ask._id));
  }

  async cancel(viewer: AuthState, id: string): Promise<MicroAskView> {
    const r = await this.readable(viewer, id);
    if (String(r.fromUserId) !== viewer.userId) throw forbidden();
    const done = await MicroAskModel.updateOne(
      { _id: r._id, status: { $in: [...OPEN] } },
      { $set: { status: 'cancelled', expiresAt: null }, $inc: { version: 1 } },
    );
    if (!done.modifiedCount) throw conflict('This ask is already finished');
    return this.get(viewer, id);
  }

  // ── Routing ─────────────────────────────

  /**
   * Takes one of the alumnus's weekly slots. The rolling-week count keeps them to the cap; the
   * unique slot index makes two hand-overs at once take different slots (or fail).
   */
  private async claimSlot(userId: string, askId: Types.ObjectId): Promise<boolean> {
    const now = Date.now();
    const u = oid(userId);
    const rolling = await MicroAskOfferModel.countDocuments({
      userId: u,
      createdAt: { $gte: new Date(now - WEEK) },
    });
    if (rolling >= MICRO_ASKS_PER_WEEK) return false;
    const week = Math.floor(now / WEEK);
    const thisWeek = await MicroAskOfferModel.countDocuments({
      userId: u,
      createdAt: { $gte: new Date(week * WEEK) },
    });
    if (thisWeek >= MICRO_ASKS_PER_WEEK) return false;
    try {
      await MicroAskOfferModel.create({ userId: u, askId, slot: `${week}:${thisWeek}` });
      return true;
    } catch (e) {
      if (isDuplicate(e)) return false;
      throw e;
    }
  }

  /** Hands the ask to the best matching alumnus who is free, or marks it unmatched. */
  async route(id: string): Promise<void> {
    const ask = await MicroAskModel.findById(id).lean<MicroAskDoc>();
    if (!ask || ask.status !== 'routing' || !ask.fromUserId) return;
    const asker = String(ask.fromUserId);
    if (ask.tried.length < MICRO_ASK_MAX_TRIES) {
      const tried = new Set(ask.tried.map(String));
      const closed = new Set(
        (await MicroAskOptOutModel.find({}).select('userId').limit(10_000).lean()).map((o) =>
          String(o.userId),
        ),
      );
      const candidates = (
        await this.d.profiles.alumniMatching({
          ...(ask.audience?.companyKey ? { companyKey: ask.audience.companyKey } : {}),
          ...(ask.audience?.branch ? { branch: ask.audience.branch } : {}),
          ...(ask.audience?.topic ? { topic: ask.audience.topic } : {}),
        })
      ).filter((u) => u !== asker && !tried.has(u) && !closed.has(u));
      for (const u of candidates.slice(0, 100)) {
        if (await this.d.blocked(asker, u)) continue;
        if (!(await this.claimSlot(u, ask._id))) continue;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + MICRO_ASK_REPLY_HOURS * HOUR);
        const next = await MicroAskModel.findOneAndUpdate(
          { _id: ask._id, status: 'routing', version: ask.version },
          {
            $set: { status: 'assigned', toUserId: oid(u), assignedAt: now, expiresAt },
            $push: { tried: oid(u) },
            $inc: { version: 1 },
          },
          { returnDocument: 'after' },
        ).lean<MicroAskDoc>();
        if (!next) {
          // The ask changed meanwhile (cancelled, or routed by someone else): give the slot back.
          await MicroAskOfferModel.deleteOne({ userId: oid(u), askId: ask._id });
          return;
        }
        const from = (await this.d.profiles.refsFor([ask.fromUserId])).get(asker);
        await this.d.notifications.notify(u, 'micro_ask_received', {
          name: (from?.name ?? '').trim().split(/\s+/)[0] ?? '',
          kind: ask.kind,
          askId: String(ask._id),
        });
        await this.d.jobs.enqueue(
          MICRO_ASK_EXPIRE_JOB,
          { tenantId: String(requireTenantId()), askId: String(ask._id), version: next.version },
          { jobId: `mask-${String(ask._id)}-v${next.version}`, delayMs: MICRO_ASK_REPLY_HOURS * HOUR },
        );
        return;
      }
    }
    const res = await MicroAskModel.updateOne(
      { _id: ask._id, status: 'routing', version: ask.version },
      { $set: { status: 'unmatched', toUserId: null, expiresAt: null }, $inc: { version: 1 } },
    );
    if (res.modifiedCount)
      await this.d.notifications.notify(asker, 'micro_ask_unmatched', {
        askId: String(ask._id),
        kind: ask.kind,
      });
  }

  /** Job: the alumnus did not reply in time, so the ask moves on (unless anything changed). */
  async onExpire(job: TenantJob) {
    const res = await MicroAskModel.updateOne(
      { _id: String(job.askId), status: 'assigned', version: job.version },
      { $set: { status: 'routing', toUserId: null, expiresAt: null }, $inc: { version: 1 } },
    );
    if (res.modifiedCount) await this.route(String(job.askId));
  }

  // ── Helping ─────────────────────────────

  /** The alumnus it is with says yes, passes (it moves on), or marks it done (impact XP). */
  async reply(viewer: AuthState, id: string, action: 'accept' | 'decline' | 'done'): Promise<MicroAskView> {
    const r = await this.readable(viewer, id);
    if (String(r.toUserId) !== viewer.userId) throw forbidden();
    const me = oid(viewer.userId);
    if (action === 'accept') {
      const res = await MicroAskModel.updateOne(
        { _id: r._id, toUserId: me, status: 'assigned' },
        { $set: { status: 'accepted', expiresAt: null }, $inc: { version: 1 } },
      );
      if (!res.modifiedCount && r.status !== 'accepted')
        throw conflict('This ask is no longer waiting for you');
    } else if (action === 'decline') {
      const res = await MicroAskModel.updateOne(
        { _id: r._id, toUserId: me, status: { $in: ['assigned', 'accepted'] } },
        { $set: { status: 'routing', toUserId: null, expiresAt: null }, $inc: { version: 1 } },
      );
      if (!res.modifiedCount) throw conflict('This ask is no longer with you');
      await this.route(id);
      // The helper no longer sees it once it moved on.
      return {
        ...(await this.views(viewer, [{ ...r, status: 'routing', toUserId: null }]))[0],
        helper: null,
      } as MicroAskView;
    } else {
      const res = await MicroAskModel.updateOne(
        { _id: r._id, toUserId: me, status: { $in: ['assigned', 'accepted'] } },
        { $set: { status: 'done', doneAt: new Date(), expiresAt: null }, $inc: { version: 1 } },
      );
      if (!res.modifiedCount) throw conflict('This ask is already finished');
      await this.award(viewer.userId, 'micro_ask_done', id, { from: r.fromUserId });
      await this.track(viewer.userId, 'micro_ask_done', { kind: r.kind });
      if (r.fromUserId) {
        const helper = (await this.d.profiles.refsFor([viewer.userId])).get(viewer.userId);
        await this.d.notifications.notify(r.fromUserId, 'micro_ask_done', {
          name: helper?.name ?? '',
          askId: id,
        });
      }
    }
    return this.get(viewer, id);
  }

  /** Whether the alumnus takes micro-asks at all (on unless they turned it off). */
  async settings(viewer: AuthState) {
    return { open: !(await MicroAskOptOutModel.exists({ userId: oid(viewer.userId) })) };
  }

  async setOpen(viewer: AuthState, open: boolean) {
    const u = oid(viewer.userId);
    if (open) await MicroAskOptOutModel.deleteOne({ userId: u });
    else
      await MicroAskOptOutModel.updateOne(
        { userId: u },
        { $setOnInsert: { userId: u } },
        { upsert: true },
      ).catch((e: unknown) => {
        if (!isDuplicate(e)) throw e;
      });
    return this.settings(viewer);
  }

  /** Résumés (G2): the viewer was handed a review of this résumé (open, or done by them). */
  async reviewsResume(viewer: AuthState, resumeId: string): Promise<boolean> {
    return !!(await MicroAskModel.exists({
      kind: 'review_resume',
      resumeId: oid(resumeId),
      toUserId: oid(viewer.userId),
      status: { $in: ['assigned', 'accepted', 'done'] },
    }));
  }

  /** Recognition: asks the member did in a window. */
  async doneBy(userId: string, from: Date, to: Date): Promise<number> {
    return MicroAskModel.countDocuments({
      toUserId: oid(userId),
      status: 'done',
      doneAt: { $gte: from, $lt: to },
    });
  }

  /** NAAC alumni engagement: asks done in a window, with who did them. */
  async doneBetween(from: Date, to: Date) {
    const rows = await MicroAskModel.find({
      status: 'done',
      doneAt: { $gte: from, $lt: to },
      toUserId: { $ne: null },
    })
      .select('toUserId')
      .limit(100_000)
      .lean<{ toUserId: Types.ObjectId }[]>();
    return rows.map((r) => ({ helperId: String(r.toUserId) }));
  }

  // ── Privacy ─────────────────────────────

  async exportFor(userId: string) {
    const u = oid(userId);
    const [sent, received, closed] = await Promise.all([
      MicroAskModel.find({ fromUserId: u }).select('kind audience note status createdAt doneAt').lean(),
      // Asks handed to the member: what and when, not the asker's note (it is the asker's).
      MicroAskModel.find({ toUserId: u }).select('kind status assignedAt doneAt').lean(),
      MicroAskOptOutModel.exists({ userId: u }),
    ]);
    return { sent, received, takesAsks: !closed };
  }

  /**
   * The member's own asks go. Asks with them as the helper lose the helper: open ones are marked
   * unmatched, done ones stay done (the asker's record) without a name.
   */
  async eraseFor(userId: string) {
    const u = oid(userId);
    await MicroAskModel.deleteMany({ fromUserId: u });
    await MicroAskModel.updateMany(
      { toUserId: u, status: { $in: [...OPEN] } },
      { $set: { status: 'unmatched', toUserId: null, expiresAt: null }, $inc: { version: 1 } },
    );
    await MicroAskModel.updateMany({ toUserId: u }, { $set: { toUserId: null } });
    await MicroAskModel.updateMany({ tried: u }, { $pull: { tried: u } });
    await MicroAskOfferModel.deleteMany({ userId: u });
    await MicroAskOptOutModel.deleteMany({ userId: u });
  }
}
