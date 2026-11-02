import { Types } from 'mongoose';
import {
  ErrorCode,
  CONSENT_PURPOSES,
  CONSENT_PURPOSE_KEYS,
  adultOnFromBirthMonth,
  requiresMfa,
  type CodeSent,
  type ConsentPurpose,
  type OtpChannel,
  type PhoneSignupFields,
  type Role,
} from '@campuslink/shared';
import { UserModel } from './user.model.js';
import { ageFields, type AuthService, type ClientMeta, type IssuedSession } from './auth.service.js';
import type { FieldCipher } from '../../lib/crypto.js';
import type { TokenService } from '../../lib/jwt.js';
import { requireTenantId } from '../../lib/context.js';
import { AppError, badRequest, conflict, tooMany } from '../../lib/errors.js';
import { verifyPassword } from '../../lib/passwords.js';
import { RESEND_AFTER_SEC, type OtpService } from '../verification/otp.service.js';
import { audit } from '../audit/audit.service.js';
import { assertWritable } from '../tenants/features.js';
import { consentService } from '../consent/consent.service.js';

export interface PhoneAuthDeps {
  auth: AuthService;
  otp: OtpService;
  cipher: FieldCipher;
  tokens: TokenService;
}

export type PhoneVerifyResult =
  { mfaRequired: true; ticket: string } | { mfaRequired: false; session: IssuedSession; created: boolean };

const unavailable = () =>
  new AppError(503, ErrorCode.CHANNEL_UNAVAILABLE, 'Phone codes aren’t available here yet. Use your email.');

/**
 * Phone-first identity (build B2, decision D1): sign-up and sign-in with a mobile number and a
 * one-time code, and changing the number. See docs/specs/phone-identity.md.
 */
export class PhoneAuthService {
  /** Set by the app: a proved number may match the college's list (verification). */
  onPhoneVerified: ((userId: string, phone: string, meta: ClientMeta) => Promise<void>) | null = null;

  constructor(private readonly d: PhoneAuthDeps) {}

  private byPhone(phone: string) {
    return UserModel.findOne({ phoneIndex: { $in: this.d.cipher.blindIndexes(phone) } })
      .select(
        'roles status locale otpChannel failedLogins lockedUntil tokenVersion mfa.enabled phoneVerifiedAt',
      )
      .lean();
  }

  /**
   * Sends a sign-up or sign-in code. The answer is the same whether or not the number has an
   * account; a sign-in code is only really sent to a number with one.
   */
  async start(
    body: { phone: string; purpose: 'signup' | 'login'; channel?: OtpChannel | undefined },
    lang: string,
    meta: ClientMeta,
  ): Promise<CodeSent> {
    if (!this.d.otp.phoneAvailable) throw unavailable();
    const user = await this.byPhone(body.phone);
    const preferred = body.channel ?? (user?.otpChannel as OtpChannel | null) ?? undefined;
    const channel = await this.d.otp.channelFor(preferred);
    if (!channel) throw unavailable();
    const purpose = body.purpose === 'signup' ? 'phone_signup' : 'phone_login';
    const decoy = body.purpose === 'login' && !user;
    const ch = await this.d.otp.issue({
      purpose,
      userId: user?._id ?? null,
      phone: body.phone,
      channel,
      decoy,
    });
    let used = channel;
    if (!decoy)
      used = await this.d.otp.sendToPhone(ch.id, body.phone, ch.code, user?.locale ?? lang, preferred);
    await audit.record(
      {
        action: 'auth.phone_code_requested',
        ...(user ? { actorId: String(user._id), targetType: 'user', targetId: String(user._id) } : {}),
        meta: { purpose: body.purpose, channel: used },
      },
      meta,
    );
    return { challengeId: ch.id, channel: used, resendAfterSec: RESEND_AFTER_SEC };
  }

