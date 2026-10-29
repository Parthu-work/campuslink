import { Types } from 'mongoose';
import { ErrorCode, FREE_MAIL_DOMAINS, APP_NAME, type Role } from '@campuslink/shared';
import { OtpChallengeModel, VerificationRequestModel } from './verification.model.js';
import { WhitelistModel } from '../imports/whitelist.model.js';
import { maskEmail, maskPhone } from '../imports/whitelist.service.js';
import { UserModel } from '../auth/user.model.js';
import { FileModel } from '../files/file.model.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { FilesService } from '../files/files.service.js';
import type { InvitesService } from './invites.service.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';
import type { FieldCipher } from '../../lib/crypto.js';
import type { MailProvider } from '../../lib/mailer.js';
import { renderEmail } from '../../lib/mailer.js';
import type { OtpService } from './otp.service.js';
import type { GuardianService } from './guardian.service.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';

const ID_PHOTO_RETENTION_MS = 30 * 24 * 3600_000;
const roleFor = (kind: 'student' | 'alumni'): Role => (kind === 'alumni' ? 'ALUMNI' : 'STUDENT');

export interface VerificationDeps {
  cipher: FieldCipher;
  mailer: MailProvider;
  otp: OtpService;
  profiles: ProfilesService;
  files: FilesService;
  invites: InvitesService;
}

