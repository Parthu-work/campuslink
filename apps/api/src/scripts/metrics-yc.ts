/**
 * Prompt 2, G13: the YC metrics pack (docs/build/yc-metrics.md).
 *
 *   pnpm --filter @campuslink/api metrics:yc [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json]
 *
 * Default range: the last 28 days, ending today (UTC). Colleges are listed with platform scope;
 * each college's figures are computed inside its own tenant context by `YcMetricsService`, from
 * count-only methods on the owning services. Every count is suppressed under five ("<5") and no
 * member id, name or text is read into the output. Each run is recorded in the platform audit log.
 */
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { MemoryMailProvider } from '../lib/mailer.js';
import { InlineJobQueue } from '../lib/jobs.js';
import { storageFromEnv } from '../lib/storage-factory.js';
import { runInTenant, withPlatformScope } from '../lib/context.js';
import { createApp } from '../app.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { audit } from '../modules/audit/audit.service.js';
import type { YcCollegeMetrics, YcMetricsService, YcRange } from '../modules/insights/yc-metrics.service.js';

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseArgs(argv: string[], now = new Date()): { range: YcRange; json: boolean } {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (!v || !DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))
      throw new Error(`${flag} needs a date like 2026-10-01`);
    return v;
  };
  const to = value('--to') ?? now.toISOString().slice(0, 10);
  const from =
    value('--from') ?? new Date(Date.parse(`${to}T00:00:00Z`) - 27 * DAY).toISOString().slice(0, 10);
  if (from > to) throw new Error('--from must not be after --to');
  return { range: { from, to }, json: argv.includes('--json') };
}

const show = (v: unknown) => (v === null || v === undefined ? '–' : String(v));

/** One row per metric, one column per college. */
export function table(range: YcRange, colleges: [string, YcCollegeMetrics][], live: number): string {
  const rows: [string, (m: YcCollegeMetrics) => unknown][] = [
    ['Live in range', (m) => (m.live ? 'yes' : 'no')],
    ['Verified students', (m) => m.verifiedMembers.students],
    ['Verified alumni', (m) => m.verifiedMembers.alumni],
    ['Verified faculty', (m) => m.verifiedMembers.faculty],
    ['Verified placement cell', (m) => m.verifiedMembers.placementCell],
    ['Verified admins', (m) => m.verifiedMembers.admins],
    ['Weekly active students (avg)', (m) => m.weeklyActiveStudents.average],
    ['Invited', (m) => m.activation.invited],
    ['Signed up', (m) => m.activation.signedUp],
    ['Verified (of signed up)', (m) => m.activation.verified],
    ['Activated in 7 days', (m) => m.activation.activated],
    ['Activation %', (m) => m.activation.activationPct],
    ['Week-4 retention %', (m) => m.week4Retention.pct],
    ['Requests', (m) => m.mentorship.requests],
    ['→ sessions %', (m) => m.mentorship.conversionPct],
    ['Median reply (hours)', (m) => m.mentorship.medianReplyHours],
    ['Drives run', (m) => m.drives.run],
    ['Registration %', (m) => m.drives.registrationPct],
    ['Final-years (batch)', (m) => `${show(m.offers.finalYears)} (${m.offers.gradYear})`],
    ['Offers per 100 final-years', (m) => m.offers.per100],
    ['Previous batch, same point', (m) => m.offers.previous.per100],
    ['Change (points)', (m) => m.offers.change],
    ['AI questions per active student', (m) => m.ai.perActiveStudent],
    ['WhatsApp read %', (m) => m.whatsapp.readPct],
  ];
  const header = ['Metric', ...colleges.map(([slug]) => slug)];
  const body = rows.map(([label, get]) => [label, ...colleges.map(([, m]) => show(get(m)))]);
  const widths = header.map((_, i) => Math.max(...[header, ...body].map((r) => (r[i] ?? '').length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ');
  return [
    `YC metrics ${range.from} to ${range.to} (UTC). Colleges live: ${live} of ${colleges.length}. "<5" = fewer than five; – = not shown (a count under five behind it).`,
    '',
    line(header),
    line(widths.map((w) => '-'.repeat(w))),
    ...body.map(line),
  ].join('\n');
}

async function main() {
  const { range, json } = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const app = createApp({
    env,
    logger: createLogger('silent'),
    readiness: {},
    mailer: new MemoryMailProvider(),
    jobs: new InlineJobQueue(),
    storage: storageFromEnv(env).storage,
  });
  const yc = (app.locals.services as { ycMetrics: YcMetricsService }).ycMetrics;
  const { colleges, platform } = await withPlatformScope('metrics:yc', async () => ({
    colleges: await TenantModel.find({ kind: 'college', status: 'active' })
      .select('_id slug')
      .sort({ slug: 1 })
      .lean(),
    platform: await TenantModel.findOne({ kind: 'platform' }).select('_id').lean(),
  }));
  const results: [string, YcCollegeMetrics][] = [];
  for (const c of colleges) results.push([c.slug, await runInTenant(c._id, () => yc.college(range))]);
  const live = results.filter(([, m]) => m.live).length;
  if (platform)
    await runInTenant(platform._id, () =>
      audit.record(
        { action: 'metrics.yc_run', meta: { from: range.from, to: range.to, colleges: results.length } },
        { requestId: 'metrics-yc', ipPrefix: null },
      ),
    );
  if (json)
    process.stdout.write(
      JSON.stringify(
        {
          range,
          generatedAt: new Date().toISOString(),
          platform: { colleges: results.length, collegesLive: live },
          colleges: Object.fromEntries(results),
        },
        null,
        2,
      ) + '\n',
    );
  else process.stdout.write(`${table(range, results, live)}\n`);
  await mongoose.disconnect();
}

if (process.argv[1]?.endsWith('metrics-yc.ts') || process.argv[1]?.endsWith('metrics-yc.js'))
  main().catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await mongoose.disconnect();
    process.exit(1);
  });
