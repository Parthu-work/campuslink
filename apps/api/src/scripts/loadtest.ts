/**
 * Load test: one FICTIONAL college with 1,000 members, driven with autocannon.
 *
 * Usage: pnpm --filter @campuslink/api loadtest
 *   LOADTEST_DURATION=20 LOADTEST_CONNECTIONS=50 (defaults) tune the run.
 *
 * Seeds its own database (`campuslink_load`, dropped first; refuses any other name), starts one API
 * instance as a child process on port 4100, signs members in, then runs each scenario in turn and
 * prints p50/p90/p99 latency, throughput and errors as a Markdown table (docs/performance.md).
 * Everything here is demo data (CLAUDE.md: never invent real people).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import autocannon from 'autocannon';
import mongoose, { Types } from 'mongoose';
import { BRANCHES, CONSENT_PURPOSE_KEYS, TOPICS, type Branch, type Role } from '@campuslink/shared';
import { loadEnv } from '../config/env.js';
import { syncIndexes } from '../db/connect.js';
import { runInTenant } from '../lib/context.js';
import { hashPassword } from '../lib/passwords.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { UserModel } from '../modules/auth/user.model.js';
import { ConsentModel } from '../modules/consent/consent.model.js';
import { ProfileModel } from '../modules/profiles/profile.model.js';
import { PostModel } from '../modules/feed/post.model.js';
import { NotificationModel } from '../modules/notifications/notification.model.js';
import { installLibraryRoadmaps } from '../modules/roadmaps/roadmaps.service.js';
import { FieldCipher } from '../lib/crypto.js';
import { WhitelistModel } from '../modules/imports/whitelist.model.js';
import {
  AcademicRecordModel,
  DriveRegistrationModel,
  OfferModel,
  PlacementCompanyModel,
  PlacementDriveModel,
} from '../modules/placements/placements.model.js';
import { companyKey } from '../lib/company.js';
import { ctcBand } from '@campuslink/shared';

const env = loadEnv();
if (env.NODE_ENV === 'production') throw new Error('Refusing to load-test in production');
const DB = 'campuslink_load';
const PORT = 4100;
const MEMBERS = 1000;
const DURATION = Number(process.env.LOADTEST_DURATION ?? 20);
const CONNECTIONS = Number(process.env.LOADTEST_CONNECTIONS ?? 50);
const PASSWORD = 'Demo-Load-Test-2026';
const HOST = 'loadtest.localhost';
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

const mongoUri = (() => {
  const u = new URL(env.MONGODB_URI);
  u.pathname = `/${DB}`;
  return u.toString();
})();

const pick = <T>(xs: readonly T[], i: number): T => xs[i % xs.length] as T;
const SKILLS = [
  'Java',
  'Python',
  'SQL',
  'React',
  'Node.js',
  'DSA',
  'System design',
  'CATIA',
  'MATLAB',
  'Excel',
];
const COMPANIES = [
  'Nimbus Labs (demo)',
  'Kestrel Analytics (demo)',
  'Northstar AI (demo)',
  'Ironleaf Motors (demo)',
];

type Member = { id: Types.ObjectId; email: string; roles: Role[]; phone: string | null };

/** Members who sign in by phone in the load test (fictional numbers, console SMS provider only). */
const PHONE_MEMBERS = 100;
const phoneOf = (i: number) => `+9197000${String(i).padStart(5, '0')}`;
/** Students who register for one drive at the same moment (B15). */
const DRIVE_BURST = 500;
/** Report history: three graduating batches of this many students each (B15). */
const REPORT_BATCH = 1000;
const cipher = new FieldCipher(env.FIELD_ENCRYPTION_KEY, env.FIELD_ENCRYPTION_KEYS_PREVIOUS);

