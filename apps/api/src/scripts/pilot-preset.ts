/**
 * Prompt 4, P11: the pilot preset for one college.
 *
 *   pnpm --filter @campuslink/api college:pilot-preset --slug <slug> [--dry-run]
 *   (in the API container: node dist/scripts/pilot-preset.js --slug <slug> [--dry-run])
 *
 * Sets the college's switches and limits for a focused first term (`PILOT_PRESET` in
 * packages/shared): mentorship, jobs, study and the assistant, placements on; stories, reels and
 * leaderboards off; circles, giving, public pages, the parent digest and member invites off
 * (their permissions); the network off; a conservative WhatsApp and AI allowance and the storage
 * limits. Only existing switches and limits are set and nothing is deleted. `--dry-run` prints the
 * changes without making them. A second run changes nothing. An audit row is written in the college.
 */
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { MemoryMailProvider } from '../lib/mailer.js';
import { InlineJobQueue } from '../lib/jobs.js';
import { MemoryStorage } from '../lib/storage.js';
import { createApp } from '../app.js';
import type { PilotPresetService, PresetChange } from '../modules/platform/pilot-preset.service.js';

export function parseArgs(argv: string[]): { slug: string; dryRun: boolean } {
  const i = argv.indexOf('--slug');
  const slug = i < 0 ? undefined : argv[i + 1];
  if (!slug || slug.startsWith('--')) throw new Error('--slug is required (the college’s subdomain)');
  if (!/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)) throw new Error('--slug is a subdomain like knrcer');
  for (const a of argv)
    if (a.startsWith('--') && !['--slug', '--dry-run'].includes(a)) throw new Error(`Unknown option ${a}`);
  return { slug, dryRun: argv.includes('--dry-run') };
}

const show = (v: unknown) => (v === null || v === undefined ? 'not set' : JSON.stringify(v));

export function summary(r: { slug: string; dryRun: boolean; changes: PresetChange[] }): string {
  if (!r.changes.length) return `${r.slug}: already on the pilot preset. Nothing to change.`;
  return [
    r.dryRun
      ? `${r.slug}: the pilot preset would change ${r.changes.length} settings (dry run, nothing written):`
      : `${r.slug}: the pilot preset changed ${r.changes.length} settings:`,
    ...r.changes.map((c) => `  ${c.setting}: ${show(c.from)} → ${show(c.to)}`),
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const app = createApp({
    env,
    logger: createLogger('silent'),
    readiness: {},
    mailer: new MemoryMailProvider(),
    jobs: new InlineJobQueue(),
    storage: new MemoryStorage(),
  });
  const preset = (app.locals.services as { pilotPreset: PilotPresetService }).pilotPreset;
  process.stdout.write(`${summary(await preset.apply(args.slug, { dryRun: args.dryRun }))}\n`);
  await mongoose.disconnect();
}

if (process.argv[1]?.endsWith('pilot-preset.ts') || process.argv[1]?.endsWith('pilot-preset.js'))
  main().catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await mongoose.disconnect();
    process.exit(1);
  });
