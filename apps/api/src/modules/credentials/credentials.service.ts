import { gzipSync, gunzipSync } from 'node:zlib';
import { randomInt } from 'node:crypto';
import { Types } from 'mongoose';
import {
  CompactSign,
  calculateJwkThumbprint,
  compactVerify,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importJWK,
  importPKCS8,
  type JWK,
} from 'jose';
import {
  ISSUER_KEY_ROTATE_DAYS,
  STATUS_LIST_SIZE,
  type CredentialIssueBody,
  type CredentialRevokeReason,
  type CredentialSource,
  type CredentialType,
  type CredentialView,
  type CredentialsAdminView,
  type MyCredentialsView,
} from '@campuslink/shared';
import { CredentialModel, IssuerKeyModel, type CredentialDoc } from './credential.model.js';
import { findTenantById, type TenantRecord } from '../tenants/tenant.cache.js';
import { requireTenantId } from '../../lib/context.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { randomToken, type FieldCipher } from '../../lib/crypto.js';
import { notEnabled, notForMinors } from '../network/network.service.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { AuthState } from '../../types.js';
import { noTrack, type Track } from '../../lib/product-events.js';

const DAY = 24 * 3600_000;
export const CREDENTIAL_ROTATE_JOB = 'credentials.rotate';

/** A record a member may turn into a credential, with the claims it would carry (never a CTC). */
export interface CredentialSourceFacts {
  type: CredentialType;
  sourceId: string | null;
  milestone: number | null;
  label: string;
  claims: Record<string, string | number>;
}

export interface CredentialsDeps {
  cipher: FieldCipher;
  /** The web origin (`https://campuslink.in`): credentials live at `<origin>/<slug>/verify/<id>`. */
  webOrigin: string;
  /** What this member could have a credential for right now (verified records only). */
  sources: (viewer: AuthState) => Promise<CredentialSourceFacts[]>;
  /** The member's name, and whether they are a minor (minors never hold credentials). */
  person: (userId: string) => Promise<{ name: string; minor: boolean } | null>;
  /** A member's current permissions, for the reconcile (null when they are gone). */
  viewerOf: (userId: string, tenant: TenantRecord) => Promise<AuthState | null>;
}

export interface VerifiedCredential {
  found: boolean;
  status: 'valid' | 'revoked' | 'key_compromised' | 'invalid';
  type: CredentialType | null;
  name: string | null;
  claims: Record<string, string | number>;
  issuedAt: string | null;
  college: { name: string; slug: string; logo: boolean };
  jwt: string | null;
  issuer: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * W3C Verifiable Credentials 2.0 secured as `vc+jwt` with EdDSA (Ed25519) through jose, issued by
 * the college as `did:web:<root>:<slug>` (ADR 0014 §12). The verify page reads the database; outside
 * verifiers use the college's Bitstring Status List.
 */
export class CredentialsService {
  track: Track = noTrack;
  constructor(private readonly d: CredentialsDeps) {}

  // ── Identity ─────────────────────────────

  private origin() {
    return new URL(this.d.webOrigin);
  }
  did(slug: string): string {
    return `did:web:${encodeURIComponent(this.origin().host)}:${slug}`;
  }
  base(slug: string): string {
    return `${this.origin().origin}/${slug}`;
  }
  verifyUrl(slug: string, publicId: string) {
    return `${this.base(slug)}/verify/${publicId}`;
  }
  statusListUrl(slug: string) {
    return `${this.base(slug)}/credentials/status/1`;
  }

  private async tenant(): Promise<TenantRecord> {
    const t = await findTenantById(requireTenantId());
    if (!t) throw notFound('College');
    return t;
  }

  // ── Keys ─────────────────────────────