async function seed(): Promise<{ members: Member[]; tenantId: Types.ObjectId; driveId: Types.ObjectId }> {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB) throw new Error(`Refusing to drop ${mongoose.connection.name}`);
  await mongoose.connection.dropDatabase();
  await syncIndexes();
  const hash = await hashPassword(PASSWORD);
  const tenant = await TenantModel.create({
    slug: 'loadtest',
    branding: {
      displayName: 'Load Test College of Engineering (demo)',
      shortName: 'LTCE',
      primary: '#3fb8e6',
      secondary: '#6d5ae6',
      accent: '#f2b705',
      monogram: 'LT',
    },
    subscription: { plan: 'pilot', seats: 2000, renewalDate: null },
  });
  const year = new Date().getFullYear();
  const members: Member[] = [];
  let tenantId = tenant._id;
  let driveId = new Types.ObjectId();
  await runInTenant(tenant._id, async () => {
    // 60% students, 37% alumni, 3% faculty: roughly the mix of an engineering college.
    const users = Array.from({ length: MEMBERS }, (_, i) => {
      // Member 0 runs placements (reports, the drive); 1–29 are faculty.
      const roles: Role[] = i === 0 ? ['TPO'] : i < 30 ? ['FACULTY'] : i < 400 ? ['ALUMNI'] : ['STUDENT'];
      // The first students sign in by phone too (B15).
      const phone = i >= 400 && i < 400 + PHONE_MEMBERS ? phoneOf(i) : null;
      return {
        _id: new Types.ObjectId(),
        email: `member${i}@loadtest.example`,
        name: `Demo Member ${i}`,
        passwordHash: hash,
        roles,
        verified: true,
        emailVerifiedAt: new Date(),
        ageCheckedAt: new Date(),
        ...(phone
          ? {
              phoneEnc: cipher.encrypt(phone),
              phoneIndex: cipher.blindIndex(phone),
              phoneVerifiedAt: new Date(),
            }
          : {}),
      };
    });
    await UserModel.insertMany(users);
    await ConsentModel.insertMany(
      users.flatMap((u) =>
        CONSENT_PURPOSE_KEYS.map((purpose) => ({
          userId: u._id,
          purpose,
          version: 1,
          noticeVersion: 'loadtest',
          granted: true,
          source: 'signup',
        })),
      ),
    );
    await ProfileModel.insertMany(
      users.map((u, i) => {
        const alumni = u.roles.includes('ALUMNI');
        const staff = u.roles.includes('FACULTY');
        return {
          userId: u._id,
          name: u.name,
          roles: u.roles,
          verified: true,
          branch: staff ? null : pick<Branch>(BRANCHES, i),
          gradYear: staff ? null : alumni ? year - 1 - (i % 10) : year + (i % 4),
          headline: alumni ? `Demo ${pick(SKILLS, i)} engineer` : staff ? 'Demo faculty' : 'Demo student',
          ...(alumni ? { company: pick(COMPANIES, i), jobTitle: 'Engineer' } : {}),
          skills: [pick(SKILLS, i), pick(SKILLS, i + 3)],
          topics: [pick(TOPICS, i)],
        };
      }),
    );
    // 5,000 posts over the last 30 days from alumni and faculty.
    const authors = users.filter((u) => !u.roles.includes('STUDENT'));
    await PostModel.insertMany(
      Array.from({ length: 5000 }, (_, i) => {
        const a = pick(authors, i * 7);
        return {
          authorId: a._id,
          kind: 'text',
          body: `Demo load-test post ${i}: a tip about ${pick(SKILLS, i)} and #${pick(TOPICS, i)}.`,
          topics: [pick(TOPICS, i)],
          authorAlumni: a.roles.includes('ALUMNI'),
          createdAt: new Date(Date.now() - (i % 720) * 3600_000),
          counts: { helpful: i % 13, insightful: i % 7, celebrate: i % 5, comments: 0, saves: 0, shares: 0 },
        };
      }),
    );
    // 20 notifications per member.
    await NotificationModel.insertMany(
      users.flatMap((u) =>
        Array.from({ length: 20 }, (_, k) => ({
          userId: u._id,
          type: 'badge_earned',
          data: { badge: 'first_step' },
          createdAt: new Date(Date.now() - k * 3600_000),
          expiresAt: new Date(Date.now() + 90 * 86_400_000),
        })),
      ),
    );
    await installLibraryRoadmaps();
    // Placements (B15): every student has a verified record; one open drive anyone may join.
    const students = users.filter((u) => u.roles.includes('STUDENT'));
    await AcademicRecordModel.insertMany(
      students.map((u, i) => ({
        rollNumber: `LT${String(i).padStart(5, '0')}`,
        userId: u._id,
        cgpa: 6 + (i % 40) / 10,
        activeBacklogs: 0,
        historyBacklogs: i % 5 === 0 ? 1 : 0,
        source: 'import',
        verifiedAt: new Date(),
      })),
    );
    const company = await PlacementCompanyModel.create({
      name: 'Loadtest Systems (demo)',
      companyKey: companyKey('Loadtest Systems (demo)'),
    });
    const staff = users[0]?._id ?? new Types.ObjectId();
    const drive = await PlacementDriveModel.create({
      companyId: company._id,
      title: 'Load test drive (DEMO)',
      roles: [{ title: 'Engineer', ctcMinLpa: 5, ctcMaxLpa: 7, location: 'Hyderabad', type: 'full_time' }],
      mode: 'virtual',
      driveDate: new Date(Date.now() + 10 * 86_400_000),
      registrationCloseAt: new Date(Date.now() + 5 * 86_400_000),
      eligibility: { branches: [], gradYears: [] },
      rounds: [{ name: 'Interview', kind: 'technical', at: null }],
      resumeRequired: false,
      status: 'open',
      openedAt: new Date(),
      createdBy: staff,
    });
    // Report history: three graduating batches on the college's list, with registrations and offers
    // for most of each (anonymised rows: the institutional record, no member behind them).
    const companies = COMPANIES.map((c) => ({ name: c, key: companyKey(c) }));
    for (const back of [1, 2, 3]) {
      const gradYear = year - back;
      await WhitelistModel.insertMany(
        Array.from({ length: REPORT_BATCH }, (_, i) => ({
          rollNumber: `LT${gradYear}${String(i).padStart(4, '0')}`,
          name: `Demo Graduate ${gradYear}-${i}`,
          branch: pick<Branch>(BRANCHES, i),
          gradYear,
          kind: 'alumni',
          source: 'import',
        })),
      );
      await DriveRegistrationModel.insertMany(
        Array.from({ length: Math.round(REPORT_BATCH * 0.8) }, (_, i) => ({
          driveId: drive._id,
          userId: null,
          anonKey: `lt-${gradYear}-${i}`,
          status: 'registered',
          final: i % 4 === 3 ? 'not_selected' : 'selected',
          branch: pick<Branch>(BRANCHES, i),
          gradYear,
        })),
      );
      await OfferModel.insertMany(
        Array.from({ length: Math.round(REPORT_BATCH * 0.6) }, (_, i) => {
          const ctc = 3 + (i % 90) / 10;
          const c = pick(companies, i);
          return {
            userId: null,
            anonKey: `lt-${gradYear}-${i}`,
            companyKey: c.key,
            companyName: c.name,
            role: 'Engineer',
            ctcLpa: ctc,
            ctcBand: ctcBand(ctc),
            offerDate: new Date(`${gradYear}-03-01`),
            type: 'full_time',
            source: 'drive',
            status: 'verified',
            verifiedAt: new Date(`${gradYear}-03-10`),
            branch: pick<Branch>(BRANCHES, i),
            gradYear,
          };
        }),
      );
    }
    for (const u of users)
      members.push({
        id: u._id,
        email: u.email,
        roles: u.roles,
        phone: 'phoneEnc' in u ? phoneOf(users.indexOf(u)) : null,
      });
    tenantId = tenant._id;
    driveId = drive._id;
  });
  await mongoose.disconnect();
  return { members, tenantId, driveId };
}