  /** Confirms a code: signs in to the number's account, or creates one from the sign-up fields. */
  async verify(
    body: { challengeId: string; code: string; signup?: PhoneSignupFields | undefined },
    meta: ClientMeta,
  ): Promise<PhoneVerifyResult> {
    const ch = await this.d.otp.check(body.challengeId, ['phone_signup', 'phone_login'], body.code, {
      onWrong: async (c) => {
        if (!c.userId) return;
        const u = await UserModel.findById(c.userId).select('failedLogins').lean();
        if (u) await this.d.auth.registerFailure(u, meta);
      },
    });
    const phone = this.d.otp.phoneOf(ch);
    const channel = (ch.channel as OtpChannel | null) ?? undefined;
    const existing = await this.byPhone(phone);
    if (existing) return this.signIn(existing, channel, meta);
    if (!body.signup) throw badRequest('No account uses this number yet. Create one to continue.');
    return this.signUp(phone, body.signup, channel, meta);
  }

  private async signIn(
    user: NonNullable<Awaited<ReturnType<PhoneAuthService['byPhone']>>>,
    channel: OtpChannel | undefined,
    meta: ClientMeta,
  ): Promise<PhoneVerifyResult> {
    if (user.lockedUntil && user.lockedUntil > new Date()) throw tooMany();
    if (requiresMfa(user.roles as Role[]))
      throw new AppError(
        403,
        ErrorCode.USE_PASSWORD_AND_2FA,
        'Administrators sign in with their email, password and two-factor code.',
      );
    if (user.status === 'suspended')
      throw new AppError(
        403,
        ErrorCode.FORBIDDEN,
        'This account is suspended. Contact your college administrator.',
      );
    await UserModel.updateOne(
      { _id: user._id },
      {
        $set: {
          failedLogins: 0,
          lockedUntil: null,
          ...(user.phoneVerifiedAt ? {} : { phoneVerifiedAt: new Date() }),
          ...(channel ? { otpChannel: channel === 'sms' ? 'sms' : null } : {}),
        },
      },
    );
    // A phone code never replaces a second factor the member turned on.
    if (user.mfa?.enabled) {
      const ticket = await this.d.tokens.signMfaTicket({
        sub: String(user._id),
        tid: String(requireTenantId()),
      });
      return { mfaRequired: true, ticket };
    }
    return {
      mfaRequired: false,
      created: false,
      session: await this.d.auth.createSession(user._id, user.tokenVersion, meta),
    };
  }

  private async signUp(
    phone: string,
    f: PhoneSignupFields,
    channel: OtpChannel | undefined,
    meta: ClientMeta,
  ): Promise<PhoneVerifyResult> {
    // Phone codes still sign members in while the college is read-only (B10); no new accounts.
    await assertWritable();
    const consents = f.consents.filter((c): c is ConsentPurpose =>
      (CONSENT_PURPOSE_KEYS as string[]).includes(c),
    );
    const missing = CONSENT_PURPOSE_KEYS.filter((p) => CONSENT_PURPOSES[p].required && !consents.includes(p));
    if (missing.length) throw badRequest('Please accept the required terms to create an account', missing);
    let user;
    try {
      user = await UserModel.create({
        name: f.name,
        roles: [f.intent],
        verified: false,
        ...ageFields(adultOnFromBirthMonth(f.birthMonth)),
        locale: f.locale,
        phoneEnc: this.d.cipher.encrypt(phone),
        phoneIndex: this.d.cipher.blindIndex(phone),
        phoneVerifiedAt: new Date(),
        otpChannel: channel === 'sms' ? 'sms' : null,
      });
    } catch (err) {
      // The same number finished signing up a moment ago (two taps): sign in to that account.
      if ((err as { code?: number }).code !== 11000) throw err;
      const raced = await this.byPhone(phone);
      if (!raced) throw err;
      return this.signIn(raced, channel, meta);
    }
    await consentService.recordMany(user._id, consents, 'signup');
    await this.d.auth.onUserCreated?.(String(user._id));
    await audit.record(
      {
        action: 'auth.signup',
        actorId: String(user._id),
        targetType: 'user',
        targetId: String(user._id),
        meta: { intent: f.intent, method: 'phone', minor: user.status === 'guardian_pending' },
      },
      meta,
    );
    await this.onPhoneVerified?.(String(user._id), phone, meta);
    return {
      mfaRequired: false,
      created: true,
      session: await this.d.auth.createSession(user._id, user.tokenVersion, meta),
    };
  }

