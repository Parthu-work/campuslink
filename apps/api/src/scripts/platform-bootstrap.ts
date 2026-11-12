/**
 * Prompt 4, P1: the way into a fresh production database.
 *
 *   pnpm --filter @campuslink/api platform:bootstrap --email <email> --name "<name>" [--reissue]
 *   (in the API container: node dist/scripts/platform-bootstrap.js --email … --name …)
 *
 * Creates the platform tenant (`admin.<domain>`) if it is missing and exactly ONE super admin,
 * then prints a single-use set-password link that works for 30 minutes. No password is ever taken
 * from arguments or the environment. Two-factor enrolment is forced at the first sign-in. It
 * refuses when a super admin already exists; `--reissue` prints a new link for that one account
 * while it has never signed in (the first link expired unused). Outside production it refuses
 * unless `--allow-dev` is given (development uses `pnpm seed`).
 *
 * Afterwards: open the link, choose a password, sign in at https://admin.<domain>, turn on
 * two-factor, then create the first college in the platform console (Colleges › New college), or
 * `POST /api/v1/platform/tenants`. See docs/deploy-oracle.md.
 */
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { MemoryMailProvider } from '../lib/mailer.js';
import { InlineJobQueue } from '../lib/jobs.js';
import { MemoryStorage } from '../lib/storage.js';
import { createApp } from '../app.js';
import type { PlatformService } from '../modules/platform/platform.service.js';

export interface BootstrapArgs {
  email: string;
  name: string;
  allowDev: boolean;
  reissue: boolean;
}

export function parseArgs(argv: string[]): BootstrapArgs {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    const v = i < 0 ? undefined : argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${flag} is required`);
    return v;
  };
  const known = new Set(['--email', '--name', '--allow-dev', '--reissue']);
  for (const a of argv)
    if (a.startsWith('--') && !known.has(a))
      // A password is never accepted: say so rather than ignore it.
      throw new Error(
        /pass/i.test(a)
          ? 'No password is taken here: the command prints a set-password link instead'
          : `Unknown option ${a}`,
      );
  return {
    email: value('--email'),
    name: value('--name'),
    allowDev: argv.includes('--allow-dev'),
    reissue: argv.includes('--reissue'),
  };
}

/** The guard the command runs before touching the database. */
export function assertMayRun(nodeEnv: string, allowDev: boolean): void {
  if (nodeEnv !== 'production' && !allowDev)
    throw new Error(
      'platform:bootstrap is for production (NODE_ENV=production). In development use `pnpm seed`, or pass --allow-dev.',
    );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  assertMayRun(env.NODE_ENV, args.allowDev);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  // The services only: nothing is mailed, queued or stored by this command.
  const app = createApp({
    env,
    logger: createLogger('silent'),
    readiness: {},
    mailer: new MemoryMailProvider(),
    jobs: new InlineJobQueue(),
    storage: new MemoryStorage(),
  });
  const platform = (app.locals.services as { platform: PlatformService }).platform;
  const r = await platform.bootstrap({ email: args.email, name: args.name, reissue: args.reissue });
  process.stdout.write(
    [
      '',
      r.reissued
        ? `A new set-password link for ${args.email}.`
        : `Platform administrator created: ${args.email}${r.createdTenant ? ' (platform host: admin)' : ''}.`,
      '',
      `Set your password within ${r.expiresInMinutes} minutes (the link works once):`,
      `  ${r.setupUrl}`,
      '',
      'Then sign in on the same host. You will be asked to turn on two-factor authentication',
      'before anything else works. Create the first college in the platform console afterwards.',
      'This link is a secret until it is used: do not paste it into chat, tickets or logs.',
      '',
    ].join('\n'),
  );
  await mongoose.disconnect();
}

if (process.argv[1]?.endsWith('platform-bootstrap.ts') || process.argv[1]?.endsWith('platform-bootstrap.js'))
  main().catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await mongoose.disconnect();
    process.exit(1);
  });
