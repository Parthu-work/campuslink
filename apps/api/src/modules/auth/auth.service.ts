import type { Types } from 'mongoose';
import QRCode from 'qrcode';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import {
  APP_NAME,
  ErrorCode,
  requiresMfa,
  CONSENT_PURPOSES,
  CONSENT_PURPOSE_KEYS,
  type SignupBody,
  type ConsentPurpose,
  type Role,
} from '@campuslink/shared';
import { UserModel, type UserDoc } from './user.model.js';
import { SessionModel } from './session.model.js';
import { AuthTokenModel } from './auth-token.model.js';
import { AppError, tooMany, unauthenticated, badRequest } from '../../lib/errors.js';
import { hashPassword, verifyPassword, dummyVerify, checkStrength, isBreached } from '../../lib/passwords.js';
import { randomToken, sha256, type FieldCipher } from '../../lib/crypto.js';
import { requireTenantId } from '../../lib/context.js';
import type { TokenService } from '../../lib/jwt.js';
import { renderEmail, type MailProvider } from '../../lib/mailer.js';
import type { Logger } from '../../lib/logger.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { consentService } from '../consent/consent.service.js';

export interface AuthDeps {
  tokens: TokenService;
  mailer: MailProvider;
  cipher: FieldCipher;
  logger: Logger;
  webOrigin: string;
  refreshTtlSec: number;
  hibpEnabled: boolean;
  fetchImpl?: typeof fetch;
}
export interface ClientMeta extends RequestMetaLite {
  device: string;
}
export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  sessionId: string;
}

const MAX_FAILED = 5;
const LOCK_BASE_MS = 15 * 60_000;
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60_000;
const RESET_TTL_MS = 30 * 60_000;
const INVITE_TTL_MS = 72 * 60 * 60_000;

const genericLoginError = () =>
  new AppError(401, ErrorCode.UNAUTHENTICATED, 'Email or password is incorrect');
const invalidLink = () => badRequest('This link is invalid or has expired. Request a new one.');

export class AuthService {
  // ── Privacy (export and erasure) ─────────────────────────────
  async exportFor(userId: string) {
    const [u, sessions] = await Promise.all([
      UserModel.findById(userId)
        .select('email name roles capabilities verified status locale createdAt mfa.enabled')
        .lean(),
      SessionModel.find({ userId }).select('device createdAt lastUsedAt revokedAt createdIpPrefix').lean(),
    ]);
    return { account: u, sessions };
  }

  /** Erasure: sessions and tokens now; the user record itself is removed last by the privacy service. */
  async eraseFor(userId: string) {
    await Promise.all([SessionModel.deleteMany({ userId }), AuthTokenModel.deleteMany({ userId })]);
  }

  async deleteUserRecord(userId: string) {
    await UserModel.deleteOne({ _id: userId });
  }

  async checkPassword(userId: string, password: string) {
    const u = await UserModel.findById(userId).select('+passwordHash').lean();
    return !!u && (await verifyPassword(u.passwordHash, password));
  }

  /** Mark or clear a pending deletion (status `deleting` hides the profile; sign-in still works to cancel). */
  async setDeletion(userId: string, purgeAt: Date | null) {
    await UserModel.updateOne(
      { _id: userId },
      purgeAt
        ? {
            $set: { status: 'deleting', deletionPurgeAt: purgeAt, deletionRequestedAt: new Date() },
            $inc: { tokenVersion: 1 },
          }
        : { $set: { status: 'active', deletionPurgeAt: null, deletionRequestedAt: null } },
    );
  }

  async deletionOf(userId: string) {
    const u = await UserModel.findById(userId).select('status deletionPurgeAt deletionRequestedAt').lean();
    return u?.status === 'deleting' && u.deletionPurgeAt
      ? { requestedAt: u.deletionRequestedAt ?? null, purgeAt: u.deletionPurgeAt }
      : null;
  }

