import { beforeAll, describe, expect, it } from 'vitest';
import { PILOT_PRESET, PLAN_STORAGE, type Permission } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { clearTenantCache, findTenantById } from '../src/modules/tenants/tenant.cache.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { AiUsageModel } from '../src/modules/study/ai-usage.model.js';
import { ChannelUsageModel } from '../src/modules/notifications/channels/channel.model.js';
import { FileModel } from '../src/modules/files/file.model.js';
import { GrowthSettingsModel } from '../src/modules/public-pages/public-page.model.js';
import type { CostsService } from '../src/modules/billing/costs.service.js';
import type { PilotPresetService } from '../src/modules/platform/pilot-preset.service.js';
import type { EntitlementsService } from '../src/modules/billing/entitlements.js';
import type { FilesService } from '../src/modules/files/files.service.js';
import { parseArgs as costArgs, parseBackupStatus, table } from '../src/scripts/costs-report.js';
import { parseArgs as presetArgs, summary } from '../src/scripts/pilot-preset.js';

/** Prompt 4: the cost report (P5), the storage limits (P7) and the pilot preset (P11). */
const ctx = testApp(
  {},
  {
    AI_PLATFORM_PRICE_INPUT: '1',
    AI_PLATFORM_PRICE_OUTPUT: '5',
    AI_PLATFORM_PRICE_EMBEDDING: '0',
    AI_PLATFORM_PRICE_CURRENCY: 'USD',
    COST_USD_INR: '90',
    COST_WHATSAPP_MESSAGE_PAISE: '15',
  },
);
const services = ctx.app.locals.services as {
  costs: CostsService;
  pilotPreset: PilotPresetService;
  entitlements: EntitlementsService;
  files: FilesService;
};
let A: TestTenant, B: TestTenant;
let student: TestUser, admin: TestUser;
const MONTH = '2026-10';
const inT = <R>(t: TestTenant, fn: () => Promise<R>) => runInTenant(t._id, fn);

beforeAll(async () => {
  A = await makeTenant('cost-a');
  B = await makeTenant('cost-b');
  student = await makeUser(ctx, A, { roles: ['STUDENT'] });
  admin = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  await inT(A, async () => {
    const row = (
      day: string,
      kind: string,
      platform: boolean,
      inputTokens: number,
      outputTokens: number,
    ) => ({
      day,
      kind,
      feature: kind === 'embedding' ? 'embedding' : 'study_chat',
      platform,
      model: 'mock:test',
      requests: 1,
      inputTokens,
      outputTokens,
    });
    await AiUsageModel.insertMany([
      row('2026-10-03', 'chat', true, 600_000, 100_000),
      row('2026-10-09', 'embedding', true, 2_000_000, 0),
      row('2026-10-09', 'chat', false, 40_000, 10_000),
      // Another month: not in October's report.
      row('2026-11-01', 'chat', true, 999_999, 999_999),
      row('2026-09-30', 'chat', true, 999_999, 999_999),
    ]);
    await ChannelUsageModel.insertMany([
      { day: '2026-10-02', channel: 'whatsapp', category: 'mentorship', count: 30 },
      { day: '2026-10-20', channel: 'whatsapp', category: 'authentication', count: 10 },
      { day: '2026-10-20', channel: 'sms', category: 'authentication', count: 7 },
      { day: '2026-11-02', channel: 'whatsapp', category: 'mentorship', count: 500 },
    ]);
    await FileModel.insertMany(
      [3, 5].map((mb, i) => ({
        ownerId: student.id,
        purpose: 'message_attachment',
        mime: 'application/pdf',
        size: mb * 1048576,
        storageKey: `cost-test-${i}`,
        sha256: String(i).repeat(64),
        scanStatus: 'clean',
      })),
    );
  });
});

