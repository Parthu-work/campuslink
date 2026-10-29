import { createHmac, timingSafeEqual } from 'node:crypto';
import { Types } from 'mongoose';
import { SignJWT, jwtVerify } from 'jose';
import {
  CATEGORY_OF,
  type NotificationCategory,
  type NotificationType,
  type WhatsAppStatus,
} from '@campuslink/shared';
import {
  ChannelMessageModel,
  ChannelUsageModel,
  WebhookReceiptModel,
  CHANNEL_STATUSES,
} from './channel.model.js';
import { WHATSAPP_TEMPLATES, AUTO_REPLY, type ChannelAction, type WaLang } from './whatsapp-templates.js';
import type { WhatsAppProvider } from '../../../lib/whatsapp.js';
import type { FieldCipher } from '../../../lib/crypto.js';
import type { Logger } from '../../../lib/logger.js';
import { requireTenantId, runInTenant, withPlatformScope } from '../../../lib/context.js';
import { UserModel } from '../../auth/user.model.js';
import { consentService } from '../../consent/consent.service.js';
import { featureEnabled } from '../../tenants/features.js';
import { findTenantById } from '../../tenants/tenant.cache.js';
import { backgroundAuth } from '../../users/users.service.js';
import type { AuthState } from '../../../types.js';
import { maskPhone } from '../../imports/whitelist.service.js';

/** Non-critical WhatsApp messages a member gets per rolling week (fair use, B3). */
export const MEMBER_WEEKLY_CAP = 2;
/** College allowance per month until plans set it (B10). */
export const DEFAULT_MONTHLY_ALLOWANCE = 2000;
export const BUDGET_WARNING_PERCENT = 80;
const RETENTION_MS = 90 * 24 * 3600_000;
const ACTION_TTL_SEC = 7 * 24 * 3600;
const DAY_MS = 24 * 3600_000;

export type SendOutcome = 'sent' | 'capped' | 'unavailable' | 'failed';
export type ActionHandler = (viewer: AuthState, refId: string) => Promise<unknown>;

export interface ChannelDeps {
  whatsapp: WhatsAppProvider;
  cipher: FieldCipher;
  logger: Logger;
  /** WHATSAPP_ACTION_SECRET: signs quick-reply payloads. */
  actionSecret: string;
  /** WHATSAPP_APP_SECRET: Meta signs webhook deliveries with it. */
  appSecret: string;
  /** The college's monthly allowance (the plan's, from B10; a default until then). */
  allowance?: (tenantId: Types.ObjectId) => Promise<number>;
}

const today = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);
const toLang = (locale: string | null | undefined): WaLang =>
  locale === 'te' || locale === 'hi' ? locale : 'en';

/**
 * WhatsApp as a notification channel (B3): who may get it (feature, provider, consent, a verified
 * number), fair-use caps, metering, budget alerts to admins, signed quick-reply actions and the
 * webhook (delivery statuses, button taps, the fixed auto-reply).
 */
export class ChannelService {
  private readonly actions = new Map<ChannelAction, ActionHandler>();
  /** Set by the app: tells the college's admins (budget alerts). */
  onAlert:
    | ((
        type: 'channel_budget_warning' | 'channel_budget_reached',
        data: Record<string, string>,
      ) => Promise<void>)
    | null = null;
  private readonly key: Uint8Array;

  constructor(private readonly d: ChannelDeps) {
    this.key = new TextEncoder().encode(d.actionSecret);
  }

  /** Privacy: what was sent to a member (template names and statuses only). */
  async exportFor(userId: string) {
    return ChannelMessageModel.find({ userId: new Types.ObjectId(userId) })
      .select('channel template category status createdAt')
      .lean();
  }

  async eraseFor(userId: string) {
    await ChannelMessageModel.deleteMany({ userId: new Types.ObjectId(userId) });
  }

  registerAction(action: ChannelAction, handler: ActionHandler) {
    this.actions.set(action, handler);
  }

  /** WhatsApp works here and now: a template, the college's switch and a live provider. */
  async usable(type: NotificationType): Promise<boolean> {
    return !!WHATSAPP_TEMPLATES[type] && this.d.whatsapp.available && (await featureEnabled('whatsapp'));
  }

  /** What the member's notification settings show: whether WhatsApp can reach them, and where. */
  async memberStatus(userId: string): Promise<WhatsAppStatus> {
    const available = this.d.whatsapp.available && (await featureEnabled('whatsapp'));
    const u = await UserModel.findById(userId).select('+phoneEnc phoneVerifiedAt').lean();
    const consent = (await consentService.current(userId)).find((c) => c.purpose === 'whatsapp_updates');
    const phone = u?.phoneEnc && u.phoneVerifiedAt ? maskPhone(this.d.cipher.decrypt(u.phoneEnc)) : null;
    return { available, consented: !!consent?.granted, phone };
  }

