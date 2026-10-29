import { Types } from 'mongoose';
import {
  GUARDIAN_CONSENT,
  isMinor,
  type CodeSent,
  type GuardianStatus,
  type NotificationType,
  type OtpChannel,
} from '@campuslink/shared';
import type { JobQueue } from '../../lib/jobs.js';
import { withPlatformScope } from '../../lib/context.js';
import { VerificationRequestModel } from './verification.model.js';
import { WhitelistModel } from '../imports/whitelist.model.js';
import { maskPhone } from '../imports/whitelist.service.js';
import { UserModel } from '../auth/user.model.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { FieldCipher } from '../../lib/crypto.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { RESEND_AFTER_SEC, type OtpService } from './otp.service.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { consentService } from '../consent/consent.service.js';

export const ADULT_JOB = 'auth.adulthood';

export interface GuardianDeps {
  cipher: FieldCipher;
  otp: OtpService;
  profiles: ProfilesService;
}

/**
 * Verifiable guardian consent for members under 18 (DPDP Rules 2025, Rule 10). The college's
 * admission record is the reliable source of the guardian's number, so the code goes to the
 * roster's `guardianPhone`; a number the member enters is used only after a TPO or admin approves
 * it (`guardian_manual`). Needs legal review (docs/privacy.md).
 */
export class GuardianService {
  constructor(private readonly d: GuardianDeps) {}

  /** Set by the app (notifications are built after verification). */
  notify: ((userId: string, type: NotificationType, data: Record<string, string>) => Promise<void>) | null =
    null;

  /** Hourly: queue one adulthood run per college with members whose 18th birthday has passed. */
  static async enqueueDue(jobs: JobQueue, now = new Date()) {
    const tenants = await withPlatformScope('verification:due-adults', () =>
      UserModel.distinct('tenantId', { adultOn: { $ne: null, $lte: now } }),
    );
    const day = now.toISOString().slice(0, 10).replaceAll('-', '');
    for (const t of tenants)
      await jobs.enqueue(ADULT_JOB, { tenantId: String(t) }, { jobId: `adult-${String(t)}-${day}` });
    return tenants.length;
  }

  /**
   * Members who turned 18: no guardian step any more, the minor rules lift, and the date is
   * cleared (an adult's age is never kept). Idempotent: a cleared member is not found again.
   */
  async runAdulthood(now = new Date()) {
    const due = await UserModel.find({ adultOn: { $ne: null, $lte: now } })
      .select('_id status')
      .limit(1000)
      .lean();
    for (const u of due) {
      const r = await UserModel.updateOne(
        { _id: u._id, adultOn: { $ne: null, $lte: now } },
        { $set: { adultOn: null, ...(u.status === 'guardian_pending' ? { status: 'active' } : {}) } },
      );
      if (!r.modifiedCount) continue;
      await this.d.profiles.sync(u._id);
      await audit.record({ action: 'account.turned_adult', targetType: 'user', targetId: String(u._id) });
      await this.notify?.(String(u._id), 'adult_now', {});
    }
    return due.length;
  }

  private async pendingMinor(userId: string) {
    const u = await UserModel.findById(userId).select('status adultOn locale').lean();
    if (!u || u.status !== 'guardian_pending' || !isMinor(u.adultOn))
      throw badRequest('Your account does not need a guardian’s consent');
    return u;
  }

  private record(userId: string) {
    return WhitelistModel.findOne({ claimedBy: new Types.ObjectId(userId) }).lean();
  }

  async status(userId: string): Promise<GuardianStatus> {
    const u = await UserModel.findById(userId).select('status adultOn').lean();
    const required = !!u && u.status === 'guardian_pending' && isMinor(u.adultOn);
    const rec = required ? await this.record(userId) : null;
    const manual = required
      ? await VerificationRequestModel.exists({ userId, method: 'guardian_manual', status: 'pending' })
      : null;
    return {
      required,
      rosterMatched: !!rec,
      guardianPhone: rec?.guardianPhoneEnc ? maskPhone(this.d.cipher.decrypt(rec.guardianPhoneEnc)) : null,
      manualPending: !!manual,
      declarationVersion: GUARDIAN_CONSENT.version,
    };
  }