describe('the cost report (prompt 4, P5)', () => {
  it('adds up one month per college, beside each allowance and limit', async () => {
    const r = await services.costs.report(MONTH, {
      at: '2026-10-31T21:00:00Z',
      ok: true,
      remoteBytes: 3 * 1024 ** 3,
    });
    const a = r.colleges.find((c) => c.slug === 'cost-a');
    const b = r.colleges.find((c) => c.slug === 'cost-b');
    const tenant = await findTenantById(A._id);
    expect(a).toMatchObject({
      ai: {
        platformTokens: 2_700_000,
        ownTokens: 50_000,
        allowanceTokens: services.entitlements.limit(tenant!, 'aiTokens'),
        // 0.6 M input × $1 + 0.1 M output × $5 + embeddings × $0 = $1.10 → ₹99.00 at 90.
        estimate: 1.1,
        currency: 'USD',
        estimatePaise: 9900,
      },
      whatsapp: {
        messages: 40,
        allowance: services.entitlements.limit(tenant!, 'whatsapp'),
        estimatePaise: 600,
      },
      // SMS has no price set: the count is shown, the amount is unknown, never a guess.
      sms: { messages: 7, estimatePaise: null },
      storage: { bytes: 8 * 1048576, limitBytes: PLAN_STORAGE.pilot.storageMb * 1048576 },
    });
    // The idle college: zero everywhere, and ₹0 even where no price is set.
    expect(b).toMatchObject({
      ai: { platformTokens: 0, ownTokens: 0, estimate: 0, estimatePaise: 0 },
      whatsapp: { messages: 0, estimatePaise: 0 },
      sms: { messages: 0, estimatePaise: 0 },
      storage: { bytes: 0 },
    });
    expect(r.totals).toMatchObject({
      aiPlatformTokens: 2_700_000,
      whatsappMessages: 40,
      smsMessages: 7,
      storageBytes: 8 * 1048576,
      // One used service (SMS) has no price, so the total is "not all prices are set".
      estimatePaise: null,
    });
    expect(r.backup).toMatchObject({
      status: { remoteBytes: 3 * 1024 ** 3, ok: true },
      freeTierBytes: 10 * 1024 ** 3,
      alertBytes: 8 * 1024 ** 3,
    });
  });

  it('holds aggregates only: no member id, email or file key', async () => {
    const text = JSON.stringify(await services.costs.report(MONTH));
    expect(text).not.toContain(student.id);
    expect(text).not.toContain(student.email);
    expect(text).not.toContain('cost-test-0');
  });

  it('an idle month is ₹0', async () => {
    const r = await services.costs.report('2025-01');
    expect(r.totals).toMatchObject({
      aiPlatformTokens: 0,
      whatsappMessages: 0,
      smsMessages: 0,
      estimatePaise: 0,
    });
    await expect(services.costs.report('2026-13')).rejects.toThrow(/month looks like/);
  });

  it('the command: arguments, the backup status file and the table', async () => {
    expect(costArgs([], new Date('2026-11-10T00:00:00Z'))).toEqual({
      month: '2026-11',
      json: false,
      backupStatus: null,
    });
    expect(costArgs(['--month', '2026-10', '--json', '--backup-status', '/x/status.json'])).toEqual({
      month: '2026-10',
      json: true,
      backupStatus: '/x/status.json',
    });
    expect(() => costArgs(['--month', 'October'])).toThrow(/2026-11/);
    expect(() => costArgs(['--month'])).toThrow(/needs a value/);
    expect(parseBackupStatus('{"at":"2026-10-31T21:00:00Z","ok":true,"remoteBytes":1024}')).toEqual({
      at: '2026-10-31T21:00:00Z',
      ok: true,
      remoteBytes: 1024,
    });
    for (const bad of [
      '',
      'not json',
      '{"at":"x","ok":true,"remoteBytes":1}',
      '{"ok":true}',
      '{"at":"2026-10-31","ok":true,"remoteBytes":-1}',
    ])
      expect(parseBackupStatus(bad)).toBeNull();
    const text = table(await services.costs.report(MONTH));
    expect(text).toContain('cost-a');
    expect(text).toContain('₹99.00');
    expect(text).toContain('price not set');
    expect(text).toContain('Off-site backup (R2): unknown');
  });
});

