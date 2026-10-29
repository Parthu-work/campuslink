import { randomBytes, randomInt } from 'node:crypto';
import { Types } from 'mongoose';
import QRCode from 'qrcode';
import {
  APP_NAME,
  CONSENT_PURPOSES,
  CONSENT_PURPOSE_KEYS,
  ErrorCode,
  INVITE_RESEND_HOURS,
  INVITE_TTL_DAYS,
  JOIN_CODE_ALPHABET,
  adultOnFromBirthMonth,
  type ClaimCodeSent,
  type ConsentPurpose,
  type InviteSendResult,
  type InviteView,
  type JoinCodeInfo,
  type JoinCodeView,
  type OnboardingRecordView,
  type OtpChannel,
  type Role,
} from '@campuslink/shared';
import { InviteLinkModel, JoinCodeModel } from './onboarding.model.js';
import { OtpChallengeModel } from './verification.model.js';
import { WhitelistModel } from '../imports/whitelist.model.js';
import { maskEmail, maskPhone } from '../imports/whitelist.service.js';
import { UserModel } from '../auth/user.model.js';
import { ageFields, type AuthService, type ClientMeta, type IssuedSession } from '../auth/auth.service.js';
import type { VerificationService } from './verification.service.js';
import { RESEND_AFTER_SEC, type Challenge, type OtpService } from './otp.service.js';
import type { ChannelService } from '../notifications/channels/channel.service.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';
import type { FieldCipher } from '../../lib/crypto.js';
import { sha256 } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, notFound, tooMany } from '../../lib/errors.js';
import { audit } from '../audit/audit.service.js';
import { consentService } from '../consent/consent.service.js';

const DAY_MS = 24 * 3600_000;
/** Codes per roster record per day, whichever way they were asked for. */
const MAX_CODES_PER_RECORD = 5;
const MAX_INVITES_PER_SEND = 1000;
const PAGE = 50;

type Kind = 'student' | 'alumni';
type Rec = NonNullable<Awaited<ReturnType<OnboardingService['recordById']>>>;

const roleFor = (kind: Kind): Role => (kind === 'alumni' ? 'ALUMNI' : 'STUDENT');
const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? name;
/** 21DP1A0501 → 21DP••••01: enough to recognise your own, not to collect others'. */
const maskRoll = (roll: string) =>
  roll.length <= 6 ? roll : `${roll.slice(0, 4)}${'•'.repeat(roll.length - 6)}${roll.slice(-2)}`;

const expired = () =>
  notFound('This invite has expired or was already used. Ask your college for a new one.');
const noSuchCode = () => notFound('This class code has expired. Ask your class coordinator for a new one.');

export interface OnboardingDeps {
  cipher: FieldCipher;
  otp: OtpService;
  auth: AuthService;
  verification: VerificationService;
  channels: ChannelService;
}

export interface ClaimBody {
  challengeId: string;
  code: string;
  birthMonth: string;
  consents: string[];
  locale: 'en' | 'te';
}

/**
 * One-tap invites and class join codes (build B4, docs/specs/invites.md). Both end the same way: a
 * code to the number or email on the college's record (never one typed in), then a new member
 * with the record's name and kind, already verified. See also VerificationService.claim.
 */
export class OnboardingService {
  constructor(private readonly d: OnboardingDeps) {}

  /** Invite links and join codes hold no personal data beyond the record id (the roster's own). */
  exportFor(_userId: string) {
    return Promise.resolve([]);
  }

  async eraseFor(userId: string) {
    await InviteLinkModel.updateMany({ usedBy: new Types.ObjectId(userId) }, { $set: { usedBy: null } });
  }

  recordById(id: Types.ObjectId | string) {
    return WhitelistModel.findById(id)
      .select('rollNumber name kind branch gradYear status emailEnc phoneEnc')
      .lean();
  }

