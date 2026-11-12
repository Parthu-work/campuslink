/**
 * Prompt 4, P5: the cost report.
 *
 *   pnpm --filter @campuslink/api costs:report [--month YYYY-MM] [--json] [--backup-status <file>]
 *   (in the API container: node dist/scripts/costs-report.js …)
 *
 * Month to date (or a past month) per college: AI tokens on the platform's key and their estimated
 * cost, WhatsApp and SMS messages and their estimated cost, stored GB, and the off-site backup's
 * size from the backup job's status file (`BACKUP_STATUS_FILE`, written by deploy/prod/backup.sh),
 * each beside its allowance, cap or free-tier limit. Aggregates only: no member, message or file
 * name is read. Each run is recorded in the platform audit log.
 */
import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { MemoryMailProvider } from '../lib/mailer.js';
import { InlineJobQueue } from '../lib/jobs.js';
import { MemoryStorage } from '../lib/storage.js';
import { runInTenant } from '../lib/context.js';
import { createApp } from '../app.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { audit } from '../modules/audit/audit.service.js';
import {
  MONTH,
  type BackupStatus,
  type CostReport,
  type CostsService,
} from '../modules/billing/costs.service.js';

export function parseArgs(
  argv: string[],
  now = new Date(),
): { month: string; json: boolean; backupStatus: string | null } {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  const month = value('--month') ?? now.toISOString().slice(0, 7);
  if (!MONTH.test(month)) throw new Error('--month needs a month like 2026-11');
  return { month, json: argv.includes('--json'), backupStatus: value('--backup-status') ?? null };
}

/** The backup job's status file; anything unreadable or malformed is "unknown", never a guess. */
export function parseBackupStatus(text: string): BackupStatus | null {
  try {
    const v = JSON.parse(text) as Partial<BackupStatus>;
    if (typeof v.at !== 'string' || typeof v.ok !== 'boolean' || typeof v.remoteBytes !== 'number')
      return null;
    if (!Number.isFinite(v.remoteBytes) || v.remoteBytes < 0 || Number.isNaN(Date.parse(v.at))) return null;
    return { at: v.at, ok: v.ok, remoteBytes: v.remoteBytes };
  } catch {
    return null;
  }
}

const rupees = (paise: number | null) => (paise === null ? 'price not set' : `₹${(paise / 100).toFixed(2)}`);
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
const of = (used: number, limit: number | null, unit = '') =>
  limit === null || limit === 0 ? `${used}${unit} (no limit)` : `${used}${unit} of ${limit}${unit}`;

export function table(r: CostReport): string {
  const header = [
    'College',
    'AI tokens (platform key)',
    'AI cost',
    'WhatsApp',
    'WhatsApp cost',
    'SMS',
    'SMS cost',
    'Stored',
  ];
  const body = r.colleges.map((c) => [
    c.slug,
    of(c.ai.platformTokens, c.ai.allowanceTokens),
    c.ai.estimatePaise !== null
      ? rupees(c.ai.estimatePaise)
      : c.ai.estimate !== null
        ? `${c.ai.estimate.toFixed(2)} ${c.ai.currency}`
        : 'price not set',
    of(c.whatsapp.messages, c.whatsapp.allowance),
    rupees(c.whatsapp.estimatePaise),
    String(c.sms.messages),
    rupees(c.sms.estimatePaise),
    c.storage.limitBytes === null
      ? `${gb(c.storage.bytes)} (no limit)`
      : `${gb(c.storage.bytes)} of ${gb(c.storage.limitBytes)}`,
  ]);
  const widths = header.map((_, i) => Math.max(...[header, ...body].map((row) => (row[i] ?? '').length)));
  const line = (row: string[]) => row.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ');
  const b = r.backup;
  return [
    `Costs for ${r.month} (UTC days), as of ${r.generatedAt}. Aggregates only.`,
    '',
    line(header),
    line(widths.map((w) => '-'.repeat(w))),
    ...body.map(line),
    '',
    `Total this month: ${r.totals.estimatePaise === null ? 'not all prices are set (see COST_* and the AI prices)' : rupees(r.totals.estimatePaise)}`,
    `  AI tokens on the platform key: ${r.totals.aiPlatformTokens} (monthly spend limit: set in the provider's console)`,
    `  WhatsApp messages: ${r.totals.whatsappMessages}; SMS: ${r.totals.smsMessages} (SMS runs on a prepaid balance)`,
    `  Stored files: ${gb(r.totals.storageBytes)}`,
    b.status
      ? `  Off-site backup (R2): ${gb(b.status.remoteBytes)} of ${gb(b.freeTierBytes)} free, alert at ${gb(b.alertBytes)}; last run ${b.status.at} (${b.status.ok ? 'ok' : 'FAILED'})`
      : `  Off-site backup (R2): unknown (no status file; free tier ${gb(b.freeTierBytes)})`,
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
  const costs = (app.locals.services as { costs: CostsService }).costs;
  const file = args.backupStatus ?? process.env.BACKUP_STATUS_FILE ?? null;
  const backup = file ? parseBackupStatus(await readFile(file, 'utf8').catch(() => '')) : null;
  const report = await costs.report(args.month, backup);
  const platform = await TenantModel.findOne({ kind: 'platform' }).select('_id').lean();
  if (platform)
    await runInTenant(platform._id, () =>
      audit.record(
        { action: 'costs.report_run', meta: { month: args.month, colleges: report.colleges.length } },
        { requestId: 'costs-report', ipPrefix: null },
      ),
    );
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : `${table(report)}\n`);
  await mongoose.disconnect();
}

if (process.argv[1]?.endsWith('costs-report.ts') || process.argv[1]?.endsWith('costs-report.js'))
  main().catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await mongoose.disconnect();
    process.exit(1);
  });
