import { FEATURE_KEYS, LEGACY_FEATURES, USAGE_FEATURE_OF_KIND } from '@campuslink/shared';
import { withPlatformScope } from '../lib/context.js';
import type { Logger } from '../lib/logger.js';
import { MigrationModel } from '../modules/platform/migration.model.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { UserModel } from '../modules/auth/user.model.js';
import { AiSettingsModel } from '../modules/study/ai-settings.model.js';
import { AiUsageModel } from '../modules/study/ai-usage.model.js';

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
  {
    // B2: the age check is a birth month now; older members keep their declaration's date.
    // Raw collection: the old field is not in the schema, and strict queries would drop it.
    name: 'b2-age-checked-at',
    async run() {
      const r = await UserModel.collection.updateMany(
        { ageDeclaredAt: { $exists: true } },
        { $rename: { ageDeclaredAt: 'ageCheckedAt' } },
      );
      return r.modifiedCount;
    },
  },
  {
    // B10: the placeholder plans become the priced ones (D9), and the seat limit is the
    // contracted seat count. `standard` becomes Connect: no college had drives before B7.
    name: 'b10-plans',
    async run() {
      const c = TenantModel.collection;
      let changed = (
        await c.updateMany(
          { 'subscription.seatLimit': { $exists: true } },
          { $rename: { 'subscription.seatLimit': 'subscription.seats' } },
        )
      ).modifiedCount;
      for (const [from, to] of [
        ['trial', 'pilot'],
        ['standard', 'connect'],
        ['premium', 'placement'],
      ] as const)
        changed += (await c.updateMany({ 'subscription.plan': from }, { $set: { 'subscription.plan': to } }))
          .modifiedCount;
      return changed;
    },
  },
  {
    // D7: faculty never read students' study chats; the unused switch is removed from every college.
    // Raw collection: the field is no longer in the schema (strict 'throw').
    name: 'b11-unset-faculty-see-chats',
    async run() {
      const r = await AiSettingsModel.collection.updateMany(
        { 'features.facultySeeChats': { $exists: true } },
        { $unset: { 'features.facultySeeChats': '' } },
      );
      return r.modifiedCount;
    },
  },
  {
    // B11: usage counters say what they were for and whether the platform's key served them.
    // Counters from before used the college's own key or the platform's; that was not recorded,
    // so they count as the college's own (never billed as platform usage).
    name: 'b11-ai-usage-feature',
    async run() {
      let changed = 0;
      for (const [kind, feature] of Object.entries(USAGE_FEATURE_OF_KIND))
        changed += (
          await AiUsageModel.collection.updateMany(
            { kind, feature: { $exists: false } },
            { $set: { feature, platform: false } },
          )
        ).modifiedCount;
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
