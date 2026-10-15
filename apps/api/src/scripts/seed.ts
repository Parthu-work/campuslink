/**
 * Local demo data. Every person and college here is FICTIONAL (CLAUDE.md: never invent real data).
 * Usage: pnpm seed   (drops and recreates the local development database)
 */
import mongoose, { type Types } from 'mongoose';
import { CONSENT_PURPOSE_KEYS, type Role, type Capability, type Branding } from '@campuslink/shared';
import { loadEnv } from '../config/env.js';
import { syncIndexes } from '../db/connect.js';
import { runInTenant } from '../lib/context.js';
import { hashPassword } from '../lib/passwords.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { UserModel } from '../modules/auth/user.model.js';
import { ConsentModel } from '../modules/consent/consent.model.js';
import { AuditModel } from '../modules/audit/audit.model.js';

const env = loadEnv();
if (env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
const password = process.env.SEED_PASSWORD ?? 'Demo-Campus-Link-2026';

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
};
const PEOPLE: SeedUser[] = [
  { local: 'admin', name: 'Kavya Iyer', roles: ['COLLEGE_ADMIN'] },
  { local: 'tpo', name: 'Srinivas Murthy', roles: ['TPO'] },
  { local: 'faculty', name: 'Dr. Haritha Rao', roles: ['FACULTY'] },
  { local: 'rahul', name: 'Rahul Varma', roles: ['ALUMNI'] },
  { local: 'sneha', name: 'Sneha Reddy', roles: ['ALUMNI'] },
  { local: 'fatima', name: 'Fatima Begum', roles: ['ALUMNI'] },
  { local: 'arjun', name: 'Arjun Naidu', roles: ['ALUMNI'] },
  { local: 'ananya', name: 'Ananya K', roles: ['STUDENT'] },
  { local: 'vikram', name: 'Vikram Shetty', roles: ['STUDENT'], capabilities: ['CERTIFIED_CONTRIBUTOR'] },
  { local: 'newbie', name: 'Sai Teja', roles: ['STUDENT'], verified: false },
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
        await addUser(email, p.name, p.roles, hash, {
          ...(p.verified === false ? { verified: false } : {}),
          ...(p.capabilities ? { capabilities: p.capabilities } : {}),
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
      await AuditModel.create({ action: 'seed.created', meta: { kind: 'college' } });
    });
  }

  console.warn(
    `\nSeeded ${COLLEGES.length} demo colleges + platform. Password for every account: ${password}\n`,
  );
  console.warn(['Host', 'Email', 'Role', 'Notes'].join(' | '));
  for (const r of rows) console.warn(r.join(' | '));
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
