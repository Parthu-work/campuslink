/**
 * Re-encrypt every field after a FIELD_ENCRYPTION_KEY rotation, in every college.
 *
 * Usage (with the new key in FIELD_ENCRYPTION_KEY and the old one in FIELD_ENCRYPTION_KEYS_PREVIOUS):
 *   pnpm --filter @campuslink/api rotate-field-key            # re-encrypt and re-index
 *   pnpm --filter @campuslink/api rotate-field-key --dry-run  # report what would change
 *   pnpm --filter @campuslink/api rotate-field-key --check    # exit 1 while anything is left
 *
 * Prints counts and key ids only, never values. Each college gets an audit entry when anything was
 * rewritten. See docs/runbook.md, "Rotating the field encryption key".
 */
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { FieldCipher } from '../lib/crypto.js';
import { runInTenant } from '../lib/context.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { AuditModel } from '../modules/audit/audit.model.js';
import { isComplete, rotateFieldsInTenant, type CollectionReport } from './field-rotation.js';

const args = new Set(process.argv.slice(2));
const check = args.has('--check');
const dryRun = check || args.has('--dry-run');

async function main() {
  const env = loadEnv();
  const cipher = new FieldCipher(env.FIELD_ENCRYPTION_KEY, env.FIELD_ENCRYPTION_KEYS_PREVIOUS);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const all: CollectionReport[] = [];
  let invitesUntil: Date | null = null;
  try {
    const tenants = await TenantModel.find().select('slug').lean();
    console.warn(
      `${dryRun ? 'Checking' : 'Rotating'} ${tenants.length} colleges; current key id ${cipher.keyId}, ` +
        `${env.FIELD_ENCRYPTION_KEYS_PREVIOUS.length} previous key(s).`,
    );
    for (const t of tenants) {
      const r = await runInTenant(t._id, async () => {
        const res = await rotateFieldsInTenant(cipher, { dryRun });
        const changed = res.collections.reduce((n, c) => n + c.reencrypted + c.reindexed, 0);
        if (!dryRun && changed > 0)
          await AuditModel.create({
            action: 'platform.field_key_rotated',
            meta: {
              keyId: cipher.keyId,
              counts: Object.fromEntries(
                res.collections.map((c) => [c.collection, c.reencrypted + c.reindexed]),
              ),
            },
          });
        return res;
      });
      for (const c of r.collections) {
        all.push(c);
        if (c.reencrypted || c.reindexed || c.skipped || c.failed)
          console.warn(
            `  ${t.slug} · ${c.collection}: ${c.scanned} scanned, ${c.reencrypted} re-encrypted, ` +
              `${c.reindexed} re-indexed, ${c.skipped} skipped, ${c.failed} undecryptable`,
          );
      }
      if (r.openInvitesExpireBy && (!invitesUntil || r.openInvitesExpireBy > invitesUntil))
        invitesUntil = r.openInvitesExpireBy;
    }
  } finally {
    await mongoose.disconnect();
  }
  const failed = all.reduce((n, c) => n + c.failed, 0);
  const skipped = all.reduce((n, c) => n + c.skipped, 0);
  if (failed) console.error(`${failed} values could not be decrypted with any configured key.`);
  if (skipped) console.warn(`${skipped} documents changed during the run; run again to finish them.`);
  if (dryRun) {
    const done = isComplete(all);
    console.warn(
      done ? 'Nothing left on an old key.' : 'Values are still on an old key: run without --check.',
    );
    if (invitesUntil && env.FIELD_ENCRYPTION_KEYS_PREVIOUS.length)
      console.warn(`Open invites expire by ${invitesUntil.toISOString()}: keep the previous key until then.`);
    if (check && (!done || failed)) process.exitCode = 1;
  } else if (failed) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