  private async createKey(): Promise<string> {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    const jwk = await exportJWK(publicKey);
    const kid = await calculateJwkThumbprint(jwk);
    const pem = await exportPKCS8(privateKey);
    await IssuerKeyModel.updateMany(
      { status: 'active' },
      { $set: { status: 'retired', retiredAt: new Date() } },
    );
    await IssuerKeyModel.create({
      kid,
      publicJwk: { ...jwk, kid, alg: 'EdDSA', use: 'sig' },
      privateKeyEnc: this.d.cipher.encrypt(pem),
      status: 'active',
    });
    return kid;
  }

  private async activeKey(): Promise<{ kid: string; key: Awaited<ReturnType<typeof importPKCS8>> }> {
    let row = await IssuerKeyModel.findOne({ status: 'active' }).select('+privateKeyEnc kid').lean();
    if (!row) {
      await this.createKey();
      row = await IssuerKeyModel.findOne({ status: 'active' }).select('+privateKeyEnc kid').lean();
    }
    if (!row) throw conflict('No signing key');
    const key = await importPKCS8(this.d.cipher.decrypt(row.privateKeyEnc), 'EdDSA');
    return { kid: row.kid, key };
  }

  private async sign(slug: string, payload: Record<string, unknown>): Promise<{ jwt: string; kid: string }> {
    const { kid, key } = await this.activeKey();
    const jwt = await new CompactSign(enc.encode(JSON.stringify(payload)))
      .setProtectedHeader({ alg: 'EdDSA', typ: 'vc+jwt', cty: 'vc', kid: `${this.did(slug)}#${kid}` })
      .sign(key);
    return { jwt, kid };
  }

  /** Yearly rotation (timer) or on demand: a new active key; the old one keeps verifying. */
  async rotate(actor: AuthState | null, meta: RequestMetaLite = {}): Promise<CredentialsAdminView> {
    const kid = await this.createKey();
    await audit.record(
      { action: 'credentials.key_rotated', actorId: actor?.userId ?? null, meta: { kid } },
      meta,
    );
    return this.adminView();
  }

  /** The timer: rotate a key older than ISSUER_KEY_ROTATE_DAYS (only where credentials are on). */
  async rotateIfDue(now = new Date()): Promise<boolean> {
    const t = await this.tenant();
    if (t.network?.credentials !== true) return false;
    const k = await IssuerKeyModel.findOne({ status: 'active' })
      .select('createdAt')
      .lean<{ createdAt: Date }>();
    if (!k || k.createdAt.getTime() > now.getTime() - ISSUER_KEY_ROTATE_DAYS * DAY) return false;
    await this.rotate(null);
    return true;
  }

  /** A leaked key: withdrawn from the DID document, its live credentials re-signed with a new key. */
  async compromised(actor: AuthState, kid: string, meta: RequestMetaLite): Promise<CredentialsAdminView> {
    const t = await this.tenant();
    const r = await IssuerKeyModel.updateOne(
      { kid, status: { $ne: 'compromised' } },
      { $set: { status: 'compromised', retiredAt: new Date() } },
    );
    if (!r.matchedCount) throw notFound('Key');
    await this.createKey();
    const live = await CredentialModel.find({ kid, status: 'active' }).lean<CredentialDoc[]>();
    for (const c of live) {
      const payload = this.payload(
        t,
        c.type as CredentialType,
        c.publicId,
        c.statusIndex,
        c.name ?? '',
        (c.claims ?? {}) as Record<string, string | number>,
        c.issuedAt,
      );
      const s = await this.sign(t.slug, payload);
      await CredentialModel.updateOne({ _id: c._id }, { $set: { jwt: s.jwt, kid: s.kid } });
    }
    await audit.record(
      { action: 'credentials.key_compromised', actorId: actor.userId, meta: { kid, resigned: live.length } },
      meta,
    );
    return this.adminView();
  }