  /** Sends the code to the guardian's number on the college's record. */
  async start(userId: string, channel: OtpChannel | undefined, meta: RequestMetaLite): Promise<CodeSent> {
    const u = await this.pendingMinor(userId);
    const rec = await this.record(userId);
    if (!rec) throw badRequest('Verify your college record first: your guardian’s number comes from it');
    if (!rec.guardianPhoneEnc)
      throw badRequest(
        'Your college has no guardian number for you yet. Enter one for the college to check.',
      );
    const to = this.d.cipher.decrypt(rec.guardianPhoneEnc);
    const ch = await this.d.otp.issue({ purpose: 'guardian_consent', userId, phone: to, targetId: rec._id });
    const used = await this.d.otp.sendToPhone(ch.id, to, ch.code, u.locale ?? 'en', channel);
    await audit.record(
      {
        action: 'guardian.code_sent',
        actorId: userId,
        targetType: 'user',
        targetId: userId,
        meta: { channel: used },
      },
      meta,
    );
    return { challengeId: ch.id, channel: used, resendAfterSec: RESEND_AFTER_SEC };
  }

  /** The guardian read the declaration and entered their code: record consent, open the account. */
  async confirm(
    userId: string,
    body: { challengeId: string; code: string; language: string },
    meta: RequestMetaLite,
  ): Promise<{ consented: true }> {
    await this.pendingMinor(userId);
    const ch = await this.d.otp.check(body.challengeId, ['guardian_consent'], body.code, { userId });
    if (!ch.targetId) throw badRequest('Start again');
    await consentService.recordGuardian(userId, {
      whitelistId: ch.targetId,
      language: body.language,
      channel: ch.channel ?? 'sms',
    });
    await UserModel.updateOne(
      { _id: userId, status: 'guardian_pending' },
      { $set: { status: 'active', guardianConsentAt: new Date() } },
    );
    await this.d.profiles.sync(userId);
    await audit.record(
      {
        action: 'guardian.consent_recorded',
        actorId: userId,
        targetType: 'user',
        targetId: userId,
        meta: { version: GUARDIAN_CONSENT.version, language: body.language },
      },
      meta,
    );
    return { consented: true };
  }

  /** No guardian number on the roster: the member enters one for the college to check. */
  async requestManual(userId: string, phone: string, meta: RequestMetaLite) {
    await this.pendingMinor(userId);
    const rec = await this.record(userId);
    if (!rec) throw badRequest('Verify your college record first');
    if (await VerificationRequestModel.exists({ userId, method: 'guardian_manual', status: 'pending' }))
      throw conflict('Your college is already checking a number');
    const r = await VerificationRequestModel.create({
      userId: new Types.ObjectId(userId),
      method: 'guardian_manual',
      rollNumber: rec.rollNumber,
      gradYear: rec.gradYear ?? null,
      guardianPhoneEnc: this.d.cipher.encrypt(phone),
    });
    await audit.record(
      {
        action: 'verification.requested',
        actorId: userId,
        targetType: 'verification',
        targetId: String(r._id),
        meta: { method: 'guardian_manual' },
      },
      meta,
    );
    return { id: String(r._id), status: 'pending' as const };
  }

  /** Approving a `guardian_manual` request writes the number to the member's roster record. */
  async approveManual(userId: string, guardianPhoneEnc: string) {
    const phone = this.d.cipher.decrypt(guardianPhoneEnc);
    const r = await WhitelistModel.updateOne(
      { claimedBy: new Types.ObjectId(userId) },
      {
        $set: {
          guardianPhoneEnc: this.d.cipher.encrypt(phone),
          guardianPhoneIndex: this.d.cipher.blindIndex(phone),
        },
      },
    );
    if (!r.matchedCount) throw conflict('This member is no longer matched to a college record');
  }

  /** Tells the member what the college decided about the number they entered. */
  async manualDecided(userId: string, approved: boolean) {
    await this.notify?.(userId, approved ? 'guardian_number_approved' : 'guardian_number_rejected', {});
  }
}
