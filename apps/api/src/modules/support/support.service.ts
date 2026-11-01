import { Types } from 'mongoose';
import {
  Role,
  SUPPORT_LIMITS,
  deskFor,
  type SupportDesk,
  type SupportStatus,
  type SupportTicketView,
} from '@campuslink/shared';
import { SupportTicketModel, type SupportTicketDoc } from './support.model.js';
import { UserModel } from '../auth/user.model.js';
import type { FilesService } from '../files/files.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { UsersService } from '../users/users.service.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { AppError, notFound } from '../../lib/errors.js';
import { plainText } from '../../lib/text.js';
import { runInTenant } from '../../lib/context.js';
import { ErrorCode } from '@campuslink/shared';
import type { AuthState } from '../../types.js';

/** Screenshots are kept this long after they are attached (a report is long settled by then). */
const SCREENSHOT_DAYS = 180;
const PAGE = 50;

interface Deps {
  /** The colleges (PlatformService.listTenants), for the platform's desk. */
  colleges: () => Promise<{ id: string; slug: string; name: string }[]>;
  files: FilesService;
  notifications: NotificationsService;
  users: UsersService;
}

/**
 * Help and support (build B14). A member reports a problem; college matters go to the college's
 * admins (`support:manage`), bugs to the platform owner (`platform:support`). Replies make a short
 * thread. Notifications carry the report's id and category, never its text.
 */
export class SupportService {
  constructor(private readonly d: Deps) {
    // A screenshot is visible to its reporter and to the desk that answers the report.
    d.files.registerAccess('support_screenshot', async (fileId, viewer) => {
      const t = await SupportTicketModel.findOne({ screenshotFileId: new Types.ObjectId(fileId) })
        .select('userId desk')
        .lean();
      if (!t) return null;
      const mine = String(t.userId) === viewer.userId;
      const desk = t.desk === 'college' && viewer.permissions.has('support:manage');
      return mine || desk ? { name: 'screenshot.webp' } : null;
    });
  }

  // ── Members ─────────────────────────────