  async dueDeletions(now: Date) {
    return (
      await UserModel.find({ status: 'deleting', deletionPurgeAt: { $lte: now } })
        .select('_id')
        .limit(200)
        .lean()
    ).map((u) => String(u._id));
  }

  /** Set by the app: lets verification react when someone proves their email (invites, list matches). */
  onEmailVerified: ((userId: string, email: string, meta: ClientMeta) => Promise<void>) | null = null;
  /** Set by the app: creates the member's profile record whenever an account is created. */
  onUserCreated: ((userId: string) => Promise<void>) | null = null;

  constructor(private readonly d: AuthDeps) {}

  /** https://<slug>.<root>:<port>/path — built from WEB_ORIGIN, never from request headers. */
  tenantUrl(tenant: TenantRecord, path: string): string {
    const base = new URL(this.d.webOrigin);
    base.hostname = `${tenant.slug}.${base.hostname}`;
    return new URL(path, base).toString();
  }

  private async sendMail(
    tenant: TenantRecord,
    to: string,
    subject: string,
    heading: string,
    body: string,
    cta?: { label: string; url: string },
  ) {
    const content = renderEmail({
      college: tenant.branding.displayName,
      heading,
      body,
      ...(cta ? { cta } : {}),
      footer: `${APP_NAME} · private to ${tenant.branding.displayName}. If this wasn't you, you can ignore this email.`,
    });
    try {
      await this.d.mailer.send({ to, subject, ...content });
    } catch (err) {
      // Never fail the request (or reveal account state) because email is down.
      this.d.logger.error({ err, subject }, 'mail send failed');
    }
  }