function startApi(): ChildProcess {
  // Node runs tsx's CLI directly: no shell, so it works on Windows (no pnpm.cmd) and kill() stops the API.
  const tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'));
  const child = spawn(process.execPath, [tsxCli, 'src/server.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      LOG_LEVEL: 'warn',
      API_PORT: String(PORT),
      MONGODB_URI: mongoUri,
      // Rate limits stay on (Redis) but scaled up, so the load test measures the API, not the limiter.
      RATE_LIMIT_SCALE: '1000',
      INGESTION_ENABLED: 'false',
      HIBP_ENABLED: 'false',
      // Codes go to the in-memory console outbox, read back through /dev/outbox (B15).
      SMS_PROVIDER: 'console',
      WHATSAPP_PROVIDER: 'disabled',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return child;
}

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/ready`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('API did not become ready');
}

/** fetch() drops a custom Host header, and the tenant comes from the Host, so use node:http. */
function postJson(
  path: string,
  payload: unknown,
  extra: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  return send('POST', path, payload, extra);
}
const getJson = (path: string, extra: Record<string, string> = {}) => send('GET', path, undefined, extra);

function send(
  method: 'GET' | 'POST',
  path: string,
  payload: unknown,
  extra: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const data = payload === undefined ? '' : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: PORT,
        method,
        path: `/api/v1${path}`,
        headers: {
          host: HOST,
          origin: `http://${HOST}`,
          ...(data
            ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(data)) }
            : {}),
          ...extra,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (text += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as unknown });
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

