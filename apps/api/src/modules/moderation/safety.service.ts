import { Types } from 'mongoose';
import type { z } from 'zod';
import { ErrorCode, type REPORT_TARGETS } from '@campuslink/shared';
import type { reportBody, reportsQuery, resolveReportBody } from '@campuslink/shared';
import { BlockModel, ReportModel, type ReportDoc } from './safety.model.js';
import { UserModel } from '../auth/user.model.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { AuthState } from '../../types.js';

/** What another module tells us about a reported item the reporter can see. */
export interface ReportTarget {
  /** Null for content without a member author (library roadmaps). */
  subjectUserId: string | null;
  snapshot: string | null;
}
type TargetResolver = (viewer: AuthState, targetId: string) => Promise<ReportTarget | null>;
type BlockListener = (blockerId: string, blockedId: string) => Promise<void>;

const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;

/** Blocking and reporting, available on every interaction. */
export class SafetyService {
  private readonly onBlockListeners: BlockListener[] = [];
  private readonly onUnblockListeners: BlockListener[] = [];
  private readonly targets = new Map<string, TargetResolver>();

  constructor(private readonly profiles: ProfilesService) {}

  onBlock(fn: BlockListener) {
    this.onBlockListeners.push(fn);
  }
  onUnblock(fn: BlockListener) {
    this.onUnblockListeners.push(fn);
  }
  registerTarget(kind: Exclude<(typeof REPORT_TARGETS)[number], 'user'>, resolver: TargetResolver) {
    this.targets.set(kind, resolver);
  }

  async isBlockedEither(a: string | Types.ObjectId, b: string | Types.ObjectId): Promise<boolean> {
    return !!(await BlockModel.exists({
      $or: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    }));
  }

  /** Everyone the viewer blocked or was blocked by (hidden from discovery both ways). */
  async hiddenFor(userId: string): Promise<Set<string>> {
    const rows = await BlockModel.find({ $or: [{ blockerId: userId }, { blockedId: userId }] })
      .select('blockerId blockedId')
      .lean();
    return new Set(rows.map((r) => String(String(r.blockerId) === userId ? r.blockedId : r.blockerId)));
  }

  async myBlocks(viewer: AuthState) {
    const rows = await BlockModel.find({ blockerId: viewer.userId }).sort({ _id: -1 }).limit(200).lean();
    const refs = await this.profiles.refsFor(rows.map((r) => r.blockedId));
    return rows.map((r) => ({
      user: refs.get(String(r.blockedId)),
      blockedAt: (r as unknown as { createdAt: Date }).createdAt,
    }));
  }

  async block(viewer: AuthState, userId: string) {
    if (userId === viewer.userId) throw badRequest('You cannot block yourself');
    if (!(await UserModel.exists({ _id: userId }))) throw notFound('Member');
    try {
      await BlockModel.create({
        blockerId: new Types.ObjectId(viewer.userId),
        blockedId: new Types.ObjectId(userId),
      });
    } catch (e) {
      if (!isDuplicate(e)) throw e;
      return { blocked: true };
    }
    // Close every open channel between the two (conversation, pending requests, future sessions).
    for (const fn of this.onBlockListeners) await fn(viewer.userId, userId);
    return { blocked: true };
  }

  async unblock(viewer: AuthState, userId: string) {
    const r = await BlockModel.deleteOne({ blockerId: viewer.userId, blockedId: userId });
    if (r.deletedCount && !(await this.isBlockedEither(viewer.userId, userId)))
      for (const fn of this.onUnblockListeners) await fn(viewer.userId, userId);
    return { blocked: false };
  }

  async report(viewer: AuthState, body: z.output<typeof reportBody>) {
    let target: ReportTarget | null;
    if (body.targetType === 'user') {
      target =
        body.targetId !== viewer.userId && (await UserModel.exists({ _id: body.targetId }))
          ? { subjectUserId: body.targetId, snapshot: null }
          : null;
    } else {
      target = (await this.targets.get(body.targetType)?.(viewer, body.targetId)) ?? null;
    }
    // Same answer for "does not exist" and "not yours to report" (no probing).
    if (!target) throw notFound('Item');
    try {
      const doc = await ReportModel.create({
        reporterId: new Types.ObjectId(viewer.userId),
        targetType: body.targetType,
        targetId: new Types.ObjectId(body.targetId),
        subjectUserId: target.subjectUserId ? new Types.ObjectId(target.subjectUserId) : null,
        reason: body.reason,
        note: body.note ?? '',
        snapshot: target.snapshot,
      });
      return { id: String(doc._id), status: 'open' as const };
    } catch (e) {
      if (isDuplicate(e)) throw conflict('You already reported this. Our moderators will review it.');
      throw e;
    }
  }

  async openReportCount() {
    return ReportModel.countDocuments({ status: 'open' });
  }

  async listReports(q: z.output<typeof reportsQuery>) {
    const rows = await ReportModel.find({
      status: q.status,
      ...(q.cursor ? { _id: { $lt: new Types.ObjectId(q.cursor) } } : {}),
    })
      .sort({ _id: -1 })
      .limit(31)
      .lean<ReportDoc[]>();
    const page = rows.slice(0, 30);
    const refs = await this.profiles.refsFor(
      page.flatMap((r) => (r.subjectUserId ? [r.reporterId, r.subjectUserId] : [r.reporterId])),
    );
    return {
      items: page.map((r) => ({
        id: String(r._id),
        targetType: r.targetType,
        targetId: String(r.targetId),
        reason: r.reason,
        note: r.note,
        snapshot: r.snapshot,
        status: r.status,
        outcome: r.outcome,
        reporter: refs.get(String(r.reporterId)),
        subject: r.subjectUserId ? refs.get(String(r.subjectUserId)) : undefined,
        createdAt: r.createdAt,
      })),
      nextCursor: rows.length > 30 ? String(page.at(-1)?._id) : null,
    };
  }

  async resolveReport(
    actor: AuthState,
    id: string,
    body: z.output<typeof resolveReportBody>,
    meta: RequestMetaLite,
  ) {
    const r = await ReportModel.findOneAndUpdate(
      { _id: id, status: 'open' },
      {
        $set: {
          status: 'resolved',
          outcome: body.outcome,
          resolvedBy: new Types.ObjectId(actor.userId),
          resolvedAt: new Date(),
          resolutionNote: body.note ?? null,
        },
      },
      { returnDocument: 'after' },
    ).lean();
    if (!r) throw new AppError(404, ErrorCode.NOT_FOUND, 'Open report not found');
    await audit.record(
      {
        action: 'report.resolved',
        actorId: actor.userId,
        targetType: 'report',
        targetId: id,
        meta: { outcome: body.outcome, targetType: r.targetType },
      },
      meta,
    );
    return { id, status: r.status, outcome: r.outcome };
  }
}