  async adminView(): Promise<CredentialsAdminView> {
    const t = await this.tenant();
    const [keys, issued, revoked] = await Promise.all([
      IssuerKeyModel.find({})
        .sort({ _id: -1 })
        .limit(20)
        .select('kid status createdAt')
        .lean<{ kid: string; status: string; createdAt: Date }[]>(),
      CredentialModel.countDocuments({ status: 'active' }),
      CredentialModel.countDocuments({ status: 'revoked' }),
    ]);
    return {
      enabled: t.network?.credentials === true,
      did: this.did(t.slug),
      keys: keys.map((k) => ({
        kid: k.kid,
        status: k.status as 'active',
        createdAt: k.createdAt.toISOString(),
      })),
      issued,
      revoked,
    };
  }

  // ── Issuing ─────────────────────────────

  private payload(
    t: TenantRecord,
    type: CredentialType,
    publicId: string,
    statusIndex: number,
    name: string,
    claims: Record<string, string | number>,
    issuedAt: Date,
  ) {
    const statusList = this.statusListUrl(t.slug);
    return {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: this.verifyUrl(t.slug, publicId),
      type: ['VerifiableCredential', type],
      issuer: { id: this.did(t.slug), name: t.branding.displayName },
      validFrom: issuedAt.toISOString(),
      credentialSubject: { type, name, ...claims },
      credentialStatus: {
        id: `${statusList}#${statusIndex}`,
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: String(statusIndex),
        statusListCredential: statusList,
      },
    };
  }

  private view(t: TenantRecord, c: CredentialDoc): CredentialView {
    return {
      id: c.publicId,
      type: c.type as CredentialType,
      name: c.name ?? '',
      claims: (c.claims ?? {}) as Record<string, string | number>,
      status: c.status as CredentialView['status'],
      issuedAt: c.issuedAt.toISOString(),
      url: this.verifyUrl(t.slug, c.publicId),
    };
  }

  private key(s: { type: string; sourceId?: string | null; milestone?: number | null }) {
    return `${s.type}:${s.sourceId ?? ''}:${s.milestone ?? ''}`;
  }

  async mine(viewer: AuthState): Promise<MyCredentialsView> {
    const t = await this.tenant();
    const person = await this.d.person(viewer.userId);
    const rows = await CredentialModel.find({ userId: new Types.ObjectId(viewer.userId) })
      .sort({ _id: -1 })
      .lean<CredentialDoc[]>();
    const enabled = t.network?.credentials === true;
    const sources = enabled && person && !person.minor ? await this.d.sources(viewer) : [];
    const active = new Set(rows.filter((r) => r.status === 'active').map((r) => this.key(r)));
    return {
      enabled,
      minor: person?.minor ?? false,
      credentials: rows.map((r) => this.view(t, r)),
      sources: sources.map((s): CredentialSource => ({
        type: s.type,
        sourceId: s.sourceId,
        milestone: s.milestone,
        label: s.label,
        issued: active.has(this.key(s)),
      })),
    };
  }

  /** N32: only on the member's request, from a verified record, never for a minor. */
  async issue(viewer: AuthState, body: CredentialIssueBody, meta: RequestMetaLite): Promise<CredentialView> {
    const t = await this.tenant();
    if (t.network?.credentials !== true)
      throw notEnabled('Your college has not turned on verified credentials');
    const person = await this.d.person(viewer.userId);
    if (!person) throw notFound('Member');
    if (person.minor) throw notForMinors();
    const sourceId = 'sourceId' in body ? body.sourceId : null;
    const milestone = 'milestone' in body ? body.milestone : null;
    const source = (await this.d.sources(viewer)).find(
      (s) => s.type === body.type && s.sourceId === sourceId && s.milestone === milestone,
    );
    if (!source) throw badRequest('There is no verified record for this credential');
    if (
      await CredentialModel.exists({
        userId: new Types.ObjectId(viewer.userId),
        type: body.type,
        sourceId,
        milestone,
        status: 'active',
      })
    )
      throw conflict('You already have this credential');
    const name =
      body.nameStyle === 'full' ? person.name : (person.name.trim().split(/\s+/)[0] ?? person.name);
    const issuedAt = new Date();
    for (let attempt = 0; attempt < 5; attempt++) {
      const publicId = randomToken(16);
      const statusIndex = randomInt(0, STATUS_LIST_SIZE);
      const { jwt, kid } = await this.sign(
        t.slug,
        this.payload(t, body.type, publicId, statusIndex, name, source.claims, issuedAt),
      );
      try {
        const doc = await CredentialModel.create({
          publicId,
          userId: new Types.ObjectId(viewer.userId),
          type: body.type,
          sourceId,
          milestone,
          name,
          claims: source.claims,
          jwt,
          kid,
          statusIndex,
          issuedAt,
        });
        await audit.record(
          {
            action: 'credentials.issued',
            actorId: viewer.userId,
            targetType: 'credential',
            targetId: publicId,
            meta: { type: body.type },
          },
          meta,
        );
        await this.track(viewer.userId, 'credential_issued', { type: body.type });
        return this.view(t, doc.toObject() as unknown as CredentialDoc);
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
      }
    }
    throw conflict('Try again');
  }