async function signIn(email: string): Promise<string> {
  const r = await postJson('/auth/login', { email, password: PASSWORD });
  const token = (r.body as { data?: { session?: { accessToken?: string } } }).data?.session?.accessToken;
  if (!token) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return token;
}

/** Runs `count` tasks, `concurrency` at a time, and reports their latency like a scenario row. */
async function burst(
  name: string,
  count: number,
  concurrency: number,
  task: (i: number) => Promise<boolean>,
): Promise<Row> {
  const times: number[] = [];
  let failed = 0;
  let next = 0;
  const started = Date.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count) {
        const i = next++;
        const t = Date.now();
        const ok = await task(i).catch(() => false);
        times.push(Date.now() - t);
        if (!ok) failed++;
      }
    }),
  );
  times.sort((a, b) => a - b);
  const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))] ?? 0;
  return {
    name,
    rps: Math.round(count / ((Date.now() - started) / 1000)),
    p50: q(0.5),
    p90: q(0.9),
    p99: q(0.99),
    max: times.at(-1) ?? 0,
    requests: count,
    non2xx: failed,
    errors: 0,
  };
}

type Scenario = {
  name: string;
  method?: 'GET' | 'POST';
  path: string | ((i: number) => string);
  tokens: string[] | null;
  body?: (i: number) => unknown;
  connections?: number;
};

type Row = {
  name: string;
  rps: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
  requests: number;
  non2xx: number;
  errors: number;
};

async function run(s: Scenario): Promise<Row> {
  let n = 0;
  const result = await autocannon({
    url: BASE,
    connections: s.connections ?? CONNECTIONS,
    duration: DURATION,
    requests: [
      {
        method: s.method ?? 'GET',
        setupRequest: (req) => {
          const i = n++;
          const headers: Record<string, string> = { host: HOST, origin: `http://${HOST}` };
          if (s.tokens) headers.authorization = `Bearer ${pick(s.tokens, i)}`;
          if (s.body) headers['content-type'] = 'application/json';
          if (s.method === 'POST') headers['idempotency-key'] = `load-${i}-${Date.now()}`;
          return {
            ...req,
            path: `/api/v1${typeof s.path === 'function' ? s.path(i) : s.path}`,
            headers,
            ...(s.body ? { body: JSON.stringify(s.body(i)) } : {}),
          };
        },
      },
    ],
  });
  return {
    name: s.name,
    rps: Math.round(result.requests.average),
    p50: result.latency.p50,
    p90: result.latency.p90,
    p99: result.latency.p99,
    max: result.latency.max,
    requests: result.requests.total,
    non2xx: result.non2xx,
    errors: result.errors + result.timeouts,
  };
}

