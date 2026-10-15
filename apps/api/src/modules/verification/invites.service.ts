import type { Request } from 'express';
import { Types } from 'mongoose';
import { APP_NAME } from '@campuslink/shared';
import { InviteModel } from './verification.model.js';
import { UserModel } from '../auth/user.model.js';
import type { FieldCipher } from '../../lib/crypto.js';
import type { MailProvider } from '../../lib/mailer.js';
import { renderEmail } from '../../lib/mailer.js';
import { tenantOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { AuthService } from '../auth/auth.service.js';
import { audit } from '../audit/audit.service.js';

const INVITE_TTL_MS = 30 * 24 * 3600_000;

export class InvitesService {
  constructor(
    private readonly cipher: FieldCipher,
    private readonly mailer: MailProvider,
    private readonly auth: AuthService,
  ) {}

  /** Invites people by email. Emails are never stored in clear: only a blind index to match at sign-up. */
  async invite(req: Request, actorId: string, emails: string[], kind: 'student' | 'alumni' | null = null) {
    const tenant = tenantOf(req);
    let sent = 0,
      existing = 0;
    for (const email of [...new Set(emails)]) {
      if (await UserModel.exists({ email })) {
        existing++;
        continue;
      }
      await InviteModel.findOneAndUpdate(
        { emailIndex: this.cipher.blindIndex(email) },
        {
          $set: {
            kind,
            invitedBy: new Types.ObjectId(actorId),
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
            acceptedAt: null,
          },
        },
        { upsert: true },
      );
      const url = this.auth.tenantUrl(tenant, `/sign-up?email=${encodeURIComponent(email)}`);
      const body = renderEmail({
        college: tenant.branding.displayName,
        heading: `You’re invited to ${tenant.branding.shortName} on ${APP_NAME}`,
        body: `${tenant.branding.displayName} invited you to its private guidance network. Sign up with this email address within 30 days and your account is verified automatically.`,
        cta: { label: 'Join now', url },
        footer: `${APP_NAME} · private to ${tenant.branding.displayName}.`,
      });
      await this.mailer
        .send({ to: email, subject: `Invitation from ${tenant.branding.shortName}`, ...body })
        .catch(() => undefined);
      sent++;
    }
    await audit.record(
      { action: 'users.invited', actorId, targetType: 'invite', meta: { sent, existing } },
      requestMeta(req),
    );
    return { sent, existing };
  }

  /** Consumes a matching invite after the invitee confirms their email. */
  async consume(email: string): Promise<{ kind: 'student' | 'alumni' | null } | null> {
    const inv = await InviteModel.findOneAndUpdate(
      { emailIndex: this.cipher.blindIndex(email), acceptedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { acceptedAt: new Date() } },
    ).lean();
    return inv ? { kind: (inv.kind as 'student' | 'alumni' | null) ?? null } : null;
  }
}