  private async issueToken(
    userId: Types.ObjectId,
    purpose: 'email_verify' | 'password_reset',
    ttlMs: number,
  ): Promise<string> {
    const token = randomToken();
    await AuthTokenModel.create({
      userId,
      purpose,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return token;
  }

  private async consumeToken(token: string, purpose: 'email_verify' | 'password_reset') {
    return AuthTokenModel.findOneAndUpdate(
      { tokenHash: sha256(token), purpose, usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean();
  }

  async assertPasswordAcceptable(password: string, userInputs: string[]): Promise<void> {
    const strength = checkStrength(password, userInputs);
    if (!strength.ok)
      throw new AppError(400, ErrorCode.WEAK_PASSWORD, 'Choose a stronger password', strength.feedback);
    if (this.d.hibpEnabled && (await isBreached(password, this.d.fetchImpl))) {
      throw new AppError(
        400,
        ErrorCode.WEAK_PASSWORD,
        'This password has appeared in a data breach. Choose a different one.',
        ['Never reuse passwords across sites.'],
      );
    }
  }

  // ── sign-up & email verification ─────────────────────────
  async signup(tenant: TenantRecord, body: SignupBody, meta: ClientMeta): Promise<void> {
    const consents = body.consents.filter((c): c is ConsentPurpose =>
      (CONSENT_PURPOSE_KEYS as string[]).includes(c),
    );
    const missing = CONSENT_PURPOSE_KEYS.filter((p) => CONSENT_PURPOSES[p].required && !consents.includes(p));
    if (missing.length) throw badRequest('Please accept the required terms to create an account', missing);
    if (body.intent === 'STUDENT' && tenant.allowedEmailDomains.length) {
      const domain = body.email.split('@')[1] ?? '';
      if (!tenant.allowedEmailDomains.includes(domain)) {
        throw badRequest(
          `Students sign up with their college email (${tenant.allowedEmailDomains.join(', ')})`,
        );
      }
    }
    await this.assertPasswordAcceptable(body.password, [
      body.name,
      body.email,
      tenant.branding.displayName,
      tenant.slug,
    ]);

    const existing = await UserModel.findOne({ email: body.email }).select('_id').lean();
    if (existing) {
      // Same response as success: no account enumeration. Tell the real owner instead.
      await this.sendMail(
        tenant,
        body.email,
        'You already have an account',
        'You already have an account',
        'Someone (hopefully you) tried to sign up with this email. You can sign in, or reset your password if you have forgotten it.',
        { label: 'Sign in', url: this.tenantUrl(tenant, '/sign-in') },
      );
      return;
    }
    let user: UserDoc;
    try {
      user = await UserModel.create({
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        roles: [body.intent],
        verified: false,
        ageDeclaredAt: new Date(),
        locale: body.locale,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return; // concurrent duplicate: same silent outcome
      throw err;
    }
    await consentService.recordMany(user._id, consents, 'signup');
    await this.onUserCreated?.(String(user._id));
    const token = await this.issueToken(user._id, 'email_verify', EMAIL_VERIFY_TTL_MS);
    await this.sendMail(
      tenant,
      user.email,
      'Confirm your email',
      `Welcome, ${user.name.split(' ')[0]}`,
      'Confirm your email to finish creating your account. The link works for 24 hours.',
      { label: 'Confirm email', url: this.tenantUrl(tenant, `/verify-email?token=${token}`) },
    );
    await audit.record(
      {
        action: 'auth.signup',
        actorId: String(user._id),
        targetType: 'user',
        targetId: String(user._id),
        meta: { intent: body.intent },
      },
      meta,
    );
  }

  async verifyEmail(token: string, meta: ClientMeta): Promise<void> {
    const t = await this.consumeToken(token, 'email_verify');
    if (!t) throw invalidLink();
    await UserModel.updateOne(
      { _id: t.userId, emailVerifiedAt: null },
      { $set: { emailVerifiedAt: new Date() } },
    );
    await audit.record(
      {
        action: 'auth.email_verified',
        actorId: String(t.userId),
        targetType: 'user',
        targetId: String(t.userId),
      },
      meta,
    );
    const u = await UserModel.findById(t.userId).select('email').lean();
    if (u && this.onEmailVerified) await this.onEmailVerified(String(t.userId), u.email, meta);
  }

  async resendVerification(tenant: TenantRecord, email: string): Promise<void> {
    const user = await UserModel.findOne({ email, emailVerifiedAt: null, status: 'active' })
      .select('_id email')
      .lean();
    if (!user) return;
    const token = await this.issueToken(user._id, 'email_verify', EMAIL_VERIFY_TTL_MS);
    await this.sendMail(
      tenant,
      user.email,
      'Confirm your email',
      'Confirm your email',
      'Here is a fresh link to confirm your email. It works for 24 hours.',
      { label: 'Confirm email', url: this.tenantUrl(tenant, `/verify-email?token=${token}`) },
    );
  }

  // ── login ─────────────────────────
  private async registerFailure(
    user: { _id: Types.ObjectId; failedLogins: number },
    meta: ClientMeta,
  ): Promise<void> {
    const failed = user.failedLogins + 1;
    const update: Record<string, unknown> = { failedLogins: failed };
    if (failed >= MAX_FAILED) {
      const factor = 2 ** Math.min(failed - MAX_FAILED, 4); // 15m, 30m, 1h, 2h, 4h
      update.lockedUntil = new Date(Date.now() + LOCK_BASE_MS * factor);
      await audit.record(
        { action: 'auth.locked', targetType: 'user', targetId: String(user._id), meta: { failed } },
        meta,
      );
    }
    await UserModel.updateOne({ _id: user._id }, { $set: update });
  }

  async login(
    email: string,
    password: string,
    meta: ClientMeta,
  ): Promise<{ mfaRequired: true; ticket: string } | { mfaRequired: false; session: IssuedSession }> {
    const user = await UserModel.findOne({ email })
      .select(
        '+passwordHash email status emailVerifiedAt failedLogins lockedUntil mfa.enabled tokenVersion roles',
      )
      .lean();
    if (!user) {
      await dummyVerify(password);
      throw genericLoginError();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw tooMany();
    if (!(await verifyPassword(user.passwordHash, password))) {
      await this.registerFailure(user, meta);
      await audit.record(
        { action: 'auth.login_failed', targetType: 'user', targetId: String(user._id) },
        meta,
      );
      throw genericLoginError();
    }
    // Members with a pending deletion may still sign in (to cancel it); suspended members may not.
    if (user.status === 'suspended')
      throw new AppError(
        403,
        ErrorCode.FORBIDDEN,
        'This account is suspended. Contact your college administrator.',
      );
    if (!user.emailVerifiedAt)
      throw new AppError(
        403,
        ErrorCode.EMAIL_NOT_VERIFIED,
        'Confirm your email first. We can send a new link.',
      );
    await UserModel.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null } });

    if (user.mfa?.enabled) {
      const ticket = await this.d.tokens.signMfaTicket({
        sub: String(user._id),
        tid: String(requireTenantId()),
      });
      return { mfaRequired: true, ticket };
    }
    return { mfaRequired: false, session: await this.createSession(user._id, user.tokenVersion, meta) };
  }

  async loginWithMfa(
    tenant: TenantRecord,
    ticket: string,
    proof: { code?: string; recoveryCode?: string },
    meta: ClientMeta,
  ): Promise<IssuedSession> {
    const claims = await this.d.tokens.verifyMfaTicket(ticket);
    if (!claims || claims.tid !== String(tenant._id))
      throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Your sign-in expired. Start again.');
    const user = await UserModel.findById(claims.sub)
      .select(
        '+mfa.secretEnc +mfa.lastTimeStep +mfa.recoveryCodeHashes status failedLogins lockedUntil tokenVersion mfa.enabled',
      )
      .lean();
    if (!user || user.status === 'suspended' || !user.mfa?.enabled || !user.mfa.secretEnc)
      throw unauthenticated();
    if (user.lockedUntil && user.lockedUntil > new Date()) throw tooMany();

    let ok = false;
    if (proof.code) {
      const step = await this.checkTotp(
        this.d.cipher.decrypt(user.mfa.secretEnc),
        proof.code,
        user.mfa.lastTimeStep ?? 0,
      );
      // Atomic replay guard: only one request can advance lastTimeStep to this step.
      ok =
        step !== null &&
        (
          await UserModel.updateOne(
            { _id: user._id, 'mfa.lastTimeStep': { $lt: step } },
            { $set: { 'mfa.lastTimeStep': step } },
          )
        ).modifiedCount === 1;
    } else if (proof.recoveryCode) {
      const h = sha256(proof.recoveryCode.toLowerCase());
      ok =
        (
          await UserModel.updateOne(
            { _id: user._id, 'mfa.recoveryCodeHashes': h },
            { $pull: { 'mfa.recoveryCodeHashes': h } },
          )
        ).modifiedCount === 1;
      if (ok)
        await audit.record(
          {
            action: 'auth.recovery_code_used',
            actorId: String(user._id),
            targetType: 'user',
            targetId: String(user._id),
          },
          meta,
        );
    }
    if (!ok) {
      await this.registerFailure(user, meta);
      throw new AppError(
        401,
        ErrorCode.UNAUTHENTICATED,
        'That code didn’t work. Check your authenticator app and try again.',
      );
    }
    await UserModel.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null } });
    return this.createSession(user._id, user.tokenVersion, meta);
  }

  /** Returns the matched time step, or null. Tolerates ±1 step of clock drift. */
  private async checkTotp(secret: string, code: string, afterTimeStep: number): Promise<number | null> {
    const r = await verifyTotp({ secret, token: code, epochTolerance: 30, afterTimeStep });
    return r.valid ? (r as { timeStep: number }).timeStep : null;
  }

  // ── sessions ─────────────────────────
  /** The tenant always comes from the request context, never from a loaded document. */
  async createSession(
    userId: Types.ObjectId,
    tokenVersion: number,
    meta: ClientMeta,
  ): Promise<IssuedSession> {
    const tenantId = requireTenantId();
    const refreshToken = randomToken();
    const session = await SessionModel.create({
      userId,
      currentTokenHash: sha256(refreshToken),
      device: meta.device,
      createdIpPrefix: meta.ipPrefix ?? null,
      expiresAt: new Date(Date.now() + this.d.refreshTtlSec * 1000),
    });
    await UserModel.updateOne({ _id: userId }, { $set: { lastLoginAt: new Date() } });
    await audit.record(
      {
        action: 'auth.login',
        actorId: String(userId),
        targetType: 'session',
        targetId: String(session._id),
        meta: { device: meta.device },
      },
      meta,
    );
    const accessToken = await this.d.tokens.signAccess({
      sub: String(userId),
      tid: String(tenantId),
      sid: String(session._id),
      ver: tokenVersion,
    });
    return { accessToken, expiresIn: this.d.tokens.accessTtl, refreshToken, sessionId: String(session._id) };
  }

  /** Rotate the refresh token. Presenting an already-rotated token revokes the whole session. */
  async refresh(refreshToken: string, meta: ClientMeta): Promise<IssuedSession> {
    const hash = sha256(refreshToken);
    const next = randomToken();
    const session = await SessionModel.findOneAndUpdate(
      { currentTokenHash: hash, revokedAt: null, expiresAt: { $gt: new Date() } },
      {
        $set: { currentTokenHash: sha256(next), lastUsedAt: new Date() },
        $push: { usedTokenHashes: { $each: [hash], $slice: -50 } },
      },
      { returnDocument: 'after' },
    ).lean();
    if (!session) {
      const reused = await SessionModel.findOneAndUpdate(
        { usedTokenHashes: hash, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: 'refresh_token_reuse' } },
      ).lean();
      if (reused) {
        await audit.record(
          {
            action: 'auth.refresh_reuse_detected',
            actorId: String(reused.userId),
            targetType: 'session',
            targetId: String(reused._id),
          },
          meta,
        );
      }
      throw unauthenticated();
    }
    const user = await UserModel.findById(session.userId).select('status tokenVersion').lean();
    if (!user || user.status === 'suspended') {
      await SessionModel.updateOne(
        { _id: session._id },
        { $set: { revokedAt: new Date(), revokedReason: 'user_inactive' } },
      );
      throw unauthenticated();
    }
    const accessToken = await this.d.tokens.signAccess({
      sub: String(user._id),
      tid: String(requireTenantId()),
      sid: String(session._id),
      ver: user.tokenVersion,
    });
    return {
      accessToken,
      expiresIn: this.d.tokens.accessTtl,
      refreshToken: next,
      sessionId: String(session._id),
    };
  }