  /** The member's number and language, when they opted in and proved the number. */
  private async target(userId: string): Promise<{ phone: string; lang: WaLang } | null> {
    const u = await UserModel.findById(userId).select('+phoneEnc phoneVerifiedAt status locale').lean();
    if (!u?.phoneEnc || !u.phoneVerifiedAt || u.status !== 'active') return null;
    const consent = (await consentService.current(userId)).find((c) => c.purpose === 'whatsapp_updates');
    if (!consent?.granted) return null;
    return { phone: this.d.cipher.decrypt(u.phoneEnc), lang: toLang(u.locale) };
  }

  async monthCount(): Promise<number> {
    const m = month();
    const rows = await ChannelUsageModel.find({ channel: 'whatsapp', day: { $regex: `^${m}-` } })
      .select('count')
      .lean();
    return rows.reduce((n, r) => n + r.count, 0);
  }

  async allowance(): Promise<number> {
    return this.d.allowance ? this.d.allowance(requireTenantId()) : DEFAULT_MONTHLY_ALLOWANCE;
  }

  /**
   * Sends a notification by WhatsApp. `capped` (fair-use or the college's allowance) and
   * `unavailable` tell the caller to fall back to push or email.
   */
  async send(
    userId: string,
    type: NotificationType,
    data: Record<string, string>,
    timezone: string,
  ): Promise<SendOutcome> {
    const tpl = WHATSAPP_TEMPLATES[type];
    if (!tpl || !(await this.usable(type))) return 'unavailable';
    const to = await this.target(userId);
    if (!to) return 'unavailable';
    if (!tpl.critical) {
      const week = await ChannelMessageModel.countDocuments({
        userId: new Types.ObjectId(userId),
        channel: 'whatsapp',
        critical: false,
        createdAt: { $gte: new Date(Date.now() - 7 * DAY_MS) },
      });
      if (week >= MEMBER_WEEKLY_CAP) return 'capped';
      if ((await this.monthCount()) >= (await this.allowance())) {
        await this.budgetAlerts();
        return 'capped';
      }
    }
    const tenantId = String(requireTenantId());
    const buttons = await Promise.all(
      (tpl.buttons ?? [])
        .filter((b) => data[b.ref])
        .map(async (b) => ({
          payload: await this.signAction(tenantId, userId, b.action, data[b.ref] ?? ''),
        })),
    );
    let messageId: string;
    try {
      ({ messageId } = await this.d.whatsapp.sendTemplate(
        to.phone,
        tpl.name,
        to.lang,
        tpl.params(data, { lang: to.lang, timezone }),
        buttons,
      ));
    } catch (err) {
      this.d.logger.warn({ err, type }, 'whatsapp send failed');
      return 'failed';
    }
    await this.record(userId, 'whatsapp', tpl.name, CATEGORY_OF[type], tpl.critical, messageId);
    return 'sent';
  }

  /** Meters one message (codes included) and alerts the admins at 80% and 100% of the allowance. */
  async record(
    userId: string | null,
    channel: 'whatsapp' | 'sms',
    template: string,
    category: NotificationCategory | 'authentication',
    critical: boolean,
    providerMessageId: string,
  ) {
    if (userId)
      await ChannelMessageModel.create({
        userId: new Types.ObjectId(userId),
        channel,
        template,
        category,
        critical,
        providerMessageId,
        expiresAt: new Date(Date.now() + RETENTION_MS),
      });
    await ChannelUsageModel.updateOne(
      { day: today(), channel, category },
      { $inc: { count: 1 } },
      { upsert: true },
    );
    if (channel === 'whatsapp') await this.budgetAlerts();
  }

  private async budgetAlerts() {
    const limit = await this.allowance();
    if (limit <= 0) return;
    const percent = Math.floor(((await this.monthCount()) / limit) * 100);
    if (percent < BUDGET_WARNING_PERCENT) return;
    const reached = percent >= 100;
    // A marker row per month and level: the upsert that creates it is the one that alerts.
    const r = await ChannelUsageModel.updateOne(
      { day: `${month()}-alert`, channel: 'whatsapp', category: reached ? 'alert_100' : 'alert_80' },
      { $setOnInsert: { count: 0 } },
      { upsert: true },
    );
    if (!r.upsertedCount) return;
    if (reached) await this.onAlert?.('channel_budget_reached', {});
    else await this.onAlert?.('channel_budget_warning', { percent: String(BUDGET_WARNING_PERCENT) });
  }

  /** This month's use for the admin overview. */
  async usage() {
    return { sent: await this.monthCount(), allowance: await this.allowance(), month: month() };
  }