async function main() {
  const t0 = Date.now();
  const { members, tenantId, driveId } = await seed();
  console.warn(`Seeded ${members.length} demo members in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const api = startApi();
  try {
    await waitReady();
    const sample = (role: Role, count: number) =>
      members.filter((m) => m.roles.includes(role)).slice(0, count);
    const students = await Promise.all(sample('STUDENT', 40).map((m) => signIn(m.email)));
    const alumni = await Promise.all(sample('ALUMNI', 20).map((m) => signIn(m.email)));
    const everyone = [...students, ...alumni];
    const scenarios: Scenario[] = [
      { name: 'GET /tenant (public)', path: '/tenant', tokens: null },
      { name: 'GET /me', path: '/me', tokens: everyone },
      { name: 'GET /feed (For you)', path: '/feed', tokens: everyone },
      { name: 'GET /feed (For you), 10 connections', path: '/feed', tokens: everyone, connections: 10 },
      { name: 'GET /feed?tab=following', path: '/feed?tab=following', tokens: everyone },
      {
        name: 'GET /directory (filter)',
        path: (i) => `/directory?role=ALUMNI&branch=${pick(BRANCHES, i)}`,
        tokens: everyone,
      },
      { name: 'GET /directory?q= (search)', path: (i) => `/directory?q=member${i % 900}`, tokens: everyone },
      { name: 'GET /notifications', path: '/notifications', tokens: everyone },
      { name: 'GET /roadmaps', path: '/roadmaps', tokens: everyone },
      { name: 'GET /jobs', path: '/jobs', tokens: everyone },
      { name: 'GET /events', path: '/events', tokens: everyone },
      {
        name: 'POST /posts (write)',
        method: 'POST',
        path: '/posts',
        tokens: alumni,
        body: (i) => ({ kind: 'text', body: `Demo load-test write ${i}: practise one DSA problem a day.` }),
      },
      {
        name: 'POST /auth/login (argon2id)',
        method: 'POST',
        path: '/auth/login',
        tokens: null,
        connections: 10,
        body: (i) => ({ email: pick(members, i).email, password: PASSWORD }),
      },
    ];
    // Reports over three batches of 1,000 graduates (B15), read by the placement cell.
    const tpo = await signIn(members[0]?.email ?? '');
    const lastBatch = new Date().getFullYear() - 1;
    scenarios.push(
      {
        name: 'GET NBA SAR placement report (3 × 1,000 graduates)',
        path: `/admin/outcome-reports/nba-sar-placement?gradYear=${lastBatch}`,
        tokens: [tpo],
        connections: 10,
      },
      {
        name: 'GET NIRF median salary report',
        path: `/admin/outcome-reports/nirf-median-salary?gradYear=${lastBatch}`,
        tokens: [tpo],
        connections: 10,
      },
      {
        name: 'GET reports dashboard',
        path: `/admin/outcome-reports/dashboard?gradYear=${lastBatch}`,
        tokens: [tpo],
        connections: 10,
      },
    );
    const rows: Row[] = [];
    // Phone sign-in (B15): code sent by SMS (console), read back, verified; ten at a time.
    const phones = members.filter((m) => m.phone).map((m) => m.phone as string);
    rows.push(
      await burst('Phone sign-in: start + verify (console SMS)', phones.length, 10, async (i) => {
        const phone = phones[i] as string;
        const start = await postJson('/auth/phone/start', { phone, purpose: 'login', channel: 'sms' });
        const challengeId = (start.body as { data?: { challengeId?: string } }).data?.challengeId;
        const out = await getJson(`/dev/outbox?to=${encodeURIComponent(phone)}`);
        const code = (out.body as { data?: { params: string[] }[] }).data?.[0]?.params[0];
        if (!challengeId || !code) return false;
        const v = await postJson('/auth/phone/verify', { challengeId, code });
        return v.status === 200;
      }),
    );
    // 500 students register for one drive at the same moment (B15): each once, none lost.
    const burstStudents = members.filter((m) => m.roles.includes('STUDENT')).slice(0, DRIVE_BURST);
    const burstTokens: string[] = [];
    /** Why a registration in the burst was not created (status and error code), to explain a shortfall. */
    const burstFailures = new Map<string, number>();
    await burst('(sign-in for the drive burst)', burstStudents.length, 20, async (i) => {
      burstTokens[i] = await signIn((burstStudents[i] as Member).email);
      return true;
    });
    rows.push(
      await burst(`Drive registration: ${DRIVE_BURST} at once`, DRIVE_BURST, DRIVE_BURST, async (i) => {
        const r = await postJson(
          `/placements/drives/${String(driveId)}/register`,
          {},
          { authorization: `Bearer ${burstTokens[i] ?? ''}`, 'idempotency-key': `burst-${i}-${Date.now()}` },
        ).catch((e: unknown) => {
          // No response at all (the connection failed): recorded, so a shortfall is explained.
          const k = `no response: ${(e as { code?: string; message?: string }).code ?? (e as Error).message}`;
          burstFailures.set(k, (burstFailures.get(k) ?? 0) + 1);
          return null;
        });
        if (!r) return false;
        if (r.status !== 201) {
          const code = (r.body as { error?: { code?: string } })?.error?.code ?? '';
          const k = `${r.status} ${code}`;
          burstFailures.set(k, (burstFailures.get(k) ?? 0) + 1);
        }
        return r.status === 201;
      }),
    );
    // A second tap from the same students changes nothing (the unique index holds).
    rows.push(
      await burst('Drive registration: the same 50 again (refused)', 50, 50, async (i) => {
        const r = await postJson(
          `/placements/drives/${String(driveId)}/register`,
          {},
          { authorization: `Bearer ${burstTokens[i] ?? ''}`, 'idempotency-key': `again-${i}-${Date.now()}` },
        );
        return r.status === 409;
      }),
    );
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    const registered = await runInTenant(tenantId, () =>
      DriveRegistrationModel.countDocuments({ driveId, userId: { $ne: null } }),
    );
    await mongoose.disconnect();
    console.warn(`Drive registrations stored: ${registered} (expected ${DRIVE_BURST})`);
    if (burstFailures.size)
      console.warn(`Burst responses other than 201: ${JSON.stringify(Object.fromEntries(burstFailures))}`);
    if (registered !== DRIVE_BURST) process.exitCode = 1;
    for (const s of scenarios) {
      const row = await run(s);
      rows.push(row);
      console.warn(
        `${row.name}: ${row.rps} req/s, p50 ${row.p50} ms, p99 ${row.p99} ms, non-2xx ${row.non2xx}`,
      );
    }
    const out = [
      `Load test: ${MEMBERS} demo members, 5,000 posts, 20,000 notifications, three batches of ${REPORT_BATCH} graduates; ${CONNECTIONS} connections unless stated (login: 10), ${DURATION}s per scenario, one API instance. Bursts (phone sign-in, drive registration) run a fixed number of requests.`,
      '',
      '| Scenario | Req/s | p50 ms | p90 ms | p99 ms | Max ms | Requests | Non-2xx | Errors |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...rows.map(
        (r) =>
          `| ${r.name} | ${r.rps} | ${r.p50} | ${r.p90} | ${r.p99} | ${r.max} | ${r.requests} | ${r.non2xx} | ${r.errors} |`,
      ),
    ].join('\n');
    process.stdout.write(`\n${out}\n\n`);
    const failed = rows.filter((r) => r.errors > 0 || r.non2xx > 0);
    if (failed.length) {
      console.error(`Scenarios with errors: ${failed.map((r) => r.name).join(', ')}`);
      process.exitCode = 1;
    }
  } finally {
    api.kill('SIGTERM');
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
