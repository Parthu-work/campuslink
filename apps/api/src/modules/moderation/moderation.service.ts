import { Types } from 'mongoose';
import type { z } from 'zod';
import type {
  ContentTarget,
  RemovalReason,
  RemovalView,
  appealDecisionBody,
  moderateBody,
} from '@campuslink/shared';
import { AppealModel, ModerationActionModel, type AppealDoc } from './moderation.model.js';
import { ReportModel } from './safety.model.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { ErrorCode } from '@campuslink/shared';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { AuthState } from '../../types.js';

export interface Removal {
  reason: RemovalReason;
  note: string;
  by: Types.ObjectId;
  at: Date;
}

/** What each content module exposes so moderation can work on it without touching its models. */
export interface ModeratableHandler {
  /** Any status (moderators see everything). `context` holds ids for links (postId, questionId). */
  load(
    id: string,
  ): Promise<{ authorId: string; status: string; snapshot: string; context: Record<string, string> } | null>;
  /** Removes (with a removal) or restores (null). Returns false when the state did not change. */
  setRemoved(id: string, removal: Removal | null): Promise<boolean>;
}

const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;
export const isModerator = (viewer: AuthState) => viewer.permissions.has('moderation:act');

/**
 * Moderation for every kind of user content: remove and restore with a reason the author sees,
 * one appeal per removal (decided by a different moderator), and an append-only action log.
 * Moderators never browse private conversations: message reports carry snapshots (SafetyService).
 */
export class ModerationService {
  private readonly handlers = new Map<ContentTarget, ModeratableHandler>();
  constructor(private readonly d: { notifications: NotificationsService; profiles: ProfilesService }) {}

  register(type: ContentTarget, handler: ModeratableHandler) {
    this.handlers.set(type, handler);
  }

  private handler(type: ContentTarget) {
    const h = this.handlers.get(type);
    if (!h) throw new Error(`No moderation handler for ${type}`);
    return h;
  }

  /** Removal details for the author and moderators (with appeal state), keyed by content id. */
  async removalViews(
    type: ContentTarget,
    docs: { _id: Types.ObjectId; status: string; removal?: Removal | null }[],
  ): Promise<Map<string, RemovalView>> {
    const removed = docs.filter((d) => d.status === 'removed' && d.removal);
    if (!removed.length) return new Map();
    const appeals = await AppealModel.find({
      targetType: type,
      targetId: { $in: removed.map((d) => d._id) },
    }).lean<AppealDoc[]>();
    const byId = new Map(appeals.map((a) => [String(a.targetId), a]));
    return new Map(
      removed.map((d) => {
        const a = byId.get(String(d._id));
        const r = d.removal as Removal;
        return [
          String(d._id),
          {
            reason: r.reason,
            note: r.note,
            at: r.at.toISOString(),
            appeal: a
              ? {
                  status: a.status as 'open' | 'upheld' | 'reversed',
                  message: a.message,
                  decisionNote: a.decisionNote ?? null,
                }
              : null,
          },
        ];
      }),
    );
  }

  private async record(
    actor: AuthState,
    entry: {
      targetType: ContentTarget;
      targetId: string;
      subjectUserId: string | null;
      action: 'remove' | 'restore' | 'approve' | 'reject' | 'publish' | 'appeal_upheld' | 'appeal_reversed';
      reason?: RemovalReason | null;
      note?: string;
      reportId?: string | null;
    },
    meta: RequestMetaLite,
  ) {
    await ModerationActionModel.create({
      actorId: new Types.ObjectId(actor.userId),
      targetType: entry.targetType,
      targetId: new Types.ObjectId(entry.targetId),
      subjectUserId: entry.subjectUserId ? new Types.ObjectId(entry.subjectUserId) : null,
      action: entry.action,
      reason: entry.reason ?? null,
      note: entry.note ?? '',
      reportId: entry.reportId ? new Types.ObjectId(entry.reportId) : null,
    });
    await audit.record(
      {
        action: `moderation.${entry.action}`,
        actorId: actor.userId,
        targetType: entry.targetType,
        targetId: entry.targetId,
        meta: { reason: entry.reason ?? null },
      },
      meta,
    );
  }

  /** Public hook for other modules (question approval, held items) to log decisions. */
  async log(actor: AuthState, entry: Parameters<ModerationService['record']>[1], meta: RequestMetaLite) {
    await this.record(actor, entry, meta);
  }

  async act(actor: AuthState, body: z.output<typeof moderateBody>, meta: RequestMetaLite) {
    const h = this.handler(body.targetType);
    const item = await h.load(body.targetId);
    if (!item) throw notFound('Content');
    const removing = body.action === 'remove';
    if (removing && item.status === 'removed') throw conflict('Already removed');
    if (!removing && item.status !== 'removed') throw conflict('This is not removed');
    const changed = await h.setRemoved(
      body.targetId,
      removing
        ? {
            reason: body.reason as RemovalReason,
            note: body.note ?? '',
            by: new Types.ObjectId(actor.userId),
            at: new Date(),
          }
        : null,
    );
    if (!changed) throw conflict('This just changed. Refresh and try again.');
    await this.record(
      actor,
      {
        targetType: body.targetType,
        targetId: body.targetId,
        subjectUserId: item.authorId,
        action: body.action,
        reason: body.reason ?? null,
        note: body.note ?? '',
        reportId: body.reportId ?? null,
      },
      meta,
    );
    if (body.reportId)
      await ReportModel.updateOne(
        { _id: body.reportId, status: 'open' },
        {
          $set: {
            status: 'resolved',
            outcome: removing ? 'actioned' : 'dismissed',
            resolvedBy: new Types.ObjectId(actor.userId),
            resolvedAt: new Date(),
          },
        },
      );
    // Also close every other open report about the same item once it is removed.
    if (removing)
      await ReportModel.updateMany(
        { targetType: body.targetType, targetId: new Types.ObjectId(body.targetId), status: 'open' },
        {
          $set: {
            status: 'resolved',
            outcome: 'actioned',
            resolvedBy: new Types.ObjectId(actor.userId),
            resolvedAt: new Date(),
          },
        },
      );
    if (item.authorId)
      await this.d.notifications.notify(item.authorId, removing ? 'content_removed' : 'content_restored', {
        contentType: body.targetType,
        contentId: body.targetId,
        ...(body.reason ? { reason: body.reason } : {}),
        ...item.context,
      });
    return { status: removing ? 'removed' : 'published' };
  }