  private async revokeWhere(filter: Record<string, unknown>, reason: CredentialRevokeReason, wipe = false) {
    return CredentialModel.updateMany(
      { ...filter, status: 'active' },
      {
        $set: {
          status: 'revoked',
          revokedReason: reason,
          revokedAt: new Date(),
          ...(wipe ? { name: null, claims: null, jwt: null, userId: null } : {}),
        },
      },
    );
  }

  async revokeMine(viewer: AuthState, publicId: string, meta: RequestMetaLite) {
    const r = await this.revokeWhere({ publicId, userId: new Types.ObjectId(viewer.userId) }, 'member');
    if (!r.modifiedCount) throw notFound('Credential');
    await audit.record(
      { action: 'credentials.revoked', actorId: viewer.userId, targetType: 'credential', targetId: publicId },
      meta,
    );
    return this.mine(viewer);
  }

  async revokeByAdmin(actor: AuthState, publicId: string, meta: RequestMetaLite) {
    const r = await this.revokeWhere({ publicId }, 'admin');
    if (!r.modifiedCount) throw notFound('Credential');
    await audit.record(
      {
        action: 'credentials.revoked',
        actorId: actor.userId,
        targetType: 'credential',
        targetId: publicId,
        meta: { by: 'admin' },
      },
      meta,
    );
    return this.adminView();
  }

  /** The reconcile: a credential whose source no longer stands is revoked (N34). */
  async reconcile(): Promise<number> {
    const t = await this.tenant();
    const live = await CredentialModel.find({ status: 'active', userId: { $ne: null } })
      .select('userId type sourceId milestone')
      .lean<CredentialDoc[]>();
    const byUser = new Map<string, CredentialDoc[]>();
    for (const c of live) byUser.set(String(c.userId), [...(byUser.get(String(c.userId)) ?? []), c]);
    let revoked = 0;
    for (const [userId, rows] of byUser) {
      const person = await this.d.person(userId);
      const viewer = person && !person.minor ? await this.d.viewerOf(userId, t) : null;
      const sources = viewer
        ? new Set((await this.d.sources(viewer)).map((s) => this.key(s)))
        : new Set<string>();
      for (const c of rows) {
        // A milestone was reached on its date; it is not taken back when the score moves.
        if (c.type === 'ReadinessMilestoneCredential' && viewer) continue;
        if (sources.has(this.key(c))) continue;
        const r = await this.revokeWhere({ _id: c._id }, 'source_changed');
        revoked += r.modifiedCount;
      }
    }
    return revoked;
  }

  // ── Public (root host, college from the path) ─────────────────────────────

  async didDocument(t: TenantRecord) {
    const did = this.did(t.slug);
    const keys = await IssuerKeyModel.find({ status: { $in: ['active', 'retired'] } })
      .select('kid publicJwk')
      .lean<{ kid: string; publicJwk: JWK }[]>();
    const methods = keys.map((k) => ({
      id: `${did}#${k.kid}`,
      type: 'JsonWebKey2020',
      controller: did,
      publicKeyJwk: k.publicJwk,
    }));
    return {
      '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/jws-2020/v1'],
      id: did,
      verificationMethod: methods,
      assertionMethod: methods.map((m) => m.id),
    };
  }

