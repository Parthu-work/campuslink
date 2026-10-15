import { Types } from 'mongoose';
import type { z } from 'zod';
import type { ConversationView, MessageView, messagesQuery } from '@campuslink/shared';
import {
  ConversationModel,
  MessageModel,
  type ConversationDoc,
  type MessageDoc,
} from './conversation.model.js';
import { conflict, notFound } from '../../lib/errors.js';
import { requireTenantId } from '../../lib/context.js';
import type { FieldCipher } from '../../lib/crypto.js';
import type { RealtimeGateway } from '../../http/realtime.js';
import { safeFileName, type FilesService } from '../files/files.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { ReportTarget } from '../moderation/safety.service.js';
import type { AuthState } from '../../types.js';

const EMAIL_THROTTLE_MS = 30 * 60_000;
const pairKey = (a: string, b: string) => [a, b].sort().join('|');

export interface MessagingDeps {
  cipher: FieldCipher;
  files: FilesService;
  profiles: ProfilesService;
  notifications: NotificationsService;
  realtime: RealtimeGateway;
}

/**
 * 1:1 conversations between a mentor and a mentee. A conversation is created only when a
 * request is accepted; participants are the only readers (everyone else gets 404, including
 * admins and the platform operator).
 */
export class MessagingService {
  constructor(private readonly d: MessagingDeps) {}

  /** Called on acceptance. Reopens nothing that a block closed. */
  async openFor(mentorId: string, menteeId: string): Promise<string> {
    const key = pairKey(mentorId, menteeId);
    const c = await ConversationModel.findOneAndUpdate(
      { pairKey: key },
      {
        $setOnInsert: {
          pairKey: key,
          participants: [new Types.ObjectId(mentorId), new Types.ObjectId(menteeId)],
          status: 'open',
        },
      },
      { upsert: true, returnDocument: 'after' },
    ).lean();
    return String(c?._id);
  }

  async conversationFor(a: string, b: string): Promise<string | null> {
    const c = await ConversationModel.findOne({ pairKey: pairKey(a, b) })
      .select('_id')
      .lean();
    return c ? String(c._id) : null;
  }

  private async mine(viewer: AuthState, id: string): Promise<ConversationDoc> {
    const c = await ConversationModel.findOne({
      _id: id,
      participants: viewer.userId,
    }).lean<ConversationDoc>();
    if (!c) throw notFound('Conversation');
    return c;
  }

  private other(c: ConversationDoc, me: string): string {
    return String(c.participants.find((p) => String(p) !== me) ?? '');
  }