describe('storage limits (prompt 4, P7)', () => {
  it('a pilot college has the plan’s limits; the college’s own limit wins; other plans have none', async () => {
    const t = (await findTenantById(A._id))!;
    expect(services.entitlements.limit(t, 'storageMb')).toBe(PLAN_STORAGE.pilot.storageMb);
    expect(services.entitlements.limit(t, 'studyMediaMb')).toBe(PLAN_STORAGE.pilot.studyMediaMb);
    expect(services.entitlements.limit({ ...t, limits: { ...t.limits, storageMb: 9 } }, 'storageMb')).toBe(9);
    expect(
      services.entitlements.limit(
        { ...t, subscription: { ...t.subscription!, plan: 'placement' } },
        'storageMb',
      ),
    ).toBe(0);
  });

  it('refuses a member’s upload that would pass the college’s limit, and takes it once there is room', async () => {
    // 8 MB are stored; a 9 MB limit leaves under 1 MB.
    await TenantModel.updateOne({ _id: A._id }, { $set: { 'limits.storageMb': 9 } });
    clearTenantCache();
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1_200_000, 0x20)]);
    await expect(inT(A, () => services.files.storeImportSource(student.id, big, 'text/csv'))).rejects.toThrow(
      /storage is full \(9 MB\)/,
    );
    expect(await inT(A, () => FileModel.countDocuments({}))).toBe(2);
    const small = Buffer.from('roll,name\n1,A\n');
    await expect(
      inT(A, () => services.files.storeImportSource(student.id, small, 'text/csv')),
    ).resolves.toMatchObject({ size: small.length });
    // The other college is not affected by A's limit or A's files.
    await expect(
      inT(B, () => services.files.storeImportSource(student.id, big, 'text/csv')),
    ).resolves.toBeTruthy();
    await TenantModel.updateOne({ _id: A._id }, { $set: { 'limits.storageMb': null } });
    clearTenantCache();
  });
});

