import { randomInt } from 'node:crypto';
import { Types } from 'mongoose';
import type { OtpChannel } from '@campuslink/shared';
import { OtpChallengeModel, type OtpPurpose } from './verification.model.js';
import type { FieldCipher } from '../../lib/crypto.js';
import { sha256, safeEqual } from '../../lib/crypto.js';
import { badRequest, tooMany } from '../../lib/errors.js';
import type { OtpSender } from '../notifications/channels/otp-sender.js';
import { featureEnabled } from '../tenants/features.js';

export const OTP_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
/** Per member and, separately, per phone number, across every purpose. */
export const MAX_CHALLENGES_PER_DAY = 5;
/** The app offers "Send again" after this long. */
export const RESEND_AFTER_SEC = 30;
const DAY_MS = 24 * 3600_000;

const codeHash = (challengeSalt: string, code: string) => sha256(`${challengeSalt}:${code}`);

export interface IssueOptions {
  purpose: OtpPurpose;
  userId?: Types.ObjectId | string | null;
  /** E.164; counted against the per-phone cap and kept encrypted on the challenge. */
  phone?: string;
  targetId?: Types.ObjectId;
  company?: { name: string; domain: string };
  nextPhone?: string;
  step?: 'old' | 'new';
  channel?: OtpChannel | 'email';
  /** Creates a challenge no code can ever satisfy (no-enumeration answers); nothing is sent. */
  decoy?: boolean;
}

export type Challenge = NonNullable<Awaited<ReturnType<OtpService['find']>>>;

/**
 * One-time codes for every purpose: issuing (with the daily caps), checking (attempts, expiry,
 * single use) and sending to a phone through the OtpSender.
 */
export class OtpService {
  constructor(
    private readonly cipher: FieldCipher,
    private readonly sender: OtpSender,
  ) {}

  get phoneAvailable(): boolean {
    return this.sender.available;
  }

  async issue(o: IssueOptions): Promise<{ id: string; code: string }> {
    const since = new Date(Date.now() - DAY_MS);
    if (
      o.userId &&
      (await OtpChallengeModel.countDocuments({ userId: o.userId, createdAt: { $gte: since } })) >=
        MAX_CHALLENGES_PER_DAY
    )
      throw tooMany('Too many codes requested today. Try again tomorrow.');
    if (
      o.phone &&
      (await OtpChallengeModel.countDocuments({
        phoneIndex: { $in: this.cipher.blindIndexes(o.phone) },
        createdAt: { $gte: since },
      })) >= MAX_CHALLENGES_PER_DAY
    )
      throw tooMany('Too many codes sent to this number today. Try again tomorrow.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = new Types.ObjectId();
    await OtpChallengeModel.create({
      _id: id,
      userId: o.userId ? new Types.ObjectId(String(o.userId)) : null,
      purpose: o.purpose,
      ...(o.targetId ? { targetId: o.targetId } : {}),
      ...(o.company ? { company: o.company } : {}),
      ...(o.phone
        ? { phoneIndex: this.cipher.blindIndex(o.phone), phoneEnc: this.cipher.encrypt(o.phone) }
        : {}),
      ...(o.nextPhone ? { nextPhoneEnc: this.cipher.encrypt(o.nextPhone) } : {}),
      step: o.step ?? null,
      channel: o.channel ?? null,
      // A decoy's hash is of a different random code, so no submitted code matches it.
      codeHash: codeHash(String(id), o.decoy ? `decoy-${randomInt(0, 2 ** 47)}` : code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      purgeAt: new Date(Date.now() + DAY_MS),
    });
    return { id: String(id), code };
  }

  find(challengeId: string) {
    return OtpChallengeModel.findOne({ _id: challengeId, consumedAt: null }).lean();
  }

  /**
   * Checks a code: expiry, at most MAX_ATTEMPTS wrong codes, single use even under concurrent
   * submissions. `onWrong` runs for a wrong code (sign-in counts it against the account).
   */
  async check(
    challengeId: string,
    purposes: readonly OtpPurpose[],
    code: string,
    opts: { userId?: string; onWrong?: (ch: Challenge) => Promise<void> } = {},
  ): Promise<Challenge> {
    const ch = await this.find(challengeId);
    if (
      !ch ||
      !purposes.includes(ch.purpose as OtpPurpose) ||
      (opts.userId !== undefined && String(ch.userId) !== opts.userId) ||
      ch.expiresAt < new Date()
    )
      throw badRequest('This code has expired. Request a new one.');
    if (ch.attempts >= MAX_ATTEMPTS) throw tooMany('Too many wrong codes. Request a new one.');
    if (!safeEqual(ch.codeHash, codeHash(String(ch._id), code))) {
      await OtpChallengeModel.updateOne({ _id: ch._id }, { $inc: { attempts: 1 } });
      await opts.onWrong?.(ch);
      throw badRequest(`That code is not right. ${MAX_ATTEMPTS - ch.attempts - 1} attempts left.`);
    }
    const consumed = await OtpChallengeModel.findOneAndUpdate(
      { _id: ch._id, consumedAt: null },
      { $set: { consumedAt: new Date() } },
    ).lean();
    if (!consumed) throw badRequest('This code was already used.');
    return ch;
  }

  /** The challenge's number, decrypted (sign-up and phone change need it after the code). */
  phoneOf(ch: Challenge, field: 'phoneEnc' | 'nextPhoneEnc' = 'phoneEnc'): string {
    const enc = ch[field];
    if (!enc) throw badRequest('Start again');
    return this.cipher.decrypt(enc);
  }

  /** The channel a code to a phone would use at this college. */
  async channelFor(preferred?: OtpChannel): Promise<OtpChannel | null> {
    return this.sender.channelFor(preferred, await featureEnabled('whatsapp'));
  }

  /** Sends a code to a phone (WhatsApp first, SMS fallback) and records the channel used. */
  async sendToPhone(
    challengeId: string,
    phone: string,
    code: string,
    lang: string,
    preferred?: OtpChannel,
  ): Promise<OtpChannel> {
    const channel = await this.sender.send(phone, code, lang, preferred, await featureEnabled('whatsapp'));
    await OtpChallengeModel.updateOne({ _id: challengeId }, { $set: { channel } });
    return channel;
  }
}