export class VerificationService {
  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    return VerificationRequestModel.find({ userId }).select('method status createdAt decidedAt').lean();
  }

  async eraseFor(userId: string) {
    const u = new Types.ObjectId(userId);
    await Promise.all([
      VerificationRequestModel.deleteMany({ userId: u }),
      OtpChallengeModel.deleteMany({ userId: u }),
    ]);
  }

  constructor(private readonly d: VerificationDeps) {}

  /** Set by the app (guardian consent shares the verification queue). */
  guardian: GuardianService | null = null;

  async status(userId: string) {
    const u = await UserModel.findById(userId).select('verified').lean();
    const pending = await VerificationRequestModel.findOne({
      userId,
      status: { $in: ['pending', 'rejected'] },
    })
      .sort({ _id: -1 })
      .select('status reason createdAt')
      .lean();
    return {
      verified: !!u?.verified,
      smsAvailable: this.d.otp.phoneAvailable,
      request: pending
        ? { status: pending.status, reason: pending.reason, createdAt: pending.createdAt }
        : null,
    };
  }

  /** Marks the user verified and claims the whitelist record atomically. Returns false if already claimed. */
  async claim(
    userId: string,
    recordId: Types.ObjectId,
    method: string,
    meta: RequestMetaLite,
    actorId: string = userId,
  ): Promise<boolean> {
    const rec = await WhitelistModel.findOneAndUpdate(
      { _id: recordId, status: 'unclaimed' },
      { $set: { status: 'claimed', claimedBy: new Types.ObjectId(userId), claimedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean();
    if (!rec) return false;
    const user = await UserModel.findById(userId).select('roles').lean();
    const roles = (user?.roles ?? []) as Role[];
    // The college's list is authoritative for student vs alumni; staff roles are kept.
    const nextRoles = [
      ...new Set([
        ...roles.filter((r) => r !== 'STUDENT' && r !== 'ALUMNI'),
        roleFor(rec.kind as 'student' | 'alumni'),
      ]),
    ];
    await UserModel.updateOne({ _id: userId }, { $set: { verified: true, roles: nextRoles } });
    await this.d.profiles.sync(userId, { branch: rec.branch ?? null, gradYear: rec.gradYear ?? null });
    await audit.record(
      {
        action: 'verification.approved',
        actorId,
        targetType: 'user',
        targetId: userId,
        meta: { method, record: String(rec._id) },
      },
      meta,
    );
    return true;
  }

  async sendEmailCode(tenant: TenantRecord, to: string, code: string, what: string) {
    const content = renderEmail({
      college: tenant.branding.displayName,
      heading: `Your ${APP_NAME} code: ${code}`,
      body: `Use this code to ${what}. It expires in 10 minutes. If you did not request it, ignore this email: nothing changes without the code.`,
      footer: `${APP_NAME} · private to ${tenant.branding.displayName}.`,
    });
    await this.d.mailer.send({
      to,
      subject: `${code} is your ${tenant.branding.shortName} verification code`,
      ...content,
    });
  }

  // ── roll number + OTP ─────────────────────────────
  async start(
    tenant: TenantRecord,
    userId: string,
    rollNumber: string,
    gradYear: number | undefined,
    meta: RequestMetaLite,
  ) {
    const user = await UserModel.findById(userId)
      .select('verified email emailVerifiedAt +phoneEnc phoneVerifiedAt locale otpChannel')
      .lean();
    if (!user) throw notFound('User');
    if (user.verified) throw badRequest('You are already verified');
    await audit.record(
      { action: 'verification.attempt', actorId: userId, targetType: 'user', targetId: userId },
      meta,
    );
    const noMatch = { status: 'no_match' as const };
    const rec = await WhitelistModel.findOne({ rollNumber }).lean();
    if (!rec || rec.status !== 'unclaimed') return noMatch;
    if (rec.kind === 'alumni' && rec.gradYear && rec.gradYear !== gradYear) return noMatch;

    // The college already has this person's email or mobile, and they proved they own it.
    if (
      rec.emailIndex &&
      user.email &&
      user.emailVerifiedAt &&
      this.d.cipher.blindIndexes(user.email).includes(rec.emailIndex)
    ) {
      return (await this.claim(userId, rec._id, 'roll_email_match', meta))
        ? { status: 'verified' as const }
        : noMatch;
    }
    if (
      rec.phoneIndex &&
      user.phoneEnc &&
      user.phoneVerifiedAt &&
      this.d.cipher.blindIndexes(this.d.cipher.decrypt(user.phoneEnc)).includes(rec.phoneIndex)
    ) {
      return (await this.claim(userId, rec._id, 'roll_phone_match', meta))
        ? { status: 'verified' as const }
        : noMatch;
    }
    if (rec.emailEnc) {
      const to = this.d.cipher.decrypt(rec.emailEnc);
      const ch = await this.d.otp.issue({
        purpose: 'roll_claim',
        userId,
        targetId: rec._id,
        channel: 'email',
      });
      await this.sendEmailCode(tenant, to, ch.code, 'confirm your college record');
      return { status: 'code_sent' as const, challengeId: ch.id, destination: maskEmail(to) };
    }
    if (rec.phoneEnc && this.d.otp.phoneAvailable) {
      const to = this.d.cipher.decrypt(rec.phoneEnc);
      const ch = await this.d.otp.issue({ purpose: 'roll_claim', userId, targetId: rec._id, phone: to });
      await this.d.otp.sendToPhone(ch.id, to, ch.code, user.locale ?? 'en', user.otpChannel ?? undefined);
      return { status: 'code_sent' as const, challengeId: ch.id, destination: maskPhone(to) };
    }
    return { status: 'no_contact' as const };
  }

  async confirm(userId: string, challengeId: string, code: string, meta: RequestMetaLite) {
    const ch = await this.d.otp.check(challengeId, ['roll_claim'], code, { userId });
    if (!ch.targetId || !(await this.claim(userId, ch.targetId, 'roll_otp', meta)))
      throw conflict(
        'This college record was just claimed by someone else. Contact your college administrator.',
      );
    return { verified: true };
  }

  /** Called after a user confirms their email: an admin invite or a matching list record verifies them. */
  async onEmailVerified(userId: string, email: string, meta: RequestMetaLite) {
    const user = await UserModel.findById(userId).select('verified roles').lean();
    if (!user || user.verified) return;
    const rec = await WhitelistModel.findOne({
      emailIndex: { $in: this.d.cipher.blindIndexes(email) },
      status: 'unclaimed',
    }).lean();
    if (rec && (await this.claim(userId, rec._id, 'list_email_match', meta))) return;
    const invite = await this.d.invites.consume(email);
    if (invite) {
      const roles = invite.kind ? [roleFor(invite.kind)] : (user.roles as Role[]);
      await UserModel.updateOne({ _id: userId }, { $set: { verified: true, roles } });
      await this.d.profiles.sync(userId);
      await audit.record(
        {
          action: 'verification.approved',
          actorId: userId,
          targetType: 'user',
          targetId: userId,
          meta: { method: 'admin_invite' },
        },
        meta,
      );
    }
  }

  /**
   * Called after a member proves a phone number (phone sign-up): the one unclaimed list record with
   * that mobile verifies them. Two records sharing a number (a parent's phone) verify nobody.
   */
  async onPhoneVerified(userId: string, phone: string, meta: RequestMetaLite) {
    const user = await UserModel.findById(userId).select('verified').lean();
    if (!user || user.verified) return;
    const recs = await WhitelistModel.find({
      phoneIndex: { $in: this.d.cipher.blindIndexes(phone) },
      status: 'unclaimed',
    })
      .limit(2)
      .lean();
    if (recs.length === 1 && recs[0]) await this.claim(userId, recs[0]._id, 'list_phone_match', meta);
  }

  // ── college ID fallback ─────────────────────────────
  async requestWithId(
    userId: string,
    file: Express.Multer.File | undefined,
    fields: { rollNumber: string; gradYear?: number | undefined; note?: string | undefined },
    meta: RequestMetaLite,
  ) {
    if (!file) throw badRequest('Attach a photo of your college ID');
    const user = await UserModel.findById(userId).select('verified').lean();
    if (user?.verified) throw badRequest('You are already verified');
    if (await VerificationRequestModel.exists({ userId, status: 'pending' }))
      throw conflict('Your request is already waiting for review');
    const stored = await this.d.files.storeImage(userId, 'id_card', file.buffer);
    const req = await VerificationRequestModel.create({
      userId: new Types.ObjectId(userId),
      method: 'id_card',
      rollNumber: fields.rollNumber,
      gradYear: fields.gradYear ?? null,
      note: fields.note ?? '',
      fileId: new Types.ObjectId(stored.id),
    });
    await audit.record(
      {
        action: 'verification.requested',
        actorId: userId,
        targetType: 'verification',
        targetId: String(req._id),
        meta: { method: 'id_card' },
      },
      meta,
    );
    return { id: String(req._id), status: 'pending' };
  }

  async queue(status: 'pending' | 'approved' | 'rejected', cursor?: string) {
    const filter: Record<string, unknown> = { status };
    if (cursor) filter._id = { $lt: new Types.ObjectId(cursor) };
    const rows = await VerificationRequestModel.find(filter).sort({ _id: -1 }).limit(21).lean();
    const page = rows.slice(0, 20);
    const users = await UserModel.find({ _id: { $in: page.map((r) => r.userId) } })
      .select('name email roles')
      .lean();
    const recs = await WhitelistModel.find({ rollNumber: { $in: page.map((r) => r.rollNumber) } })
      .select('rollNumber name gradYear kind status')
      .lean();
    return {
      items: page.map((r) => {
        const u = users.find((x) => String(x._id) === String(r.userId));
        const rec = recs.find((x) => x.rollNumber === r.rollNumber);
        return {
          id: String(r._id),
          status: r.status,
          rollNumber: r.rollNumber,
          gradYear: r.gradYear,
          note: r.note,
          method: r.method,
          fileId: r.fileId ? String(r.fileId) : null,
          // In full: the reviewer compares it with the college's admission records.
          guardianPhone: r.guardianPhoneEnc ? this.d.cipher.decrypt(r.guardianPhoneEnc) : null,
          createdAt: r.createdAt,
          reason: r.reason,
          user: u ? { id: String(u._id), name: u.name, email: u.email, roles: u.roles } : null,
          listMatch: rec
            ? { name: rec.name, gradYear: rec.gradYear, kind: rec.kind, status: rec.status }
            : null,
        };
      }),
      nextCursor: rows.length > 20 ? String(page.at(-1)?._id) : null,
    };
  }

  async decide(
    tenant: TenantRecord,
    reviewerId: string,
    id: string,
    decision: 'approve' | 'reject',
    reason: string | undefined,
    meta: RequestMetaLite,
  ) {
    const r = await VerificationRequestModel.findOne({ _id: id, status: 'pending' }).lean();
    if (!r) throw notFound('Pending request');
    if (decision === 'reject' && !reason)
      throw badRequest('Give a short reason so the person knows what to fix');
    const user = await UserModel.findById(r.userId).select('email name roles').lean();
    if (!user) throw notFound('User');
    if (r.method === 'guardian_manual') {
      // A minor's guardian number the college checked against its admission records (B2).
      if (decision === 'approve') {
        if (!r.guardianPhoneEnc || !this.guardian) throw conflict('This request has no number');
        await this.guardian.approveManual(String(r.userId), r.guardianPhoneEnc);
      }
      await audit.record(
        {
          action: decision === 'approve' ? 'verification.approved' : 'verification.rejected',
          actorId: reviewerId,
          targetType: 'user',
          targetId: String(r.userId),
          meta: { method: 'guardian_manual' },
        },
        meta,
      );
      await VerificationRequestModel.updateOne(
        { _id: id },
        {
          $set: {
            status: decision === 'approve' ? 'approved' : 'rejected',
            reviewerId: new Types.ObjectId(reviewerId),
            reason: reason ?? null,
            decidedAt: new Date(),
            // The number now lives on the roster record (or was refused): not kept here.
            guardianPhoneEnc: null,
          },
        },
      );
      await this.guardian?.manualDecided(String(r.userId), decision === 'approve');
      return { status: decision === 'approve' ? 'approved' : 'rejected' };
    }
    if (decision === 'approve') {
      let rec = await WhitelistModel.findOne({ rollNumber: r.rollNumber }).lean();
      if (rec && rec.status === 'claimed')
        throw conflict('That roll number is already claimed by another member');
      if (!rec) {
        const kind = (user.roles as Role[]).includes('ALUMNI') ? 'alumni' : 'student';
        const created = await WhitelistModel.create({
          rollNumber: r.rollNumber,
          name: user.name,
          gradYear: r.gradYear,
          kind,
          source: 'manual',
        });
        rec = created.toObject();
      }
      if (!(await this.claim(String(r.userId), rec._id, 'id_card', meta, reviewerId)))
        throw conflict('That roll number was just claimed');
    } else {
      await audit.record(
        {
          action: 'verification.rejected',
          actorId: reviewerId,
          targetType: 'user',
          targetId: String(r.userId),
          meta: { method: 'id_card' },
        },
        meta,
      );
    }
    await VerificationRequestModel.updateOne(
      { _id: id },
      {
        $set: {
          status: decision === 'approve' ? 'approved' : 'rejected',
          reviewerId: new Types.ObjectId(reviewerId),
          reason: reason ?? null,
          decidedAt: new Date(),
        },
      },
    );
    // Retention: the ID photo is not needed after a decision.
    if (r.fileId)
      await FileModel.updateOne(
        { _id: r.fileId },
        { $set: { deleteAfter: new Date(Date.now() + ID_PHOTO_RETENTION_MS) } },
      );
    const content = renderEmail({
      college: tenant.branding.displayName,
      heading: decision === 'approve' ? 'You’re verified' : 'We couldn’t verify you yet',
      body:
        decision === 'approve'
          ? 'Your college confirmed your ID. You now have full access.'
          : `Your college reviewed your ID and could not verify it: ${reason}. You can try again from the app.`,
      footer: `${APP_NAME} · private to ${tenant.branding.displayName}.`,
    });
    if (user.email)
      await this.d.mailer
        .send({
          to: user.email,
          subject: decision === 'approve' ? 'You’re verified' : 'Verification update',
          ...content,
        })
        .catch(() => undefined);
    return { status: decision === 'approve' ? 'approved' : 'rejected' };
  }

  /** Admin correction: un-verify a member and free their list record (e.g. a mistaken claim). */
  async revoke(reviewerId: string, userId: string, meta: RequestMetaLite) {
    const u = await UserModel.findById(userId).select('roles verified').lean();
    if (!u) throw notFound('User');
    if ((u.roles as Role[]).some((r) => r === 'COLLEGE_ADMIN' || r === 'TPO' || r === 'FACULTY'))
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Staff accounts are managed through roles');
    await UserModel.updateOne({ _id: userId }, { $set: { verified: false } });
    await WhitelistModel.updateMany(
      { claimedBy: userId },
      { $set: { status: 'unclaimed', claimedBy: null, claimedAt: null } },
    );
    await this.d.profiles.sync(userId);
    await audit.record(
      { action: 'verification.revoked', actorId: reviewerId, targetType: 'user', targetId: userId },
      meta,
    );
  }

  // ── company email badge ─────────────────────────────
  async startCompany(
    tenant: TenantRecord,
    userId: string,
    email: string,
    company: string,
    meta: RequestMetaLite,
  ) {
    const u = await UserModel.findById(userId).select('roles verified').lean();
    if (!u?.verified || !(u.roles as Role[]).includes('ALUMNI'))
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Only verified alumni can add a company badge');
    const domain = email.split('@')[1] ?? '';
    if (FREE_MAIL_DOMAINS.includes(domain))
      throw badRequest('Use your work email (personal email providers cannot confirm where you work)');
    const ch = await this.d.otp.issue({
      purpose: 'company_email',
      userId,
      company: { name: company, domain },
      channel: 'email',
    });
    await this.sendEmailCode(tenant, email, ch.code, `confirm you work at ${company}`);
    await audit.record(
      {
        action: 'profile.company_verification_started',
        actorId: userId,
        targetType: 'user',
        targetId: userId,
        meta: { domain },
      },
      meta,
    );
    return { challengeId: ch.id, destination: maskEmail(email) };
  }

  async confirmCompany(userId: string, challengeId: string, code: string, meta: RequestMetaLite) {
    const ch = await this.d.otp.check(challengeId, ['company_email'], code, { userId });
    await this.d.profiles.setCompanyVerified(userId, ch.company?.name ?? '', ch.company?.domain ?? '');
    await audit.record(
      {
        action: 'profile.company_verified',
        actorId: userId,
        targetType: 'user',
        targetId: userId,
        meta: { domain: ch.company?.domain ?? '' },
      },
      meta,
    );
    return { company: ch.company?.name, domain: ch.company?.domain };
  }

  /** Analytics: verification requests waiting for a decision. */
  pendingCount() {
    return VerificationRequestModel.countDocuments({ status: 'pending' });
  }
}
