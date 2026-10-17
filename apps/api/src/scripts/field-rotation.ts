/**
 * Re-encryption after a FIELD_ENCRYPTION_KEY rotation (runbook: "Rotating the field encryption key").
 *
 * A platform maintenance path, like the seed: it reads and writes the encrypted fields of several
 * modules directly, always inside `runInTenant`, so the tenancy plugin still scopes every query.
 *
 * For every encrypted value not written with the current key it decrypts (with any configured key)
 * and re-encrypts with the current one; every blind index whose source value it can decrypt is
 * recomputed with the current key. Each write is guarded on the old ciphertext, so a value changed
 * by the app in the meantime is left alone (and picked up by the next run). Idempotent: a second
 * run finds nothing to do.
 */
import type { Model } from 'mongoose';
import type { Types } from 'mongoose';
import type { FieldCipher } from '../lib/crypto.js';
import { UserModel } from '../modules/auth/user.model.js';
import { ProfileModel } from '../modules/profiles/profile.model.js';
import { WhitelistModel } from '../modules/imports/whitelist.model.js';
import { PushSubscriptionModel } from '../modules/notifications/notification.model.js';
import { MessageModel } from '../modules/messaging/conversation.model.js';
import { InviteModel } from '../modules/verification/verification.model.js';

type AnyModel = Model<Record<string, unknown>>;

export interface EncryptedCollection {
  name: string;
  model: AnyModel;
  /** Encrypted fields (dotted paths). */
  fields: string[];
  /** Blind index field → the encrypted field holding its source value. */
  indexes?: Record<string, string>;
}

/**
 * Every encrypted field in the app. `test/field-rotation.test.ts` fails when a schema gains an
 * `…Enc` field that is not listed here.
 */
export const ENCRYPTED_COLLECTIONS: EncryptedCollection[] = [
  {
    name: 'users',
    model: UserModel as unknown as AnyModel,
    fields: ['phoneEnc', 'mfa.secretEnc', 'mfa.pendingSecretEnc'],
    indexes: { phoneIndex: 'phoneEnc' },
  },
  { name: 'profiles', model: ProfileModel as unknown as AnyModel, fields: ['phoneEnc'] },
  {
    name: 'whitelist',
    model: WhitelistModel as unknown as AnyModel,
    fields: ['emailEnc', 'phoneEnc'],
    indexes: { emailIndex: 'emailEnc', phoneIndex: 'phoneEnc' },
  },
  {
    name: 'push subscriptions',
    model: PushSubscriptionModel as unknown as AnyModel,
    fields: ['endpointEnc', 'keysEnc'],
    indexes: { endpointIndex: 'endpointEnc' },
  },
  { name: 'messages', model: MessageModel as unknown as AnyModel, fields: ['bodyEnc'] },
];

export interface CollectionReport {
  collection: string;
  /** Documents with at least one encrypted value. */
  scanned: number;
  /** Values re-encrypted with the current key (or that would be, in a dry run). */
  reencrypted: number;
  /** Blind indexes recomputed with the current key. */
  reindexed: number;
  /** Writes skipped because the app changed the value meanwhile (rerun to finish). */
  skipped: number;
  /** Values no configured key decrypts (a key was removed too early, or data is corrupt). */
  failed: number;
}

const BATCH = 500;

function getPath(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined),
      doc,
    );
}

async function rotateCollection(
  spec: EncryptedCollection,
  cipher: FieldCipher,
  dryRun: boolean,
): Promise<CollectionReport> {
  const report: CollectionReport = {
    collection: spec.name,
    scanned: 0,
    reencrypted: 0,
    reindexed: 0,
    skipped: 0,
    failed: 0,
  };
  const indexFields = Object.keys(spec.indexes ?? {});
  // An inclusive projection: naming a field also returns it when the schema hides it with
  // `select: false` (TOTP secrets).
  const select = [...spec.fields, ...indexFields].join(' ');
  const any = { $or: spec.fields.map((f) => ({ [f]: { $type: 'string' } })) };
  let after: Types.ObjectId | null = null;
  for (;;) {
    const page: Record<string, unknown>[] = await spec.model
      .find(after ? { $and: [any, { _id: { $gt: after } }] } : any)
      .select(select)
      .sort({ _id: 1 })
      .limit(BATCH)
      .lean<Record<string, unknown>[]>();
    if (!page.length) break;
    after = page[page.length - 1]?._id as Types.ObjectId;
    for (const doc of page) {
      report.scanned++;
      const set: Record<string, string> = {};
      const guard: Record<string, unknown> = { _id: doc._id };
      const plain = new Map<string, string>();
      let broken = false;
      for (const f of spec.fields) {
        const v = getPath(doc, f);
        if (typeof v !== 'string') continue;
        try {
          plain.set(f, cipher.decrypt(v));
        } catch {
          broken = true;
          continue;
        }
        if (cipher.needsRotation(v)) {
          set[f] = cipher.encrypt(plain.get(f) ?? '');
          guard[f] = v;
          report.reencrypted++;
        }
      }
      if (broken) report.failed++;
      for (const [idx, source] of Object.entries(spec.indexes ?? {})) {
        const p = plain.get(source);
        if (p === undefined) continue;
        const expected = cipher.blindIndex(p);
        if (getPath(doc, idx) !== expected) {
          set[idx] = expected;
          guard[idx] = getPath(doc, idx) ?? null;
          report.reindexed++;
        }
      }
      if (dryRun || !Object.keys(set).length) continue;
      const res = await spec.model.updateOne(guard, { $set: set });
      if (res.modifiedCount === 0) report.skipped++;
    }
  }
  return report;
}

/** Runs inside `runInTenant`. */
export async function rotateFieldsInTenant(
  cipher: FieldCipher,
  opts: { dryRun?: boolean } = {},
): Promise<{ collections: CollectionReport[]; openInvitesExpireBy: Date | null }> {
  const collections: CollectionReport[] = [];
  for (const spec of ENCRYPTED_COLLECTIONS)
    collections.push(await rotateCollection(spec, cipher, !!opts.dryRun));
  // Invites keep only a blind index of the email (no ciphertext), so they cannot be re-indexed.
  // Lookups match every configured key's index, so keep the previous key until they expire.
  const latest = await InviteModel.findOne({ acceptedAt: null })
    .sort({ expiresAt: -1 })
    .select('expiresAt')
    .lean();
  return { collections, openInvitesExpireBy: (latest?.expiresAt as Date | undefined) ?? null };
}

/** Nothing left on an old key: safe to drop FIELD_ENCRYPTION_KEYS_PREVIOUS (after open invites expire). */
export const isComplete = (reports: CollectionReport[]) =>
  reports.every((r) => r.reencrypted === 0 && r.reindexed === 0 && r.failed === 0 && r.skipped === 0);