  // ── Changing the number ─────────────────────────────
  /**
   * First step: a code to the old number (or, with the current password, straight to the new one).
   * Nothing changes until the new number's own code is confirmed.
   */
  async startChange(
    userId: string,
    body: { phone: string; password?: string | undefined; channel?: OtpChannel | undefined },
    meta: ClientMeta,
  ): Promise<CodeSent & { step: 'old' | 'new' }> {
    if (!this.d.otp.phoneAvailable) throw unavailable();
    const user = await UserModel.findById(userId).select('+passwordHash +phoneEnc locale otpChannel').lean();
    if (!user) throw badRequest('Start again');
    const current = user.phoneEnc ? this.d.cipher.decrypt(user.phoneEnc) : null;
    if (current === body.phone) throw badRequest('That is already your number');
    const lang = user.locale ?? 'en';
    const preferred = body.channel ?? (user.otpChannel as OtpChannel | null) ?? undefined;
    let step: 'old' | 'new';
    let to: string;
    if (body.password !== undefined) {
      if (!user.passwordHash || !(await verifyPassword(user.passwordHash, body.password)))
        throw badRequest('Your password is incorrect');
      step = 'new';
      to = body.phone;
    } else if (current) {
      step = 'old';
      to = current;
    } else throw badRequest('Enter your password to add a number');
    const ch = await this.d.otp.issue({
      purpose: 'phone_change',
      userId,
      phone: to,
      step,
      ...(step === 'old' ? { nextPhone: body.phone } : {}),
    });
    const channel = await this.d.otp.sendToPhone(ch.id, to, ch.code, lang, preferred);
    await audit.record(
      {
        action: 'auth.phone_change_started',
        actorId: userId,
        targetType: 'user',
        targetId: userId,
        meta: { proof: step === 'old' ? 'old_number' : 'password' },
      },
      meta,
    );
    return { challengeId: ch.id, channel, resendAfterSec: RESEND_AFTER_SEC, step };
  }

  /** Confirms a step: the old number's code sends one to the new number; the new one's saves it. */
  async confirmChange(
    userId: string,
    sessionId: string,
    body: { challengeId: string; code: string },
    meta: ClientMeta,
  ): Promise<{ done: false; next: CodeSent & { step: 'new' } } | { done: true }> {
    const ch = await this.d.otp.check(body.challengeId, ['phone_change'], body.code, { userId });
    const user = await UserModel.findById(userId).select('locale otpChannel').lean();
    if (ch.step === 'old') {
      const next = this.d.otp.phoneOf(ch, 'nextPhoneEnc');
      const issued = await this.d.otp.issue({ purpose: 'phone_change', userId, phone: next, step: 'new' });
      const channel = await this.d.otp.sendToPhone(
        issued.id,
        next,
        issued.code,
        user?.locale ?? 'en',
        (user?.otpChannel as OtpChannel | null) ?? undefined,
      );
      await audit.record(
        { action: 'auth.phone_change_old_confirmed', actorId: userId, targetType: 'user', targetId: userId },
        meta,
      );
      return {
        done: false,
        next: { challengeId: issued.id, channel, resendAfterSec: RESEND_AFTER_SEC, step: 'new' },
      };
    }
    const phone = this.d.otp.phoneOf(ch);
    const taken = await UserModel.exists({
      phoneIndex: { $in: this.d.cipher.blindIndexes(phone) },
      _id: { $ne: new Types.ObjectId(userId) },
    });
    if (taken) throw conflict('This number belongs to another account');
    await UserModel.updateOne(
      { _id: userId },
      {
        $set: {
          phoneEnc: this.d.cipher.encrypt(phone),
          phoneIndex: this.d.cipher.blindIndex(phone),
          phoneVerifiedAt: new Date(),
        },
      },
    );
    await this.d.auth.revokeAllSessions(userId, 'phone_changed', sessionId);
    await audit.record(
      { action: 'auth.phone_changed', actorId: userId, targetType: 'user', targetId: userId },
      meta,
    );
    return { done: true };
  }
}