  // ── Admin: the list, sending invites ─────────────────────────────
  async records(q: {
    branch?: string | undefined;
    gradYear?: number | undefined;
    kind?: Kind | undefined;
    status: 'unclaimed' | 'claimed';
    cursor?: string | undefined;
  }): Promise<{ items: OnboardingRecordView[]; nextCursor: string | null }> {
    const filter: Record<string, unknown> = { status: q.status };
    if (q.branch) filter.branch = q.branch;
    if (q.gradYear) filter.gradYear = q.gradYear;
    if (q.kind) filter.kind = q.kind;
    if (q.cursor) filter._id = { $lt: new Types.ObjectId(q.cursor) };
    const recs = await WhitelistModel.find(filter)
      .sort({ _id: -1 })
      .limit(PAGE + 1)
      .select('rollNumber name kind branch gradYear status emailIndex phoneIndex')
      .lean();
    const page = recs.slice(0, PAGE);
    const links = await InviteLinkModel.find({ whitelistId: { $in: page.map((r) => r._id) } })
      .sort({ createdAt: -1 })
      .select('whitelistId createdAt')
      .lean();
    const last = new Map<string, Date>();
    for (const l of links) if (!last.has(String(l.whitelistId))) last.set(String(l.whitelistId), l.createdAt);
    return {
      items: page.map((r) => ({
        id: String(r._id),
        rollNumber: r.rollNumber,
        name: r.name,
        branch: r.branch ?? null,
        gradYear: r.gradYear ?? null,
        kind: r.kind as Kind,
        status: r.status as 'unclaimed' | 'claimed',
        hasPhone: !!r.phoneIndex,
        hasEmail: !!r.emailIndex,
        lastInvitedAt: last.get(String(r._id))?.toISOString() ?? null,
      })),
      nextCursor: recs.length > PAGE ? String(page[page.length - 1]?._id) : null,
    };
  }