  async create(
    auth: AuthState,
    body: {
      category: SupportTicketDoc['category'];
      subject: string;
      body: string;
      screenshotFileId?: string;
    },
  ): Promise<SupportTicketView> {
    const open = await SupportTicketModel.countDocuments({
      userId: new Types.ObjectId(auth.userId),
      status: { $ne: 'closed' },
    });
    if (open >= SUPPORT_LIMITS.openPerMember)
      throw new AppError(
        429,
        ErrorCode.RATE_LIMITED,
        'You have several open reports already. Close one, or add to it, before starting another.',
      );
    let screenshot: Types.ObjectId | null = null;
    if (body.screenshotFileId) {
      // Validate first, then claim (single use, the uploader's own, the right purpose).
      if (!(await this.d.files.pending(body.screenshotFileId, auth.userId, 'support_screenshot')))
        throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'Upload the screenshot again');
      const f = await this.d.files.claim(
        body.screenshotFileId,
        auth.userId,
        'support_screenshot',
        new Date(Date.now() + SCREENSHOT_DAYS * 86_400_000),
      );
      screenshot = new Types.ObjectId(f.id);
    }
    const desk = deskFor(body.category);
    const now = new Date();
    const doc = await SupportTicketModel.create({
      userId: new Types.ObjectId(auth.userId),
      category: body.category,
      desk,
      subject: plainText(body.subject),
      body: plainText(body.body),
      screenshotFileId: screenshot,
      status: 'open',
      replies: [],
      lastActivityAt: now,
    });
    if (desk === 'college')
      for (const admin of await this.d.users.activeIdsWithRole(Role.COLLEGE_ADMIN))
        if (admin !== auth.userId)
          await this.d.notifications.notify(admin, 'support_ticket', {
            ticketId: String(doc._id),
            category: body.category,
          });
    return (await this.views([doc.toObject() as SupportTicketDoc]))[0] as SupportTicketView;
  }

  async mine(auth: AuthState): Promise<SupportTicketView[]> {
    const rows = await SupportTicketModel.find({ userId: new Types.ObjectId(auth.userId) })
      .sort({ _id: -1 })
      .limit(PAGE)
      .lean<SupportTicketDoc[]>();
    return this.views(rows);
  }

  async get(auth: AuthState, id: string): Promise<SupportTicketView> {
    const t = await this.visible(auth, id);
    return (await this.views([t]))[0] as SupportTicketView;
  }

  /** The reporter, or the college's desk for a college matter; anyone else gets 404. */
  async reply(auth: AuthState, id: string, text: string): Promise<SupportTicketView> {
    const t = await this.visible(auth, id);
    const mine = String(t.userId) === auth.userId;
    const from = mine ? 'member' : 'college';
    const me = await UserModel.findById(auth.userId).select('name').lean();
    return this.addReply(t, { from, authorId: auth.userId, authorName: me?.name ?? 'Staff' }, text);
  }

  async setStatus(auth: AuthState, id: string, status: Extract<SupportStatus, 'open' | 'closed'>) {
    const t = await this.visible(auth, id);
    await SupportTicketModel.updateOne({ _id: t._id }, { $set: { status, lastActivityAt: new Date() } });
    return this.get(auth, id);
  }

  // ── The college's desk ─────────────────────────────

  async queue(status?: SupportStatus): Promise<SupportTicketView[]> {
    const rows = await SupportTicketModel.find({ desk: 'college', ...(status ? { status } : {}) })
      .sort({ lastActivityAt: -1 })
      .limit(PAGE)
      .lean<SupportTicketDoc[]>();
    return this.views(rows);
  }

  /** Admin overview: reports waiting for the college (open, not yet answered). */
  async openCount(): Promise<number> {
    return SupportTicketModel.countDocuments({ desk: 'college', status: 'open' });
  }

  // ── The platform's desk (bugs) ─────────────────────────────

  /** Bug reports from every college, newest activity first. Read college by college. */
  async platformQueue(status?: SupportStatus): Promise<SupportTicketView[]> {
    const colleges = await this.d.colleges();
    const all: SupportTicketView[] = [];
    for (const c of colleges) {
      const rows = await runInTenant(c.id, async () =>
        this.views(
          await SupportTicketModel.find({ desk: 'platform', ...(status ? { status } : {}) })
            .sort({ lastActivityAt: -1 })
            .limit(PAGE)
            .lean<SupportTicketDoc[]>(),
        ),
      );
      for (const r of rows) all.push({ ...r, college: c });
    }
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, PAGE);
  }

  async platformGet(tenantId: string, id: string, actorId: string, meta: RequestMetaLite) {
    const view = await runInTenant(tenantId, async () => {
      const t = await this.platformTicket(id);
      // The platform reads a member's report only because they sent it to the platform: audited.
      await audit.record(
        { action: 'support.platform_read', actorId, targetType: 'support_ticket', targetId: id },
        meta,
      );
      return (await this.views([t]))[0] as SupportTicketView;
    });
    return view;
  }

  async platformReply(tenantId: string, id: string, authorId: string, text: string, meta: RequestMetaLite) {
    // The platform admin belongs to the platform's own tenant: read their name before switching.
    const me = await UserModel.findById(authorId).select('name').lean();
    const author = { id: authorId, name: me?.name ?? 'Platform team' };
    return runInTenant(tenantId, async () => {
      const t = await this.platformTicket(id);
      await audit.record(
        { action: 'support.platform_reply', actorId: author.id, targetType: 'support_ticket', targetId: id },
        meta,
      );
      return this.addReply(t, { from: 'platform', authorId: author.id, authorName: author.name }, text);
    });
  }

  async platformSetStatus(tenantId: string, id: string, status: 'open' | 'closed') {
    return runInTenant(tenantId, async () => {
      const t = await this.platformTicket(id);
      await SupportTicketModel.updateOne({ _id: t._id }, { $set: { status, lastActivityAt: new Date() } });
    });
  }

  /** The screenshot of a bug report, for the platform's desk. */
  async platformScreenshot(tenantId: string, id: string) {
    return runInTenant(tenantId, async () => {
      const t = await this.platformTicket(id);
      if (!t.screenshotFileId) throw notFound('Screenshot');
      return { data: await this.d.files.read(String(t.screenshotFileId)), mime: 'image/webp' };
    });
  }

  // ── Privacy ─────────────────────────────

  async exportFor(userId: string) {
    return SupportTicketModel.find({ userId: new Types.ObjectId(userId) })
      .select('category desk subject body status replies.from replies.body replies.at createdAt')
      .lean();
  }

  /** A member's reports are about their own problem: they go, with their screenshots. */
  async eraseFor(userId: string) {
    const rows = await SupportTicketModel.find({ userId: new Types.ObjectId(userId) })
      .select('screenshotFileId')
      .lean();
    for (const r of rows) if (r.screenshotFileId) await this.d.files.remove(r.screenshotFileId);
    await SupportTicketModel.deleteMany({ userId: new Types.ObjectId(userId) });
  }

  // ── Internals ─────────────────────────────

  private async visible(auth: AuthState, id: string): Promise<SupportTicketDoc> {
    if (!Types.ObjectId.isValid(id)) throw notFound('Report');
    const t = await SupportTicketModel.findById(id).lean<SupportTicketDoc>();
    if (!t) throw notFound('Report');
    const mine = String(t.userId) === auth.userId;
    const desk = t.desk === 'college' && auth.permissions.has('support:manage');
    if (!mine && !desk) throw notFound('Report');
    return t;
  }

  private async platformTicket(id: string): Promise<SupportTicketDoc> {
    if (!Types.ObjectId.isValid(id)) throw notFound('Report');
    const t = await SupportTicketModel.findOne({ _id: id, desk: 'platform' }).lean<SupportTicketDoc>();
    if (!t) throw notFound('Report');
    return t;
  }

  private async addReply(
    t: SupportTicketDoc,
    r: { from: 'member' | SupportDesk; authorId: string; authorName: string },
    text: string,
  ): Promise<SupportTicketView> {
    if (t.replies.length >= SUPPORT_LIMITS.replies)
      throw new AppError(409, ErrorCode.CONFLICT, 'This report has too many replies; start a new one.');
    const now = new Date();
    // A member's reply reopens the report; a desk's reply marks it answered.
    const status: SupportStatus = r.from === 'member' ? 'open' : 'answered';
    await SupportTicketModel.updateOne(
      { _id: t._id },
      {
        $push: {
          replies: {
            from: r.from,
            authorId: new Types.ObjectId(r.authorId),
            authorName: r.authorName.slice(0, 100),
            body: plainText(text),
            at: now,
          },
        },
        $set: { status, lastActivityAt: now },
      },
    );
    if (r.from !== 'member')
      await this.d.notifications.notify(String(t.userId), 'support_reply', {
        ticketId: String(t._id),
        category: t.category,
      });
    const fresh = await SupportTicketModel.findById(t._id).lean<SupportTicketDoc>();
    if (!fresh) throw notFound('Report');
    return (await this.views([fresh]))[0] as SupportTicketView;
  }

  private async views(rows: SupportTicketDoc[]): Promise<SupportTicketView[]> {
    const ids = [...new Set(rows.map((r) => String(r.userId)))].map((id) => new Types.ObjectId(id));
    const users = ids.length
      ? await UserModel.find({ _id: { $in: ids } })
          .select('name')
          .lean<{ _id: Types.ObjectId; name: string }[]>()
      : [];
    const names = new Map(users.map((u) => [String(u._id), u.name]));
    return rows.map((t) => {
      const name = names.get(String(t.userId));
      return {
        id: String(t._id),
        category: t.category,
        desk: t.desk,
        subject: t.subject,
        body: t.body,
        status: t.status,
        hasScreenshot: !!t.screenshotFileId,
        screenshotFileId: t.screenshotFileId ? String(t.screenshotFileId) : null,
        reporter: name ? { id: String(t.userId), name } : null,
        replies: t.replies.map((r) => ({
          id: String((r as { _id?: Types.ObjectId })._id ?? ''),
          from: r.from,
          name: r.authorName,
          body: r.body,
          at: r.at.toISOString(),
        })),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.lastActivityAt.toISOString(),
      };
    });
  }
}