  // ── Quick-reply actions ─────────────────────────────
  /** A signed, expiring payload for a button: which college, member, action and item. */
  signAction(tenantId: string, userId: string, action: ChannelAction, refId: string): Promise<string> {
    return new SignJWT({ t: tenantId, a: action, r: refId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${ACTION_TTL_SEC}s`)
      .sign(this.key);
  }

  async verifyAction(token: string) {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      const { t, a, r, sub } = payload as { t?: string; a?: string; r?: string; sub?: string };
      if (!t || !a || !r || !sub || !this.actions.has(a as ChannelAction)) return null;
      return { tenantId: t, userId: sub, action: a as ChannelAction, refId: r };
    } catch {
      return null;
    }
  }

  // ── Webhook ─────────────────────────────
  /** X-Hub-Signature-256: HMAC-SHA256 of the raw body with the app secret. */
  signatureValid(raw: Buffer | undefined, header: string | undefined): boolean {
    if (!raw || !header?.startsWith('sha256=') || !this.d.appSecret) return false;
    const want = Buffer.from(createHmac('sha256', this.d.appSecret).update(raw).digest('hex'));
    const got = Buffer.from(header.slice(7));
    return want.length === got.length && timingSafeEqual(want, got);
  }

  /** True the first time a key is seen (Meta retries deliveries). */
  private async firstTime(key: string): Promise<boolean> {
    try {
      await withPlatformScope('channels:webhook-dedupe', () =>
        WebhookReceiptModel.create({ key, expiresAt: new Date(Date.now() + 7 * DAY_MS) }),
      );
      return true;
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return false;
      throw e;
    }
  }

  /** Handles one verified webhook body. Never throws for content it does not understand. */
  async handleWebhook(body: unknown): Promise<{ statuses: number; actions: number; replies: number }> {
    const out = { statuses: 0, actions: 0, replies: 0 };
    const entries = (body as { entry?: { changes?: { value?: WebhookValue }[] }[] })?.entry ?? [];
    for (const change of entries.flatMap((e) => e.changes ?? [])) {
      const v = change.value ?? {};
      for (const s of v.statuses ?? []) if (await this.onStatus(s)) out.statuses++;
      for (const m of v.messages ?? []) {
        const r = await this.onMessage(m);
        if (r === 'action') out.actions++;
        if (r === 'reply') out.replies++;
      }
    }
    return out;
  }

  private async onStatus(s: { id?: string; status?: string }): Promise<boolean> {
    if (!s.id || !(CHANNEL_STATUSES as readonly string[]).includes(s.status ?? '')) return false;
    if (!(await this.firstTime(`status:${s.id}:${s.status}`))) return false;
    // The provider's message id names the college's record; look it up across colleges.
    const r = await withPlatformScope('channels:webhook-status', () =>
      ChannelMessageModel.updateOne(
        { providerMessageId: s.id, status: { $ne: 'failed' } },
        { $set: { status: s.status, statusAt: new Date() } },
      ),
    );
    return r.modifiedCount > 0;
  }

  private async onMessage(m: WebhookMessage): Promise<'action' | 'reply' | 'ignored'> {
    if (!m.id || !m.from || !(await this.firstTime(`msg:${m.id}`))) return 'ignored';
    const payload = m.type === 'button' ? m.button?.payload : m.interactive?.button_reply?.id;
    if (payload) {
      const act = await this.verifyAction(payload);
      if (!act) return 'ignored';
      const done = await runInTenant(act.tenantId, async () => {
        // The tap must come from the number the button was sent to, and the member must still
        // be allowed to act (current permissions and blocks).
        const u = await UserModel.findById(act.userId).select('phoneIndex').lean();
        if (!u?.phoneIndex || !this.d.cipher.blindIndexes(`+${m.from}`).includes(u.phoneIndex)) return false;
        const tenant = await findTenantById(act.tenantId);
        const viewer = tenant ? await backgroundAuth(act.userId, tenant) : null;
        const handler = this.actions.get(act.action);
        if (!viewer || !handler) return false;
        try {
          await handler(viewer, act.refId);
          return true;
        } catch (err) {
          this.d.logger.info({ err, action: act.action }, 'whatsapp action refused');
          return false;
        }
      });
      return done ? 'action' : 'ignored';
    }
    // Free text is never stored; one fixed answer per number per day.
    if (!(await this.firstTime(`auto:${m.from}:${today()}`))) return 'ignored';
    try {
      await this.d.whatsapp.sendText(`+${m.from}`, AUTO_REPLY.en);
    } catch (err) {
      this.d.logger.warn({ err }, 'whatsapp auto-reply failed');
    }
    return 'reply';
  }
}

interface WebhookMessage {
  id?: string;
  from?: string;
  type?: string;
  button?: { payload?: string };
  interactive?: { button_reply?: { id?: string } };
}
interface WebhookValue {
  statuses?: { id?: string; status?: string }[];
  messages?: WebhookMessage[];
}