  /**
   * Creates personal links for unclaimed records (picked, or every one matching the filters) and
   * sends them by WhatsApp, or returns them for the college's own mail merge (CSV). A record
   * invited in the last INVITE_RESEND_HOURS is skipped.
   */
  async sendInvites(
    tenant: TenantRecord,
    actorId: string,
    body: {
      ids?: string[] | undefined;
      branch?: string | undefined;
      gradYear?: number | undefined;
      kind?: Kind | undefined;
      channel: 'whatsapp' | 'csv';
      attestOptIn?: boolean | undefined;
    },
    meta: ClientMeta,
  ): Promise<InviteSendResult & { links: { rollNumber: string; name: string; link: string }[] }> {
    if (body.channel === 'whatsapp') {
      if (!body.attestOptIn)
        throw badRequest('Confirm these students agreed to hear from the college on WhatsApp');
      if (!(await this.d.channels.invitesUsable()))
        throw new AppError(503, ErrorCode.CHANNEL_UNAVAILABLE, 'WhatsApp isn’t set up for this college');
    }
    const filter: Record<string, unknown> = { status: 'unclaimed' };
    if (body.ids?.length) filter._id = { $in: body.ids.map((id) => new Types.ObjectId(id)) };
    if (body.branch) filter.branch = body.branch;
    if (body.gradYear) filter.gradYear = body.gradYear;
    if (body.kind) filter.kind = body.kind;
    const recs = await WhitelistModel.find(filter)
      .sort({ _id: 1 })
      .limit(MAX_INVITES_PER_SEND)
      .select('rollNumber name kind phoneEnc')
      .lean();
    const recent = new Set(
      (
        await InviteLinkModel.find({
          whitelistId: { $in: recs.map((r) => r._id) },
          createdAt: { $gte: new Date(Date.now() - INVITE_RESEND_HOURS * 3600_000) },
        })
          .select('whitelistId')
          .lean()
      ).map((l) => String(l.whitelistId)),
    );
    const result = { created: 0, skipped: 0, sent: 0, failed: 0 };
    const links: { rollNumber: string; name: string; link: string }[] = [];
    let capped = false;
    for (const rec of recs) {
      if (recent.has(String(rec._id)) || (body.channel === 'whatsapp' && !rec.phoneEnc)) {
        result.skipped++;
        continue;
      }
      if (capped) {
        result.failed++;
        continue;
      }
      const token = randomBytes(32).toString('base64url');
      const link = await InviteLinkModel.create({
        whitelistId: rec._id,
        tokenHash: sha256(token),
        createdBy: new Types.ObjectId(actorId),
        channel: body.channel,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * DAY_MS),
      });
      const url = this.d.auth.tenantUrl(tenant, `/invite/${token}`);
      if (body.channel === 'csv') {
        result.created++;
        links.push({ rollNumber: rec.rollNumber, name: rec.name, link: url });
        continue;
      }
      const outcome = await this.d.channels.sendInvite(
        this.d.cipher.decrypt(rec.phoneEnc ?? ''),
        rec.kind as Kind,
        { name: firstWord(rec.name), college: tenant.branding.displayName, link: url },
        // The person isn't a member yet, so there is no language to go by: English.
        null,
      );
      if (outcome === 'sent') {
        result.created++;
        result.sent++;
      } else {
        // Not sent: the record can be invited again straight away.
        await InviteLinkModel.deleteOne({ _id: link._id });
        result.failed++;
        capped = outcome === 'capped';
      }
    }
    await audit.record(
      {
        action: 'onboarding.invites_sent',
        actorId,
        meta: { channel: body.channel, ...result, optInAttested: !!body.attestOptIn },
      },
      meta,
    );
    return { ...result, links };
  }

  // ── Invite links ─────────────────────────────
  private async liveLink(token: string) {
    const link = await InviteLinkModel.findOne({
      tokenHash: sha256(token),
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!link) throw expired();
    const rec = await this.recordById(link.whitelistId);
    if (!rec || rec.status !== 'unclaimed') throw expired();
    return { link, rec };
  }

  async inviteInfo(tenant: TenantRecord, token: string): Promise<InviteView> {
    const { rec } = await this.liveLink(token);
    return {
      college: tenant.branding.displayName,
      firstName: firstWord(rec.name),
      rollNumber: maskRoll(rec.rollNumber),
      kind: rec.kind as Kind,
      contact: this.contactOf(rec),
    };
  }

  async inviteStart(
    tenant: TenantRecord,
    token: string,
    channel: OtpChannel | undefined,
    lang: string,
    meta: ClientMeta,
  ): Promise<ClaimCodeSent> {
    const { rec } = await this.liveLink(token);
    return this.sendClaimCode(tenant, rec, channel, lang, meta, 'invite');
  }

  async inviteConfirm(token: string, body: ClaimBody, meta: ClientMeta) {
    const ch = await this.d.otp.check(body.challengeId, ['roster_claim'], body.code);
    const { link, rec } = await this.liveLink(token);
    if (String(link.whitelistId) !== String(ch.targetId)) throw badRequest('Start again');
    const userId = new Types.ObjectId();
    // The link is single use even under two taps at once: whoever marks it used goes on.
    const used = await InviteLinkModel.findOneAndUpdate(
      { _id: link._id, usedAt: null },
      { $set: { usedAt: new Date(), usedBy: userId } },
    ).lean();
    if (!used) throw expired();
    try {
      return await this.join(rec, ch, body, userId, 'roll_invite_link', meta);
    } catch (err) {
      await InviteLinkModel.updateOne({ _id: link._id }, { $set: { usedAt: null, usedBy: null } });
      throw err;
    }
  }

  // ── Class join codes ─────────────────────────────
  async createJoinCode(
    actorId: string,
    body: { kind: Kind; branch?: string | undefined; gradYear?: number | undefined; days: number },
    meta: ClientMeta,
  ): Promise<JoinCodeView> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from(
        { length: 8 },
        () => JOIN_CODE_ALPHABET[randomInt(0, JOIN_CODE_ALPHABET.length)],
      ).join('');
      try {
        const doc = await JoinCodeModel.create({
          code,
          kind: body.kind,
          branch: body.branch ?? null,
          gradYear: body.gradYear ?? null,
          expiresAt: new Date(Date.now() + body.days * DAY_MS),
          createdBy: new Types.ObjectId(actorId),
        });
        await audit.record(
          {
            action: 'onboarding.join_code_created',
            actorId,
            targetType: 'join_code',
            targetId: String(doc._id),
            meta: { kind: body.kind, branch: body.branch ?? null, gradYear: body.gradYear ?? null },
          },
          meta,
        );
        return this.codeView(doc.toObject());
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    }
    throw conflict('Try again');
  }

  async joinCodes(): Promise<JoinCodeView[]> {
    const docs = await JoinCodeModel.find().sort({ _id: -1 }).limit(PAGE).lean();
    return docs.map((d) => this.codeView(d));
  }

  async expireJoinCode(actorId: string, id: string, meta: ClientMeta): Promise<JoinCodeView> {
    const doc = await JoinCodeModel.findOneAndUpdate(
      { _id: id },
      { $set: { revokedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean();
    if (!doc) throw notFound('Join code');
    await audit.record(
      { action: 'onboarding.join_code_expired', actorId, targetType: 'join_code', targetId: id },
      meta,
    );
    return this.codeView(doc);
  }

  /** What a printable poster needs: the code, its class and a QR code of the join link. */
  async poster(tenant: TenantRecord, id: string) {
    const doc = await JoinCodeModel.findById(id).lean();
    if (!doc) throw notFound('Join code');
    const url = this.d.auth.tenantUrl(tenant, `/join/${doc.code}`);
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { ...this.codeView(doc), college: tenant.branding.displayName, url, qrSvg, app: APP_NAME };
  }

  private codeView(d: {
    _id: Types.ObjectId;
    code: string;
    kind: string;
    branch?: string | null;
    gradYear?: number | null;
    uses: number;
    expiresAt: Date;
    revokedAt?: Date | null;
    createdAt: Date;
  }): JoinCodeView {
    return {
      id: String(d._id),
      code: d.code,
      kind: d.kind as Kind,
      branch: d.branch ?? null,
      gradYear: d.gradYear ?? null,
      uses: d.uses,
      expiresAt: d.expiresAt.toISOString(),
      active: !d.revokedAt && d.expiresAt > new Date(),
      createdAt: d.createdAt.toISOString(),
    };
  }

  private async liveCode(code: string) {
    const doc = await JoinCodeModel.findOne({
      code,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!doc) throw noSuchCode();
    return doc;
  }

  async joinInfo(tenant: TenantRecord, code: string): Promise<JoinCodeInfo> {
    const doc = await this.liveCode(code);
    return {
      college: tenant.branding.displayName,
      kind: doc.kind as Kind,
      branch: doc.branch ?? null,
      gradYear: doc.gradYear ?? null,
    };
  }

  /** The roll number must be an unclaimed record in the code's class. */
  private inClass(rec: Rec, doc: Awaited<ReturnType<OnboardingService['liveCode']>>) {
    return (
      rec.status === 'unclaimed' &&
      rec.kind === doc.kind &&
      (!doc.branch || rec.branch === doc.branch) &&
      (!doc.gradYear || rec.gradYear === doc.gradYear)
    );
  }

  async joinStart(
    tenant: TenantRecord,
    code: string,
    body: { rollNumber: string; channel?: OtpChannel | undefined },
    lang: string,
    meta: ClientMeta,
  ): Promise<ClaimCodeSent> {
    const doc = await this.liveCode(code);
    const found = await WhitelistModel.findOne({ rollNumber: body.rollNumber }).select('_id').lean();
    const rec = found ? await this.recordById(found._id) : null;
    if (!rec || !this.inClass(rec, doc))
      throw badRequest('We couldn’t find that roll number in this class. Check it, or ask your coordinator.');
    return this.sendClaimCode(tenant, rec, body.channel, lang, meta, 'join_code');
  }

  async joinConfirm(code: string, body: ClaimBody, meta: ClientMeta) {
    const ch = await this.d.otp.check(body.challengeId, ['roster_claim'], body.code);
    const doc = await this.liveCode(code);
    const rec = ch.targetId ? await this.recordById(ch.targetId) : null;
    if (!rec || !this.inClass(rec, doc)) throw badRequest('Start again');
    const r = await this.join(rec, ch, body, new Types.ObjectId(), 'roll_join_code', meta);
    await JoinCodeModel.updateOne({ _id: doc._id }, { $inc: { uses: 1 } });
    return r;
  }

  // ── Shared steps ─────────────────────────────
  private contactOf(rec: Rec): 'phone' | 'email' | null {
    if (rec.phoneEnc && this.d.otp.phoneAvailable) return 'phone';
    if (rec.emailEnc) return 'email';
    return null;
  }

  /** A code to the record's own number (WhatsApp first, then SMS) or, without one, its email. */
  private async sendClaimCode(
    tenant: TenantRecord,
    rec: Rec,
    channel: OtpChannel | undefined,
    lang: string,
    meta: ClientMeta,
    via: 'invite' | 'join_code',
  ): Promise<ClaimCodeSent> {
    const contact = this.contactOf(rec);
    if (!contact)
      throw badRequest('Your college has no number or email for you yet. Ask them to update your record.');
    const today = await OtpChallengeModel.countDocuments({
      purpose: 'roster_claim',
      targetId: rec._id,
      createdAt: { $gte: new Date(Date.now() - DAY_MS) },
    });
    if (today >= MAX_CODES_PER_RECORD)
      throw tooMany('Too many codes for this record today. Try again tomorrow.');
    let sent: ClaimCodeSent;
    if (contact === 'phone') {
      const phone = this.d.cipher.decrypt(rec.phoneEnc ?? '');
      const ch = await this.d.otp.issue({ purpose: 'roster_claim', phone, targetId: rec._id });
      const used = await this.d.otp.sendToPhone(ch.id, phone, ch.code, lang, channel);
      sent = {
        challengeId: ch.id,
        channel: used,
        destination: maskPhone(phone),
        resendAfterSec: RESEND_AFTER_SEC,
      };
    } else {
      const email = this.d.cipher.decrypt(rec.emailEnc ?? '');
      const ch = await this.d.otp.issue({ purpose: 'roster_claim', targetId: rec._id, channel: 'email' });
      await this.d.verification.sendEmailCode(tenant, email, ch.code, 'join your college network');
      sent = {
        challengeId: ch.id,
        channel: 'email',
        destination: maskEmail(email),
        resendAfterSec: RESEND_AFTER_SEC,
      };
    }
    await audit.record(
      {
        action: 'onboarding.code_requested',
        targetType: 'whitelist',
        targetId: String(rec._id),
        meta: { via, channel: sent.channel },
      },
      meta,
    );
    return sent;
  }

  /** Creates the member from the record and the code's proof, claims the record, signs them in. */
  private async join(
    rec: Rec,
    ch: Challenge,
    body: ClaimBody,
    userId: Types.ObjectId,
    method: 'roll_invite_link' | 'roll_join_code',
    meta: ClientMeta,
  ): Promise<{ session: IssuedSession; kind: Kind }> {
    const consents = body.consents.filter((c): c is ConsentPurpose =>
      (CONSENT_PURPOSE_KEYS as string[]).includes(c),
    );
    const missing = CONSENT_PURPOSE_KEYS.filter((p) => CONSENT_PURPOSES[p].required && !consents.includes(p));
    if (missing.length) throw badRequest('Please accept the required terms to create an account', missing);
    const phone = ch.phoneEnc ? this.d.otp.phoneOf(ch) : null;
    const email = phone ? null : rec.emailEnc ? this.d.cipher.decrypt(rec.emailEnc) : null;
    if (!phone && !email) throw badRequest('Start again');
    const existing = await UserModel.exists(
      phone ? { phoneIndex: { $in: this.d.cipher.blindIndexes(phone) } } : { email },
    );
    if (existing)
      throw conflict(
        'An account already uses this contact. Sign in, then confirm your roll number under Settings › Verification.',
      );
    const kind = rec.kind as Kind;
    let user;
    try {
      user = await UserModel.create({
        _id: userId,
        name: rec.name,
        roles: [roleFor(kind)],
        verified: false,
        ...ageFields(adultOnFromBirthMonth(body.birthMonth)),
        locale: body.locale,
        ...(phone
          ? {
              phoneEnc: this.d.cipher.encrypt(phone),
              phoneIndex: this.d.cipher.blindIndex(phone),
              phoneVerifiedAt: new Date(),
              otpChannel: ch.channel === 'sms' ? 'sms' : null,
            }
          : { email, emailVerifiedAt: new Date() }),
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000)
        throw conflict('An account already uses this contact. Sign in instead.');
      throw err;
    }
    await consentService.recordMany(user._id, consents, 'signup');
    await this.d.auth.onUserCreated?.(String(user._id));
    await audit.record(
      {
        action: 'auth.signup',
        actorId: String(user._id),
        targetType: 'user',
        targetId: String(user._id),
        meta: { intent: roleFor(kind), method, minor: user.status === 'guardian_pending' },
      },
      meta,
    );
    if (!(await this.d.verification.claim(String(user._id), rec._id as Types.ObjectId, method, meta)))
      throw conflict('This college record was just claimed. Contact your college administrator.');
    return { kind, session: await this.d.auth.createSession(user._id, user.tokenVersion, meta) };
  }
}
