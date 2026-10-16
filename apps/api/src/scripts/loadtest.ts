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

type Member = { id: Types.ObjectId; email: string; roles: Role[] };

async function seed(): Promise<{ members: Member[] }> {
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
    subscription: { plan: 'trial', seatLimit: 2000, renewalDate: null },
  });
  const year = new Date().getFullYear();
  const members: Member[] = [];
  await runInTenant(tenant._id, async () => {
    // 60% students, 37% alumni, 3% faculty: roughly the mix of an engineering college.
    const users = Array.from({ length: MEMBERS }, (_, i) => {
      const roles: Role[] = i < 30 ? ['FACULTY'] : i < 400 ? ['ALUMNI'] : ['STUDENT'];
      return {
        _id: new Types.ObjectId(),
        email: `member${i}@loadtest.example`,
        name: `Demo Member ${i}`,
        passwordHash: hash,
        roles,
        verified: true,
        emailVerifiedAt: new Date(),
        ageDeclaredAt: new Date(),
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
    for (const u of users) members.push({ id: u._id, email: u.email, roles: u.roles });
  });
  await mongoose.disconnect();
  return { members };
}

function startApi(): ChildProcess {
  const child = spawn('pnpm', ['exec', 'tsx', 'src/server.ts'], {
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
function postJson(path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: PORT,
        method: 'POST',
        path: `/api/v1${path}`,
        headers: {
          host: HOST,
          origin: `http://${HOST}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
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
  const { members } = await seed();
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
    const rows: Row[] = [];
    for (const s of scenarios) {
      const row = await run(s);
      rows.push(row);
      console.warn(
        `${row.name}: ${row.rps} req/s, p50 ${row.p50} ms, p99 ${row.p99} ms, non-2xx ${row.non2xx}`,
      );
    }
    const out = [
      `Load test: ${MEMBERS} demo members, 5,000 posts, 20,000 notifications; ${CONNECTIONS} connections unless stated (login: 10), ${DURATION}s per scenario, one API instance.`,
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