  async appeal(viewer: AuthState, type: ContentTarget, id: string, message: string) {
    const item = await this.handler(type).load(id);
    if (!item || item.authorId !== viewer.userId) throw notFound('Content');
    if (item.status !== 'removed') throw conflict('Only removed content can be appealed');
    try {
      const a = await AppealModel.create({
        targetType: type,
        targetId: new Types.ObjectId(id),
        authorId: new Types.ObjectId(viewer.userId),
        message,
      });
      return { id: String(a._id), status: 'open' as const };
    } catch (e) {
      if (isDuplicate(e)) throw conflict('You already appealed this decision');
      throw e;
    }
  }

  async appeals(status: 'open' | 'decided', cursor?: string) {
    const rows = await AppealModel.find({
      status: status === 'open' ? 'open' : { $ne: 'open' },
      ...(cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {}),
    })
      .sort({ _id: -1 })
      .limit(31)
      .lean<AppealDoc[]>();
    const page = rows.slice(0, 30);
    const refs = await this.d.profiles.refsFor(page.map((a) => a.authorId));
    const items = await Promise.all(
      page.map(async (a) => {
        const item = await this.handlers.get(a.targetType as ContentTarget)?.load(String(a.targetId));
        const removal = await ModerationActionModel.findOne({
          targetType: a.targetType,
          targetId: a.targetId,
          action: 'remove',
        })
          .sort({ _id: -1 })
          .lean();
        return {
          id: String(a._id),
          targetType: a.targetType,
          targetId: String(a.targetId),
          author: refs.get(String(a.authorId)),
          message: a.message,
          status: a.status,
          snapshot: item?.snapshot ?? '',
          context: item?.context ?? {},
          removal: removal
            ? { reason: removal.reason, note: removal.note, by: String(removal.actorId) }
            : null,
          createdAt: a.createdAt.toISOString(),
        };
      }),
    );
    return { items, nextCursor: rows.length > 30 ? String(page.at(-1)?._id) : null };
  }

  async decideAppeal(
    actor: AuthState,
    id: string,
    body: z.output<typeof appealDecisionBody>,
    meta: RequestMetaLite,
  ) {
    const a = await AppealModel.findOne({ _id: id, status: 'open' }).lean<AppealDoc>();
    if (!a) throw notFound('Open appeal');
    const lastRemoval = await ModerationActionModel.findOne({
      targetType: a.targetType,
      targetId: a.targetId,
      action: 'remove',
    })
      .sort({ _id: -1 })
      .lean();
    // A second pair of eyes: the moderator who removed it cannot uphold their own decision.
    if (body.decision === 'uphold' && lastRemoval && String(lastRemoval.actorId) === actor.userId)
      throw new AppError(
        409,
        ErrorCode.CONFLICT,
        'Another moderator must review an appeal against your own decision',
      );
    const type = a.targetType as ContentTarget;
    const item = await this.handler(type).load(String(a.targetId));
    if (body.decision === 'reverse') await this.handler(type).setRemoved(String(a.targetId), null);
    const done = await AppealModel.findOneAndUpdate(
      { _id: a._id, status: 'open' },
      {
        $set: {
          status: body.decision === 'reverse' ? 'reversed' : 'upheld',
          decidedBy: new Types.ObjectId(actor.userId),
          decisionNote: body.note ?? null,
          decidedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    ).lean<AppealDoc>();
    if (!done) throw conflict('This appeal was just decided');
    await this.record(
      actor,
      {
        targetType: type,
        targetId: String(a.targetId),
        subjectUserId: String(a.authorId),
        action: body.decision === 'reverse' ? 'appeal_reversed' : 'appeal_upheld',
        note: body.note ?? '',
      },
      meta,
    );
    await this.d.notifications.notify(a.authorId, 'appeal_decided', {
      contentType: type,
      contentId: String(a.targetId),
      decision: body.decision,
      ...(item?.context ?? {}),
    });
    return { id, status: done.status };
  }

  async history(type: ContentTarget, id: string) {
    const rows = await ModerationActionModel.find({ targetType: type, targetId: new Types.ObjectId(id) })
      .sort({ _id: -1 })
      .limit(50)
      .lean();
    const refs = await this.d.profiles.refsFor(rows.map((r) => r.actorId));
    return rows.map((r) => ({
      action: r.action,
      reason: r.reason,
      note: r.note,
      actor: refs.get(String(r.actorId)),
      at: (r as unknown as { createdAt: Date }).createdAt.toISOString(),
    }));
  }

  /** Snapshot for reports on content (SafetyService target resolver). */
  async reportTarget(type: ContentTarget, viewer: AuthState, id: string) {
    const item = await this.handlers.get(type)?.load(id);
    if (!item || item.status !== 'published' || item.authorId === viewer.userId) return null;
    return { subjectUserId: item.authorId, snapshot: item.snapshot.slice(0, 2500) };
  }

  async openAppealCount() {
    return AppealModel.countDocuments({ status: 'open' });
  }
}