  /** The Bitstring Status List credential (revoked = 1), signed with the active key. */
  async statusList(t: TenantRecord): Promise<string> {
    const bits = Buffer.alloc(STATUS_LIST_SIZE / 8);
    const revoked = await CredentialModel.find({ status: 'revoked' }).select('statusIndex').lean();
    for (const r of revoked) {
      const i = r.statusIndex;
      bits[Math.floor(i / 8)] = (bits[Math.floor(i / 8)] ?? 0) | (0x80 >> (i % 8));
    }
    const url = this.statusListUrl(t.slug);
    const { jwt } = await this.sign(t.slug, {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: url,
      type: ['VerifiableCredential', 'BitstringStatusListCredential'],
      issuer: { id: this.did(t.slug), name: t.branding.displayName },
      validFrom: new Date().toISOString(),
      credentialSubject: {
        id: `${url}#list`,
        type: 'BitstringStatusList',
        statusPurpose: 'revocation',
        encodedList: `u${gzipSync(bits).toString('base64url')}`,
      },
    });
    return jwt;
  }

  /** Whether index `i` is set in an encoded list (tests and outside verifiers do the same). */
  static isRevokedIn(encodedList: string, i: number): boolean {
    const bits = gunzipSync(Buffer.from(encodedList.slice(1), 'base64url'));
    return ((bits[Math.floor(i / 8)] ?? 0) & (0x80 >> (i % 8))) !== 0;
  }

  /** N35: checks the signature against the published key and reads the status at once. */
  async verify(t: TenantRecord, publicId: string): Promise<VerifiedCredential> {
    const college = { name: t.branding.displayName, slug: t.slug, logo: !!t.logo?.fileId };
    const empty: VerifiedCredential = {
      found: false,
      status: 'invalid',
      type: null,
      name: null,
      claims: {},
      issuedAt: null,
      college,
      jwt: null,
      issuer: this.did(t.slug),
    };
    const c = await CredentialModel.findOne({ publicId }).lean<CredentialDoc>();
    if (!c || !c.jwt || t.network?.credentials !== true) return empty;
    const key = await IssuerKeyModel.findOne({ kid: c.kid })
      .select('publicJwk status')
      .lean<{ publicJwk: JWK; status: string }>();
    let signed = false;
    if (key && key.status !== 'compromised') {
      try {
        const { payload } = await compactVerify(c.jwt, await importJWK(key.publicJwk, 'EdDSA'));
        const body = JSON.parse(dec.decode(payload)) as { id?: string };
        signed = body.id === this.verifyUrl(t.slug, publicId);
      } catch {
        signed = false;
      }
    }
    const status: VerifiedCredential['status'] =
      c.status === 'revoked'
        ? 'revoked'
        : key?.status === 'compromised'
          ? 'key_compromised'
          : signed
            ? 'valid'
            : 'invalid';
    return {
      found: true,
      status,
      type: c.type as CredentialType,
      name: c.name ?? null,
      claims: (c.claims ?? {}) as Record<string, string | number>,
      issuedAt: c.issuedAt.toISOString(),
      college,
      jwt: c.status === 'revoked' ? null : c.jwt,
      issuer: this.did(t.slug),
    };
  }

  // ── Privacy ─────────────────────────────

  async exportFor(userId: string) {
    return {
      credentials: await CredentialModel.find({ userId: new Types.ObjectId(userId) })
        .select('publicId type name claims status issuedAt revokedAt')
        .lean(),
    };
  }

  /** Erasure revokes and strips: the claims and the name go; only the status stays (N34). */
  async eraseFor(userId: string) {
    const uid = new Types.ObjectId(userId);
    await this.revokeWhere({ userId: uid }, 'erased', true);
    await CredentialModel.updateMany(
      { userId: uid },
      { $set: { name: null, claims: null, jwt: null, userId: null } },
    );
  }
}