describe('the pilot preset (prompt 4, P11)', () => {
  const perms = async (u: TestUser) =>
    (await api(ctx, u.tenant.host, u.token).get('/me')).body.data.permissions as Permission[];

  it('refuses a college that does not exist (and a platform or employer host)', async () => {
    await expect(services.pilotPreset.apply('no-such-college')).rejects.toThrow(/not found/i);
    await makeTenant('cost-platform', 'platform');
    await expect(services.pilotPreset.apply('cost-platform')).rejects.toThrow(/not found/i);
  });

  it('--dry-run lists the changes and writes nothing', async () => {
    await inT(A, () =>
      GrowthSettingsModel.updateOne(
        { key: 'growth' },
        { $set: { 'outcomesPage.enabled': true } },
        { upsert: true },
      ),
    );
    await TenantModel.updateOne({ _id: A._id }, { $set: { 'network.alumniDiscovery': true } });
    clearTenantCache();
    const before = await TenantModel.findById(A._id).lean();
    const r = await services.pilotPreset.apply('cost-a', { dryRun: true });
    expect(r.dryRun).toBe(true);
    const names = r.changes.map((c) => c.setting);
    expect(names).toEqual(
      expect.arrayContaining([
        'features.stories',
        'features.reels',
        'permissions.revoke.STUDENT',
        'network.alumniDiscovery',
        'subscription.terms.whatsappPerStudentMonthly',
        'subscription.terms.aiTokensPerStudentMonthly',
        'limits.storageMb',
        'limits.studyMediaMb',
        'growth.outcomesPage.enabled',
      ]),
    );
    expect(await TenantModel.findById(A._id).lean()).toEqual(before);
    expect(await inT(A, () => AuditModel.countDocuments({ action: 'platform.pilot_preset_applied' }))).toBe(
      0,
    );
    expect(summary(r)).toContain('dry run, nothing written');
  });

  it('sets the switches and limits, keeps the data, and writes an audit row in the college', async () => {
    expect(await perms(student)).toEqual(
      expect.arrayContaining(['circles:join', 'share:pages', 'parents:digest']),
    );
    const filesBefore = await inT(A, () => FileModel.countDocuments({}));
    const r = await services.pilotPreset.apply('cost-a');
    expect(r.dryRun).toBe(false);
    clearTenantCache();
    const t = (await findTenantById(A._id))!;
    // On and off.
    for (const f of PILOT_PRESET.featuresOn) expect(t.features[f], f).toBe(true);
    for (const f of PILOT_PRESET.featuresOff) expect(t.features[f], f).toBe(false);
    expect(t.network).toMatchObject({ alumniDiscovery: false, employerAccess: false, credentials: false });
    // Limits: the conservative allowances and the storage limits.
    expect(t.terms).toMatchObject(PILOT_PRESET.terms);
    expect(services.entitlements.limit(t, 'storageMb')).toBe(PILOT_PRESET.limits.storageMb);
    expect(services.entitlements.limit(t, 'studyMediaMb')).toBe(PILOT_PRESET.limits.studyMediaMb);
    expect(services.entitlements.limit(t, 'whatsapp')).toBe(
      (t.subscription?.seats ?? 0) * PILOT_PRESET.terms.whatsappPerStudentMonthly,
    );
    // The modules without a switch are off for every role; the core is untouched.
    for (const u of [student, admin]) {
      const held = await perms(u);
      for (const p of PILOT_PRESET.revoke) expect(held, `${u.email} ${p}`).not.toContain(p);
    }
    expect(await perms(student)).toEqual(
      expect.arrayContaining(['mentorship:request', 'jobs:read', 'roadmaps:read', 'qa:ask']),
    );
    // Authorization runs before validation: proposing a circle is refused outright.
    expect((await api(ctx, A.host, student.token).post('/circles').send({})).status).toBe(403);
    expect(await inT(A, () => GrowthSettingsModel.findOne({ key: 'growth' }).lean())).toMatchObject({
      outcomesPage: { enabled: false },
    });
    // Nothing was deleted.
    expect(await inT(A, () => FileModel.countDocuments({}))).toBe(filesBefore);
    const rows = await inT(A, () => AuditModel.find({ action: 'platform.pilot_preset_applied' }).lean());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      targetType: 'tenant',
      targetId: String(A._id),
      meta: { changed: r.changes.length },
    });
    // The other college is untouched.
    const other = (await findTenantById(B._id))!;
    expect(other.features.stories).toBe(true);
    expect(other.permissionOverrides?.revoke ?? {}).toEqual({});
  });

  it('is idempotent: a second run changes nothing and writes no second audit row', async () => {
    const r = await services.pilotPreset.apply('cost-a');
    expect(r.changes).toEqual([]);
    expect(summary(r)).toContain('Nothing to change');
    expect(await inT(A, () => AuditModel.countDocuments({ action: 'platform.pilot_preset_applied' }))).toBe(
      1,
    );
  });

  it('keeps a college’s other custom terms and revokes', async () => {
    await TenantModel.updateOne(
      { _id: B._id },
      {
        $set: {
          'subscription.terms': { days: 120 },
          permissionOverrides: {
            grant: { STUDENT: ['circles:join', 'feed:post'] },
            revoke: { ALUMNI: ['jobs:post'] },
          },
        },
      },
    );
    clearTenantCache();
    await services.pilotPreset.apply('cost-b');
    const t = await TenantModel.findById(B._id).lean();
    expect(t?.subscription?.terms).toEqual({ days: 120, ...PILOT_PRESET.terms });
    expect(t?.permissionOverrides.revoke.ALUMNI).toEqual(
      expect.arrayContaining(['jobs:post', ...PILOT_PRESET.revoke]),
    );
    expect(t?.permissionOverrides.grant.STUDENT).toEqual(['feed:post']);
  });

  it('the command’s arguments', () => {
    expect(presetArgs(['--slug', 'knrcer'])).toEqual({ slug: 'knrcer', dryRun: false });
    expect(presetArgs(['--slug', 'knrcer', '--dry-run'])).toEqual({ slug: 'knrcer', dryRun: true });
    expect(() => presetArgs([])).toThrow(/--slug is required/);
    expect(() => presetArgs(['--slug', 'Not A Slug'])).toThrow(/subdomain/);
    expect(() => presetArgs(['--slug', 'knrcer', '--force'])).toThrow(/Unknown option/);
  });
});
