import { Schema, Types, type InferSchemaType } from 'mongoose';
import type { JWTVerifyGetKey } from 'jose';
import type { z } from 'zod';
import {
  SSO_PROVIDERS,
  safeReturnPath,
  type SsoError,
  type SsoPendingView,
  type SsoProvider,
  type SsoSettingsView,
  type ssoCompleteBody,
  type ssoSettingsBody,
} from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../../db/models.js';
import { randomToken, safeEqual, sha256, type FieldCipher } from '../../../lib/crypto.js';
import { badRequest, notFound } from '../../../lib/errors.js';
import { audit, type RequestMetaLite } from '../../audit/audit.service.js';
import { UserModel } from '../user.model.js';
import type { AuthService, ClientMeta, IssuedSession } from '../auth.service.js';
import type { TenantRecord } from '../../tenants/tenant.cache.js';
import type { AuthState } from '../../../types.js';
import { endpointsOf, exchangeCode, OidcError, remoteKeys, verifyIdToken } from './oidc.js';

/**
 * Single sign-on with the college's Google Workspace or Microsoft Entra ID (prompt 2, G9). It is
 * optional per college and only for its email domains; it ends in the same session (and the same
 * two-factor step for admins) as a password sign-in. Roster verification still applies.
 */
const providerSettings = {
  enabled: { type: Boolean, default: false },
  clientId: { type: String, default: null },
  /** Encrypted with the field cipher; never returned. */
  clientSecretEnc: { type: String, default: null },
  directoryId: { type: String, default: null },
};
const settingsSchema = new Schema(
  {
    key: { type: String, default: 'sso' },
    google: { type: new Schema(providerSettings, { _id: false }), default: () => ({}) },
    microsoft: { type: new Schema(providerSettings, { _id: false }), default: () => ({}) },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
settingsSchema.index({ tenantId: 1, key: 1 }, { unique: true });
type ProviderDoc = {
  enabled: boolean;
  clientId: string | null;
  clientSecretEnc: string | null;
  directoryId: string | null;
};
/** Set up enough to sign in with. */
type UsableProvider = ProviderDoc & { clientId: string; clientSecretEnc: string };
type SettingsDoc = InferSchemaType<typeof settingsSchema> & { google: ProviderDoc; microsoft: ProviderDoc };
export const SsoSettingsModel = defineTenantModel('SsoSettings', settingsSchema);

/** One sign-in attempt between start and callback (single use, ten minutes). */
const stateSchema = new Schema(
  {
    stateHash: { type: String, required: true },
    provider: { type: String, enum: SSO_PROVIDERS, required: true },
    nonce: { type: String, required: true },
    codeVerifier: { type: String, required: true },
    next: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
stateSchema.index({ tenantId: 1, stateHash: 1 }, { unique: true });
stateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const SsoStateModel = defineTenantModel('SsoState', stateSchema);

/** A first sign-in by someone with no account yet, waiting for the rest of sign-up (15 minutes). */
const pendingSchema = new Schema(
  {
    ticketHash: { type: String, required: true },
    provider: { type: String, enum: SSO_PROVIDERS, required: true },
    subject: { type: String, required: true },
    email: { type: String, required: true },
    name: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
pendingSchema.index({ tenantId: 1, ticketHash: 1 }, { unique: true });
pendingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const SsoPendingModel = defineTenantModel('SsoPending', pendingSchema);

const STATE_MS = 10 * 60_000;
const PENDING_MS = 15 * 60_000;

export interface SsoDeps {
  auth: AuthService;
  cipher: FieldCipher;
  tenantUrl: (tenant: TenantRecord, path: string) => string;
}

export type CallbackOutcome = { redirect: string; session?: IssuedSession };

export class SsoService {
  constructor(private readonly d: SsoDeps) {}

  /** Calls the provider's token endpoint (tests replace it). */
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);
  /** The provider's signing keys (tests pass local ones). */
  keys: (jwksUrl: string) => JWTVerifyGetKey = remoteKeys;

  private async doc(): Promise<SettingsDoc | null> {
    return SsoSettingsModel.findOne({ key: 'sso' }).lean<SettingsDoc>();
  }

  redirectUri(tenant: TenantRecord, provider: SsoProvider) {
    return this.d.tenantUrl(tenant, `/api/v1/auth/sso/${provider}/callback`);
  }

  private usable(
    tenant: TenantRecord,
    p: ProviderDoc | undefined,
    provider: SsoProvider,
  ): p is UsableProvider {
    return (
      !!p?.enabled &&
      !!p.clientId &&
      !!p.clientSecretEnc &&
      (provider === 'google' || !!p.directoryId) &&
      tenant.allowedEmailDomains.length > 0
    );
  }

  /** The buttons the sign-in page shows. */
  async providers(tenant: TenantRecord): Promise<SsoProvider[]> {
    const s = await this.doc();
    return SSO_PROVIDERS.filter((p) => this.usable(tenant, s?.[p], p));
  }

  async settings(tenant: TenantRecord): Promise<SsoSettingsView> {
    const s = await this.doc();
    return {
      providers: SSO_PROVIDERS.map((p) => ({
        provider: p,
        enabled: !!s?.[p]?.enabled,
        clientId: s?.[p]?.clientId ?? null,
        hasSecret: !!s?.[p]?.clientSecretEnc,
        directoryId: s?.[p]?.directoryId ?? null,
        redirectUri: this.redirectUri(tenant, p),
      })),
      allowedEmailDomains: tenant.allowedEmailDomains,
    };
  }

  async saveSettings(
    viewer: AuthState,
    tenant: TenantRecord,
    provider: SsoProvider,
    body: z.output<typeof ssoSettingsBody>,
    meta: RequestMetaLite,
  ): Promise<SsoSettingsView> {
    const current = (await this.doc())?.[provider];
    const secret = body.clientSecret
      ? this.d.cipher.encrypt(body.clientSecret)
      : (current?.clientSecretEnc ?? null);
    if (body.enabled) {
      if (!tenant.allowedEmailDomains.length)
        throw badRequest('Add the college’s email domains first (Admin › Branding)');
      if (!secret) throw badRequest('Add the client secret', ['clientSecret']);
      if (provider === 'microsoft' && !body.directoryId)
        throw badRequest('Add the directory (tenant) ID', ['directoryId']);
    }
    await SsoSettingsModel.updateOne(
      { key: 'sso' },
      {
        $set: {
          [provider]: {
            enabled: body.enabled,
            clientId: body.clientId,
            clientSecretEnc: secret,
            directoryId: provider === 'microsoft' ? (body.directoryId ?? null) : null,
          },
          updatedBy: new Types.ObjectId(viewer.userId),
        },
        $setOnInsert: { key: 'sso' },
      },
      { upsert: true },
    );
    await audit.record(
      {
        action: 'sso.settings_saved',
        actorId: viewer.userId,
        meta: { provider, enabled: body.enabled, secretChanged: !!body.clientSecret },
      },
      meta,
    );
    return this.settings(tenant);
  }

  /** Starts a sign-in: the provider's address to send the browser to, and the state to bind to it. */
  async start(tenant: TenantRecord, provider: SsoProvider, next: string | undefined) {
    const p = (await this.doc())?.[provider];
    if (!this.usable(tenant, p, provider)) throw notFound('Single sign-on');
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken(48);
    await SsoStateModel.create({
      stateHash: sha256(state),
      provider,
      nonce,
      codeVerifier,
      next: safeReturnPath(next) ?? null,
      expiresAt: new Date(Date.now() + STATE_MS),
    });
    const ep = endpointsOf(provider, p.directoryId);
    const domain = tenant.allowedEmailDomains[0] ?? '';
    const q = new URLSearchParams({
      client_id: p.clientId,
      redirect_uri: this.redirectUri(tenant, provider),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: sha256(codeVerifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
      ...(provider === 'google' ? { hd: domain } : { response_mode: 'query', domain_hint: domain }),
    });
    return { location: `${ep.authorize}?${q.toString()}`, state };
  }

  /** The provider sent the browser back: check everything, then sign in, finish sign-up, or explain. */
  async callback(
    tenant: TenantRecord,
    provider: SsoProvider,
    q: { code?: string | undefined; state?: string | undefined; error?: string | undefined },
    boundState: string | undefined,
    meta: ClientMeta,
  ): Promise<CallbackOutcome> {
    const fail = (reason: SsoError): CallbackOutcome => ({ redirect: `/sign-in#sso_error=${reason}` });
    // The state must match the one this browser started with (no sign-in forced on someone else).
    if (!q.state || !boundState || !safeEqual(q.state, boundState)) return fail('expired');
    const attempt = await SsoStateModel.findOneAndDelete({ stateHash: sha256(q.state), provider }).lean();
    if (!attempt || attempt.expiresAt <= new Date()) return fail('expired');
    if (q.error) return fail(q.error === 'access_denied' ? 'cancelled' : 'failed');
    if (!q.code) return fail('failed');
    const p = (await this.doc())?.[provider];
    if (!this.usable(tenant, p, provider)) return fail('unavailable');
    let identity;
    try {
      const ep = endpointsOf(provider, p.directoryId);
      const idToken = await exchangeCode(this.fetchImpl, ep.token, {
        clientId: p.clientId,
        clientSecret: this.d.cipher.decrypt(p.clientSecretEnc),
        code: q.code,
        redirectUri: this.redirectUri(tenant, provider),
        codeVerifier: attempt.codeVerifier,
      });
      identity = await verifyIdToken(idToken, {
        provider,
        clientId: p.clientId,
        directoryId: p.directoryId,
        nonce: attempt.nonce,
        allowedDomains: tenant.allowedEmailDomains,
        keys: this.keys(ep.jwks),
      });
    } catch (e) {
      await audit.record(
        { action: 'sso.failed', meta: { provider, reason: e instanceof OidcError ? e.reason : 'failed' } },
        meta,
      );
      return fail(e instanceof OidcError ? e.reason : 'failed');
    }
    const user =
      (await UserModel.findOne({ ssoIdentities: { $elemMatch: { provider, subject: identity.subject } } })
        .select('_id status emailVerifiedAt ssoIdentities')
        .lean()) ??
      (await UserModel.findOne({ email: identity.email })
        .select('_id status emailVerifiedAt ssoIdentities')
        .lean());
    if (!user) {
      const ticket = randomToken();
      await SsoPendingModel.create({
        ticketHash: sha256(ticket),
        provider,
        subject: identity.subject,
        email: identity.email,
        name: identity.name.slice(0, 80),
        expiresAt: new Date(Date.now() + PENDING_MS),
      });
      return { redirect: `/sign-up/sso#ticket=${ticket}` };
    }
    if (user.status === 'suspended') return fail('suspended');
    if (
      !user.ssoIdentities?.some(
        (i: { provider: string; subject: string }) =>
          i.provider === provider && i.subject === identity.subject,
      )
    ) {
      // An address nobody confirmed may have been registered by someone else in advance: the
      // college's identity provider now proves the owner, so that password and those sessions go.
      const unconfirmed = !user.emailVerifiedAt;
      await UserModel.updateOne(
        { _id: user._id },
        {
          $push: { ssoIdentities: { provider, subject: identity.subject, linkedAt: new Date() } },
          ...(unconfirmed
            ? {
                $set: { emailVerifiedAt: new Date() },
                $unset: { passwordHash: 1 },
                $inc: { tokenVersion: 1 },
              }
            : {}),
        },
      );
      if (unconfirmed) await this.d.auth.revokeAllSessions(user._id, 'sso_linked');
      await audit.record(
        {
          action: 'sso.linked',
          actorId: String(user._id),
          targetType: 'user',
          targetId: String(user._id),
          meta: { provider, unconfirmed },
        },
        meta,
      );
    }
    let r;
    try {
      r = await this.d.auth.signInExternal(user._id, meta);
    } catch {
      return fail('suspended');
    }
    if (r.mfaRequired) return { redirect: `/sign-in#mfa=${r.ticket}` };
    return { redirect: attempt.next ?? '/home', session: r.session };
  }

  /** What the "finish creating your account" page shows. */
  async pending(ticket: string): Promise<SsoPendingView> {
    const p = await SsoPendingModel.findOne({
      ticketHash: sha256(ticket),
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!p) throw notFound('Sign-in (it expired; start again)');
    return { provider: p.provider as SsoProvider, email: p.email, name: p.name };
  }

  async complete(body: z.output<typeof ssoCompleteBody>, meta: ClientMeta): Promise<IssuedSession> {
    const p = await SsoPendingModel.findOne({
      ticketHash: sha256(body.ticket),
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!p) throw notFound('Sign-in (it expired; start again)');
    // Used up only once the account exists: a missed checkbox does not send them back to Google.
    // A second submit of the same ticket meets the existing account (409) instead.
    const session = await this.d.auth.signupExternal(
      {
        email: p.email,
        name: p.name,
        intent: body.intent,
        birthMonth: body.birthMonth,
        consents: body.consents,
        locale: body.locale,
        identity: { provider: p.provider as SsoProvider, subject: p.subject },
      },
      meta,
    );
    await SsoPendingModel.deleteOne({ _id: p._id });
    return session;
  }
}