  async logout(refreshToken: string | undefined, meta: ClientMeta): Promise<void> {
    if (!refreshToken) return;
    const s = await SessionModel.findOneAndUpdate(
      { currentTokenHash: sha256(refreshToken), revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
    ).lean();
    if (s)
      await audit.record(
        { action: 'auth.logout', actorId: String(s.userId), targetType: 'session', targetId: String(s._id) },
        meta,
      );
  }

  async listSessions(userId: string, currentSessionId: string) {
    const rows = await SessionModel.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ lastUsedAt: -1 })
      .select('device createdAt lastUsedAt createdIpPrefix')
      .lean();
    return rows.map((s) => ({
      id: String(s._id),
      device: s.device,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      current: String(s._id) === currentSessionId,
    }));
  }

  /** Object-level check: the filter includes userId, so another user's session id simply isn't found. */
  async revokeSession(userId: string, sessionId: string, meta: ClientMeta): Promise<boolean> {
    const r = await SessionModel.updateOne(
      { _id: sessionId, userId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'user_revoked' } },
    );
    if (r.modifiedCount)
      await audit.record(
        { action: 'auth.session_revoked', actorId: userId, targetType: 'session', targetId: sessionId },
        meta,
      );
    return r.modifiedCount === 1;
  }

  async revokeAllSessions(
    userId: Types.ObjectId | string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const filter: Record<string, unknown> = { userId, revokedAt: null };
    if (exceptSessionId) filter._id = { $ne: exceptSessionId };
    const r = await SessionModel.updateMany(filter, {
      $set: { revokedAt: new Date(), revokedReason: reason },
    });
    return r.modifiedCount;
  }

  // ── passwords ─────────────────────────
  async forgotPassword(tenant: TenantRecord, email: string, meta: ClientMeta): Promise<void> {
    const user = await UserModel.findOne({ email, status: 'active' }).select('_id email').lean();
    if (!user) return;
    const token = await this.issueToken(user._id, 'password_reset', RESET_TTL_MS);
    await this.sendMail(
      tenant,
      user.email,
      'Reset your password',
      'Reset your password',
      'Use this link to choose a new password. It works for 30 minutes and only once.',
      { label: 'Choose a new password', url: this.tenantUrl(tenant, `/reset-password?token=${token}`) },
    );
    await audit.record(
      { action: 'auth.password_reset_requested', targetType: 'user', targetId: String(user._id) },
      meta,
    );
  }

  async resetPassword(
    tenant: TenantRecord,
    token: string,
    password: string,
    meta: ClientMeta,
  ): Promise<void> {
    const pending = await AuthTokenModel.findOne({
      tokenHash: sha256(token),
      purpose: 'password_reset',
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!pending) throw invalidLink();
    const user = await UserModel.findById(pending.userId).select('name email').lean();
    if (!user) throw invalidLink();
    await this.assertPasswordAcceptable(password, [user.name, user.email, tenant.branding.displayName]);
    if (!(await this.consumeToken(token, 'password_reset'))) throw invalidLink();
    await UserModel.updateOne(
      { _id: user._id },
      // A completed reset also proves control of the inbox, so the email counts as verified.
      {
        $set: {
          passwordHash: await hashPassword(password),
          failedLogins: 0,
          lockedUntil: null,
          emailVerifiedAt: new Date(),
        },
        $inc: { tokenVersion: 1 },
      },
    );
    await this.revokeAllSessions(user._id, 'password_reset');
    await audit.record(
      {
        action: 'auth.password_reset',
        actorId: String(user._id),
        targetType: 'user',
        targetId: String(user._id),
      },
      meta,
    );
    await this.sendMail(
      tenant,
      user.email,
      'Your password was changed',
      'Your password was changed',
      'You have been signed out on all devices. If this wasn’t you, reset your password again and contact your college administrator.',
    );
  }

  /** Invitation for a newly created college admin: a long-lived reset token, sent as "set your password". */
  async sendInvite(tenant: TenantRecord, userId: Types.ObjectId, email: string, name: string): Promise<void> {
    const token = await this.issueToken(userId, 'password_reset', INVITE_TTL_MS);
    await this.sendMail(
      tenant,
      email,
      `You’re the administrator of ${tenant.branding.displayName} on ${APP_NAME}`,
      `Welcome, ${name.split(' ')[0]}`,
      'Set your password to start setting up your college. The link works for 72 hours. You will be asked to turn on two-factor authentication.',
      { label: 'Set password', url: this.tenantUrl(tenant, `/reset-password?token=${token}`) },
    );
  }

  async changePassword(
    tenant: TenantRecord,
    userId: string,
    sessionId: string,
    current: string,
    next: string,
    meta: ClientMeta,
  ): Promise<{ accessToken: string }> {
    const user = await UserModel.findById(userId).select('+passwordHash name email tokenVersion').lean();
    if (!user || !(await verifyPassword(user.passwordHash, current)))
      throw badRequest('Your current password is incorrect');
    await this.assertPasswordAcceptable(next, [user.name, user.email, tenant.branding.displayName]);
    await UserModel.updateOne(
      { _id: userId },
      { $set: { passwordHash: await hashPassword(next) }, $inc: { tokenVersion: 1 } },
    );
    await this.revokeAllSessions(userId, 'password_changed', sessionId);
    await audit.record(
      { action: 'auth.password_changed', actorId: userId, targetType: 'user', targetId: userId },
      meta,
    );
    const accessToken = await this.d.tokens.signAccess({
      sub: userId,
      tid: String(tenant._id),
      sid: sessionId,
      ver: user.tokenVersion + 1,
    });
    return { accessToken };
  }

  // ── TOTP 2FA ─────────────────────────
  async mfaSetup(
    userId: string,
    label: string,
    issuer: string,
  ): Promise<{ otpauthUri: string; qrSvg: string; secret: string }> {
    const user = await UserModel.findById(userId).select('mfa.enabled').lean();
    if (!user) throw unauthenticated();
    if (user.mfa?.enabled) throw badRequest('Two-factor authentication is already on');
    const secret = generateSecret();
    await UserModel.updateOne(
      { _id: userId },
      { $set: { 'mfa.pendingSecretEnc': this.d.cipher.encrypt(secret) } },
    );
    const otpauthUri = generateURI({ issuer, label, secret });
    const qrSvg = await QRCode.toString(otpauthUri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { otpauthUri, qrSvg, secret };
  }

  async mfaEnable(
    userId: string,
    sessionId: string,
    code: string,
    meta: ClientMeta,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await UserModel.findById(userId).select('+mfa.pendingSecretEnc mfa.enabled').lean();
    if (!user?.mfa?.pendingSecretEnc) throw badRequest('Start two-factor setup again');
    const secret = this.d.cipher.decrypt(user.mfa.pendingSecretEnc);
    const step = await this.checkTotp(secret, code, 0);
    if (step === null)
      throw badRequest('That code didn’t match. Check the time on your phone and try again.');
    const recoveryCodes = Array.from({ length: 10 }, () => {
      const raw = randomToken(8)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, 'x');
      return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    });
    await UserModel.updateOne(
      { _id: userId },
      {
        $set: {
          'mfa.enabled': true,
          'mfa.secretEnc': this.d.cipher.encrypt(secret),
          'mfa.pendingSecretEnc': null,
          'mfa.lastTimeStep': step,
          'mfa.recoveryCodeHashes': recoveryCodes.map((c) => sha256(c)),
        },
      },
    );
    await this.revokeAllSessions(userId, 'mfa_enabled', sessionId);
    await audit.record(
      { action: 'auth.mfa_enabled', actorId: userId, targetType: 'user', targetId: userId },
      meta,
    );
    return { recoveryCodes };
  }

  async mfaDisable(
    userId: string,
    roles: Role[],
    password: string,
    code: string,
    meta: ClientMeta,
  ): Promise<void> {
    if (requiresMfa(roles))
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Administrators must keep two-factor authentication on');
    const user = await UserModel.findById(userId)
      .select('+passwordHash +mfa.secretEnc +mfa.lastTimeStep mfa.enabled')
      .lean();
    if (!user?.mfa?.enabled || !user.mfa.secretEnc) throw badRequest('Two-factor authentication is not on');
    const step = await this.checkTotp(
      this.d.cipher.decrypt(user.mfa.secretEnc),
      code,
      user.mfa.lastTimeStep ?? 0,
    );
    if (!(await verifyPassword(user.passwordHash, password)) || step === null)
      throw badRequest('Password or code is incorrect');
    await UserModel.updateOne(
      { _id: userId },
      {
        $set: {
          'mfa.enabled': false,
          'mfa.secretEnc': null,
          'mfa.recoveryCodeHashes': [],
          'mfa.lastTimeStep': step,
        },
      },
    );
    await audit.record(
      { action: 'auth.mfa_disabled', actorId: userId, targetType: 'user', targetId: userId },
      meta,
    );
  }

  /** Analytics: members with a session used since a date (no other activity is tracked). */
  async activeSince(since: Date) {
    return (await SessionModel.distinct('userId', { lastUsedAt: { $gte: since } })).length;
  }
}