  private messageView(m: MessageDoc): MessageView {
    return {
      id: String(m._id),
      conversationId: String(m.conversationId),
      senderId: String(m.senderId),
      body: m.bodyEnc ? this.d.cipher.decrypt(m.bodyEnc) : '',
      attachment: m.attachment?.fileId
        ? {
            fileId: String(m.attachment.fileId),
            name: m.attachment.name ?? 'attachment',
            mime: m.attachment.mime ?? 'application/octet-stream',
            size: m.attachment.size ?? 0,
          }
        : null,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private async unreadFor(c: ConversationDoc, me: string): Promise<number> {
    const read = c.reads.find((r) => String(r.userId) === me);
    return MessageModel.countDocuments({
      conversationId: c._id,
      senderId: { $ne: new Types.ObjectId(me) },
      ...(read?.lastReadId ? { _id: { $gt: read.lastReadId } } : {}),
    });
  }

  async list(viewer: AuthState): Promise<ConversationView[]> {
    const rows = await ConversationModel.find({ participants: viewer.userId })
      .sort({ lastMessageAt: -1, _id: -1 })
      .limit(100)
      .lean<ConversationDoc[]>();
    const refs = await this.d.profiles.refsFor(rows.map((c) => this.other(c, viewer.userId)));
    return Promise.all(
      rows.map(async (c) => {
        const otherId = this.other(c, viewer.userId);
        const theirs = c.reads.find((r) => String(r.userId) === otherId);
        return {
          id: String(c._id),
          other: refs.get(otherId) ?? { userId: otherId, name: '', avatarFileId: null },
          status: c.status as 'open' | 'blocked',
          lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
          unread: await this.unreadFor(c, viewer.userId),
          otherReadAt: theirs?.readAt ? theirs.readAt.toISOString() : null,
        };
      }),
    );
  }

  async unreadTotal(viewer: AuthState) {
    const rows = await ConversationModel.find({ participants: viewer.userId })
      .limit(100)
      .lean<ConversationDoc[]>();
    let total = 0;
    for (const c of rows) total += await this.unreadFor(c, viewer.userId);
    return { total };
  }

  async get(viewer: AuthState, id: string): Promise<ConversationView> {
    const c = await this.mine(viewer, id);
    const otherId = this.other(c, viewer.userId);
    const refs = await this.d.profiles.refsFor([otherId]);
    const theirs = c.reads.find((r) => String(r.userId) === otherId);
    return {
      id: String(c._id),
      other: refs.get(otherId) ?? { userId: otherId, name: '', avatarFileId: null },
      status: c.status as 'open' | 'blocked',
      lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
      unread: await this.unreadFor(c, viewer.userId),
      otherReadAt: theirs?.readAt ? theirs.readAt.toISOString() : null,
    };
  }

  async messages(viewer: AuthState, id: string, q: z.output<typeof messagesQuery>) {
    const c = await this.mine(viewer, id);
    const rows = await MessageModel.find({
      conversationId: c._id,
      ...(q.before ? { _id: { $lt: new Types.ObjectId(q.before) } } : {}),
    })
      .sort({ _id: -1 })
      .limit(q.limit + 1)
      .lean<MessageDoc[]>();
    const page = rows.slice(0, q.limit);
    return {
      items: page.reverse().map((m) => this.messageView(m)),
      nextCursor: rows.length > q.limit ? String(rows[q.limit - 1]?._id) : null,
    };
  }

  private async deliver(c: ConversationDoc, sender: AuthState, m: MessageDoc) {
    const tenantId = requireTenantId();
    const v = this.messageView(m);
    const otherId = this.other(c, sender.userId);
    // Both participants' devices (the sender's other tabs too) get the message live.
    this.d.realtime.emitToUser(tenantId, otherId, 'message:new', v);
    this.d.realtime.emitToUser(tenantId, sender.userId, 'message:new', v);
    const last = c.emailedAt.find((e) => String(e.userId) === otherId)?.at;
    const noEmail = !!last && Date.now() - last.getTime() < EMAIL_THROTTLE_MS;
    const refs = await this.d.profiles.refsFor([sender.userId]);
    const { emailQueued } = await this.d.notifications.notify(
      otherId,
      'new_message',
      { name: refs.get(sender.userId)?.name ?? '', conversationId: String(c._id) },
      { noEmail },
    );
    if (emailQueued) {
      const uid = new Types.ObjectId(otherId);
      await ConversationModel.updateOne({ _id: c._id }, { $pull: { emailedAt: { userId: uid } } });
      await ConversationModel.updateOne(
        { _id: c._id },
        { $push: { emailedAt: { userId: uid, at: new Date() } } },
      );
    }
    return v;
  }

  private async writable(viewer: AuthState, id: string) {
    const c = await this.mine(viewer, id);
    if (c.status !== 'open') throw conflict('This conversation is closed');
    return c;
  }

  async send(viewer: AuthState, id: string, body: string): Promise<MessageView> {
    const c = await this.writable(viewer, id);
    const m = await MessageModel.create({
      conversationId: c._id,
      senderId: new Types.ObjectId(viewer.userId),
      bodyEnc: this.d.cipher.encrypt(body),
    });
    await ConversationModel.updateOne({ _id: c._id }, { $set: { lastMessageAt: m.createdAt } });
    await this.markReadUpTo(c, viewer.userId, m._id, false);
    return this.deliver(c, viewer, m.toObject() as MessageDoc);
  }

  async sendAttachment(viewer: AuthState, id: string, data: Buffer, originalName: string, body: string) {
    const c = await this.writable(viewer, id);
    const file = await this.d.files.storeAttachment(viewer.userId, data);
    const ext = file.mime === 'application/pdf' ? '.pdf' : '.webp';
    const name = safeFileName(originalName.replace(/\.[A-Za-z0-9]{1,5}$/, ''), 'attachment') + ext;
    const m = await MessageModel.create({
      conversationId: c._id,
      senderId: new Types.ObjectId(viewer.userId),
      bodyEnc: body ? this.d.cipher.encrypt(body) : null,
      attachment: { fileId: new Types.ObjectId(file.id), name, mime: file.mime, size: file.size },
    });
    await ConversationModel.updateOne({ _id: c._id }, { $set: { lastMessageAt: m.createdAt } });
    await this.markReadUpTo(c, viewer.userId, m._id, false);
    return this.deliver(c, viewer, m.toObject() as MessageDoc);
  }

  private async markReadUpTo(c: ConversationDoc, userId: string, messageId: Types.ObjectId, emit: boolean) {
    const readAt = new Date();
    const uid = new Types.ObjectId(userId);
    const current = c.reads.find((r) => String(r.userId) === userId)?.lastReadId;
    if (current && String(current) >= String(messageId)) return;
    await ConversationModel.updateOne({ _id: c._id }, { $pull: { reads: { userId: uid } } });
    await ConversationModel.updateOne(
      { _id: c._id },
      { $push: { reads: { userId: uid, readAt, lastReadId: messageId } } },
    );
    if (emit)
      this.d.realtime.emitToUser(requireTenantId(), this.other(c, userId), 'message:read', {
        conversationId: String(c._id),
        userId,
        readAt: readAt.toISOString(),
      });
  }

  /** Read receipt up to a message of this conversation. */
  async markRead(viewer: AuthState, id: string, messageId: string) {
    const c = await this.mine(viewer, id);
    const m = await MessageModel.findOne({ _id: messageId, conversationId: c._id }).select('_id').lean();
    if (!m) throw notFound('Message');
    await this.markReadUpTo(c, viewer.userId, m._id, true);
    return { read: true };
  }

  /** Realtime hook: the other participant, when the viewer may type here. */
  async typingTarget(viewer: AuthState, conversationId: string): Promise<string | null> {
    if (!viewer.permissions.has('messages:send')) return null;
    const c = await ConversationModel.findOne({
      _id: conversationId,
      participants: viewer.userId,
      status: 'open',
    }).lean<ConversationDoc>();
    return c ? this.other(c, viewer.userId) : null;
  }

  /** Files hook: attachments are readable by the conversation's participants only. */
  async attachmentAccess(fileId: string, viewer: AuthState): Promise<{ name: string } | null> {
    const m = await MessageModel.findOne({ 'attachment.fileId': fileId }).lean<MessageDoc>();
    if (!m) return null;
    const c = await ConversationModel.exists({ _id: m.conversationId, participants: viewer.userId });
    return c ? { name: m.attachment?.name ?? 'attachment' } : null;
  }

  /** Safety hook: a participant reporting a message they received. */
  async reportTarget(viewer: AuthState, messageId: string): Promise<ReportTarget | null> {
    const m = await MessageModel.findOne({ _id: messageId }).lean<MessageDoc>();
    if (!m || String(m.senderId) === viewer.userId) return null;
    const c = await ConversationModel.exists({ _id: m.conversationId, participants: viewer.userId });
    if (!c) return null;
    const text = m.bodyEnc ? this.d.cipher.decrypt(m.bodyEnc) : '';
    const snapshot = [text, m.attachment?.name ? `[attachment: ${m.attachment.name}]` : '']
      .filter(Boolean)
      .join('\n');
    return { subjectUserId: String(m.senderId), snapshot };
  }

  async setBlocked(a: string, b: string, blocked: boolean) {
    await ConversationModel.updateOne(
      { pairKey: pairKey(a, b) },
      { $set: { status: blocked ? 'blocked' : 'open' } },
    );
  }
}
