import { FEATURE_KEYS, LEGACY_FEATURES } from '@campuslink/shared';
import { withPlatformScope } from '../lib/context.js';
import type { Logger } from '../lib/logger.js';
import { MigrationModel } from '../modules/platform/migration.model.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';

/**
 * One-off data migrations, run once per database at boot (after index sync), in order. Each must
 * be idempotent: a crash between the update and the record re-runs it. They run under one named
 * platform scope because they fix data across every college.
 */
export interface Migration {
  name: string;
  /** Returns how many documents changed. */
  run(): Promise<number>;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    // B1: colleges created before the switches existed keep exactly what they had.
    name: 'b1-explicit-feature-switches',
    async run() {
      let changed = 0;
      for (const k of FEATURE_KEYS) {
        const r = await TenantModel.updateMany(
          { [`features.${k}`]: { $exists: false } },
          { $set: { [`features.${k}`]: LEGACY_FEATURES[k] } },
        );
        changed += r.modifiedCount;
      }
      return changed;
    },
  },
];

const isDuplicate = (e: unknown) => (e as { code?: number }).code === 11000;

export async function runMigrations(logger: Logger, list: readonly Migration[] = MIGRATIONS): Promise<void> {
  await withPlatformScope('platform:migrations', async () => {
    for (const m of list) {
      try {
        await MigrationModel.create({ name: m.name, startedAt: new Date() });
      } catch (e) {
        if (isDuplicate(e)) continue; // already ran, or another process is running it
        throw e;
      }
      try {
        const changed = await m.run();
        await MigrationModel.updateOne({ name: m.name }, { $set: { finishedAt: new Date(), changed } });
        logger.info({ migration: m.name, changed }, 'migration finished');
      } catch (e) {
        await MigrationModel.deleteOne({ name: m.name });
        throw e;
      }
    }
  });
}
