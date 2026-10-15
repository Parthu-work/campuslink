/**
 * Local demo data. Every person and college here is FICTIONAL (CLAUDE.md: never invent real data).
 * Usage: pnpm seed   (drops and recreates the local development database)
 */
import mongoose, { type Types } from 'mongoose';
import {
  CONSENT_PURPOSE_KEYS,
  type Role,
  type Capability,
  type Branding,
  type Branch,
} from '@campuslink/shared';
import { loadEnv } from '../config/env.js';
import { syncIndexes } from '../db/connect.js';
import { runInTenant } from '../lib/context.js';
import { hashPassword } from '../lib/passwords.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { UserModel } from '../modules/auth/user.model.js';
import { ConsentModel } from '../modules/consent/consent.model.js';
import { AuditModel } from '../modules/audit/audit.model.js';
import { ProfileModel } from '../modules/profiles/profile.model.js';
import { WhitelistModel } from '../modules/imports/whitelist.model.js';
import { FieldCipher } from '../lib/crypto.js';

const env = loadEnv();
if (env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
const password = process.env.SEED_PASSWORD ?? 'Demo-Campus-Link-2026';
const cipher = new FieldCipher(env.FIELD_ENCRYPTION_KEY);

const COLLEGES: { slug: string; branding: Branding; domain: string }[] = [
  {
    slug: 'dpit',
    domain: 'dpit.example',
    branding: {
      displayName: 'Deccan Plateau Institute of Technology',
      shortName: 'DPIT',
      primary: '#3fb8e6',
      secondary: '#6d5ae6',
      accent: '#f2b705',
      monogram: 'DP',
      city: 'Hyderabad (demo)',
    },
  },
  {
    slug: 'mrce',
    domain: 'mrce.example',
    branding: {
      displayName: 'Musi Riverfront College of Engineering',
      shortName: 'MRCE',
      primary: '#22b07d',
      secondary: '#0e7c86',
      accent: '#ff7a59',
      monogram: 'MR',
      city: 'Hyderabad (demo)',
    },
  },
];

type SeedUser = {
  local: string;
  name: string;
  roles: Role[];
  verified?: boolean;
  capabilities?: Capability[];
  /** College-list record (roll number, graduation year, branch). Staff have none. */
  roll?: { no: string; gradYear: number; branch: Branch };
  profile?: {
    headline?: string;
    company?: string;
    jobTitle?: string;
    skills?: string[];
    topics?: string[];
    languages?: string[];
  };
};
// Fictional demo people and companies (CLAUDE.md: never real people or listings).
const PEOPLE: SeedUser[] = [
  { local: 'admin', name: 'Kavya Iyer', roles: ['COLLEGE_ADMIN'] },
  {
    local: 'tpo',
    name: 'Srinivas Murthy',
    roles: ['TPO'],
    profile: { headline: 'Training & Placement Officer' },
  },
  {
    local: 'faculty',
    name: 'Dr. Haritha Rao',
    roles: ['FACULTY'],
    profile: { headline: 'Associate Professor, CSE', topics: ['Higher studies', 'GATE'] },
  },
  {
    local: 'rahul',
    name: 'Rahul Varma',
    roles: ['ALUMNI'],
    roll: { no: '15XX1A0512', gradYear: 2019, branch: 'CSE' },
    profile: {
      headline: 'Backend engineer · mock interviews',
      company: 'Nimbus Labs (demo)',
      jobTitle: 'SDE II',
      skills: ['Java', 'System design', 'DSA'],
      topics: ['Backend', 'Interview prep'],
      languages: ['Telugu', 'English'],
    },
  },
  {
    local: 'sneha',
    name: 'Sneha Reddy',
    roles: ['ALUMNI'],
    roll: { no: '16XX1A0433', gradYear: 2020, branch: 'ECE' },
    profile: {
      headline: 'ECE → data analytics',
      company: 'Kestrel Analytics (demo)',
      jobTitle: 'Data Analyst',
      skills: ['SQL', 'Python', 'Power BI'],
      topics: ['Core to IT switch', 'Data'],
      languages: ['Telugu', 'English', 'Hindi'],
    },
  },
  {
    local: 'fatima',
    name: 'Fatima Begum',
    roles: ['ALUMNI'],
    roll: { no: '16XX1A0507', gradYear: 2020, branch: 'CSE' },
    profile: {
      headline: 'ML engineer · monthly AMAs',
      company: 'Northstar AI (demo)',
      jobTitle: 'ML Engineer',
      skills: ['Python', 'PyTorch', 'MLOps'],
      topics: ['ML & AI', 'Research'],
      languages: ['Urdu', 'English', 'Telugu'],
    },
  },
  {
    local: 'arjun',
    name: 'Arjun Naidu',
    roles: ['ALUMNI'],
    roll: { no: '14XX1A0301', gradYear: 2018, branch: 'MECH' },
    profile: {
      headline: 'Design engineer · GATE & PSU guidance',
      company: 'Ironleaf Motors (demo)',
      jobTitle: 'Design Engineer',
      skills: ['CATIA', 'GD&T', 'FEA'],
      topics: ['GATE', 'Core jobs'],
      languages: ['Telugu', 'English'],
    },
  },
  {
    local: 'ananya',
    name: 'Ananya K',
    roles: ['STUDENT'],
    roll: { no: '23XX1A0542', gradYear: 2027, branch: 'CSE' },
    profile: { headline: 'Third-year CSE · backend', skills: ['Java', 'Git'] },
  },
  {
    local: 'vikram',
    name: 'Vikram Shetty',
    roles: ['STUDENT'],
    capabilities: ['CERTIFIED_CONTRIBUTOR'],
    roll: { no: '22XX1A0519', gradYear: 2026, branch: 'CSE' },
    profile: { headline: 'Final-year CSE · roadmap contributor', skills: ['React', 'Node.js'] },
  },
  { local: 'newbie', name: 'Sai Teja', roles: ['STUDENT'], verified: false },
];

/** Unclaimed list records: `newbie` can verify with the first one (code goes to Mailpit). */
const UNCLAIMED: { no: string; name: string; gradYear: number; branch: Branch; localEmail: string }[] = [
  { no: '24XX1A0577', name: 'Sai Teja', gradYear: 2028, branch: 'CSE', localEmail: 'sai.teja.records' },
  { no: '24XX1A0578', name: 'Lavanya P', gradYear: 2028, branch: 'IT', localEmail: 'lavanya.records' },
  { no: '13XX1A0201', name: 'Prakash Goud', gradYear: 2017, branch: 'EEE', localEmail: 'prakash.records' },
];

async function addUser(
  email: string,
  name: string,
  roles: Role[],
  hash: string,
  extra: { verified?: boolean; capabilities?: Capability[] } = {},
): Promise<Types.ObjectId> {
  const u = await UserModel.create({
    email,
    name,
    passwordHash: hash,
    roles,
    capabilities: extra.capabilities ?? [],
    verified: extra.verified ?? true,
    emailVerifiedAt: new Date(),
    ageDeclaredAt: new Date(),
  });
  await ConsentModel.insertMany(
    CONSENT_PURPOSE_KEYS.map((purpose) => ({
      userId: u._id,
      purpose,
      version: 1,
      noticeVersion: 'seed',
      granted: true,
      source: 'signup',
    })),
  );
  return u._id;
}

async function main() {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  await syncIndexes();
  const hash = await hashPassword(password);
  const rows: string[][] = [];

  const platform = await TenantModel.create({
    slug: 'admin',
    kind: 'platform',
    branding: {
      displayName: 'CampusLink Platform',
      shortName: 'Platform',
      primary: '#3fb8e6',
      secondary: '#6d5ae6',
      accent: '#f2b705',
      monogram: 'CL',
    },
  });
  await runInTenant(platform._id, async () => {
    await addUser('superadmin@campuslink.example', 'Platform Operator', ['SUPER_ADMIN'], hash);
    await AuditModel.create({ action: 'seed.created', meta: { kind: 'platform' } });
  });
  rows.push([
    'admin.localhost',
    'superadmin@campuslink.example',
    'SUPER_ADMIN',
    '2FA set-up on first sign-in',
  ]);

  for (const c of COLLEGES) {
    const t = await TenantModel.create({
      slug: c.slug,
      branding: c.branding,
      subscription: { plan: 'trial', seatLimit: 1000, renewalDate: null },
    });
    await runInTenant(t._id, async () => {
      for (const p of PEOPLE) {
        const email = `${p.local}@${c.domain}`;
        const userId = await addUser(email, p.name, p.roles, hash, {
          ...(p.verified === false ? { verified: false } : {}),
          ...(p.capabilities ? { capabilities: p.capabilities } : {}),
        });
        const roll = p.roll
          ? { ...p.roll, no: p.roll.no.replace('XX', c.slug.slice(0, 2).toUpperCase()) }
          : null;
        if (roll) {
          await WhitelistModel.create({
            rollNumber: roll.no,
            name: p.name,
            branch: roll.branch,
            gradYear: roll.gradYear,
            kind: p.roles.includes('ALUMNI') ? 'alumni' : 'student',
            source: 'manual',
            emailEnc: cipher.encrypt(email),
            emailIndex: cipher.blindIndex(email),
            status: 'claimed',
            claimedBy: userId,
            claimedAt: new Date(),
          });
        }
        await ProfileModel.create({
          userId,
          name: p.name,
          roles: p.roles,
          verified: p.verified !== false,
          branch: roll?.branch ?? null,
          gradYear: roll?.gradYear ?? null,
          ...p.profile,
        });
        rows.push([
          `${c.slug}.localhost`,
          email,
          p.roles.join(','),
          [
            p.verified === false ? 'unverified (read-only)' : '',
            p.capabilities?.join(',') ?? '',
            p.roles.includes('COLLEGE_ADMIN') ? '2FA set-up on first sign-in' : '',
          ]
            .filter(Boolean)
            .join('; '),
        ]);
      }
      for (const u of UNCLAIMED) {
        const recEmail = `${u.localEmail}@${c.domain}`;
        await WhitelistModel.create({
          rollNumber: u.no.replace('XX', c.slug.slice(0, 2).toUpperCase()),
          name: u.name,
          branch: u.branch,
          gradYear: u.gradYear,
          kind: u.gradYear < new Date().getFullYear() ? 'alumni' : 'student',
          source: 'manual',
          emailEnc: cipher.encrypt(recEmail),
          emailIndex: cipher.blindIndex(recEmail),
        });
      }
      await AuditModel.create({ action: 'seed.created', meta: { kind: 'college' } });
    });
  }

  console.warn(
    `\nSeeded ${COLLEGES.length} demo colleges + platform. Password for every account: ${password}\n`,
  );
  console.warn(['Host', 'Email', 'Role', 'Notes'].join(' | '));
  for (const r of rows) console.warn(r.join(' | '));
  console.warn(
    '\nTry verification: sign in as newbie@dpit.example, open Verify, enter roll number 24DP1A0577; the code arrives in Mailpit (http://localhost:8025).',
  );
  console.warn('Try an import: Admin → Imports → upload docs/samples/sample-students.csv');
  console.warn(
    '\nOpen http://dpit.localhost:5173 or http://mrce.localhost:5173 (platform console: http://admin.localhost:5173)\n',
  );
  await mongoose.disconnect();
}

main().catch(async (err: unknown) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
