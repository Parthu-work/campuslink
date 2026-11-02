/**
 * Build B11: AI cost control. The answer model defaults to Haiku (D6), a college with no key of its
 * own answers on the platform's provider within its plan's allowance (lowered, never raised), usage
 * is counted by feature and key, the console estimates the platform's cost, and D7's removed switch
 * leaves old settings documents loadable.
 */
import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEEP_CHAT_MODEL, DEFAULT_CHAT_MODEL, PLANS } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { loadEnv } from '../src/config/env.js';
import { runInTenant, withPlatformScope } from '../src/lib/context.js';
import { createLogger } from '../src/lib/logger.js';
import { MIGRATIONS, runMigrations } from '../src/db/migrations.js';
import { MigrationModel } from '../src/modules/platform/migration.model.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { clearTenantCache } from '../src/modules/tenants/tenant.cache.js';
import { AiSettingsModel } from '../src/modules/study/ai-settings.model.js';
import { AiUsageModel } from '../src/modules/study/ai-usage.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { budgetLimit, type AiSettingsService } from '../src/modules/study/ai-settings.service.js';
import type { AiUsageService } from '../src/modules/study/ai-usage.service.js';

const env = (extra: Record<string, string> = {}) =>
  loadEnv({
    NODE_ENV: 'test',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://*.localhost:5173',
    HIBP_ENABLED: 'false',
    ...extra,
  });
// The platform's provider is the built-in demo (no key, no calls); prices make the estimate visible.
const ctx = testApp({
  env: env({
    AI_DEFAULT_PROVIDER: 'mock',
    AI_DEFAULT_EMBEDDING_PROVIDER: 'mock',
    AI_DEFAULT_EMBEDDING_MODEL: 'mock-embed-1',
    AI_PLATFORM_PRICE_INPUT: '1',
    AI_PLATFORM_PRICE_OUTPUT: '5',
    AI_PLATFORM_PRICE_EMBEDDING: '0.02',
  }),
});
const services = ctx.app.locals.services as { aiSettings: AiSettingsService; aiUsage: AiUsageService };
const ai = () => services.aiSettings;
const usage = () => services.aiUsage;

let P: TestTenant, T: TestTenant;
let sa: TestUser, admin: TestUser;
/** Pilot, 1,000 seats: 1,000 × 5,000 tokens a month on the platform's provider. */
const ALLOWANCE = 1000 * PLANS.pilot.aiTokensPerStudentMonthly;

const SETTINGS = {
  chatProvider: null,
  chatModel: '',
  embeddingProvider: null,
  embeddingModel: '',
  baseUrl: null,
  embeddingBaseUrl: null,
  temperature: null,
  maxAnswerTokens: 800,
  maxChunks: 6,
  monthlyTokenBudget: 0,
  dailyMessagesPerUser: 40,
  chatRetentionDays: 30,
  features: { chatbot: true, studentUploads: false, externalVideos: false, ocr: true, transcription: true },
  killSwitch: false,
};
const save = (t: TestTenant, u: TestUser, patch: Record<string, unknown> = {}) =>
  api(ctx, t.host, u.token)
    .put('/admin/ai')
    .send({ ...SETTINGS, ...patch });
const runtime = (t: TestTenant) => runInTenant(t._id, () => ai().runtime());

beforeAll(async () => {
  P = await makeTenant('aicost-platform', 'platform');
  T = await makeTenant('aicost-college');
  sa = await makeUser(ctx, P, { roles: ['SUPER_ADMIN'], mfa: true });
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  const r = await save(T, admin);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
});

describe('models (B11, D6)', () => {
  it('answers default to Haiku, deep work to Sonnet; other providers are never guessed', () => {
    expect(DEFAULT_CHAT_MODEL.anthropic).toBe('claude-haiku-5-5');
    expect(DEEP_CHAT_MODEL.anthropic).toBe('claude-sonnet-5-5');
    for (const p of ['openai', 'gemini', 'openai_compatible'] as const) {
      expect(DEFAULT_CHAT_MODEL[p]).toBe('');
      expect(DEEP_CHAT_MODEL[p]).toBe('');
    }
  });

  it('the platform default needs no model for Anthropic; other providers must name one', () => {
    expect(() =>
      env({ AI_DEFAULT_PROVIDER: 'anthropic', AI_DEFAULT_API_KEY: 'sk-ant-test-0000' }),
    ).not.toThrow();
    expect(() => env({ AI_DEFAULT_PROVIDER: 'openai', AI_DEFAULT_API_KEY: 'sk-test-00000000' })).toThrow(
      /AI_DEFAULT_CHAT_MODEL/,
    );
  });

  it('a college with no key of its own answers on the platform default, within its plan', async () => {
    const rt = await runtime(T);
    expect(rt.chat).toMatchObject({ platform: true, model: 'mock-chat-1', deepModel: 'mock-chat-1' });
    expect(rt.embedding).toMatchObject({ platform: true });
    expect(rt.status).toMatchObject({ answers: true, reason: null });
    expect(rt.budget.limit).toBe(ALLOWANCE);
    const view = (await api(ctx, T.host, admin.token).get('/admin/ai')).body.data;
    expect(view.planAllowance).toBe(ALLOWANCE);
  });
});

describe("the plan's allowance (B11)", () => {
  it('admins can lower the budget, never raise it above the allowance', async () => {
    const high = await save(T, admin, { monthlyTokenBudget: ALLOWANCE + 1 });
    expect(high.status).toBe(400);
    expect(JSON.stringify(high.body)).toContain('monthlyTokenBudget');
    expect((await save(T, admin, { monthlyTokenBudget: 1000 })).status).toBe(200);
    expect((await runtime(T)).budget.limit).toBe(1000);
    expect(budgetLimit(0, 5000)).toBe(5000);
    expect(budgetLimit(7000, 5000)).toBe(5000);
    expect(budgetLimit(7000, null)).toBe(7000);
  });

  it("platform tokens count against it; the college's own key does not", async () => {
    await runInTenant(T._id, () =>
      usage().record({
        kind: 'chat',
        model: 'mock:mock-chat-1',
        userId: null,
        inputTokens: 600,
        outputTokens: 0,
      }),
    );
    expect((await runtime(T)).budget.exhausted).toBe(false);
    await runInTenant(T._id, () =>
      usage().record({
        kind: 'chat',
        model: 'mock:mock-chat-1',
        platform: true,
        userId: null,
        inputTokens: 900,
        outputTokens: 200,
      }),
    );
    const rt = await runtime(T);
    expect(rt.budget).toMatchObject({ used: 1100, limit: 1000, exhausted: true });
    expect(rt.status.reason).toBe('budget_exhausted');
    expect(rt.chat).toBeNull();
    expect(await runInTenant(T._id, () => ai().budgetExhausted())).toBe(true);
    expect((await save(T, admin, { monthlyTokenBudget: 0 })).status).toBe(200);
    expect((await runtime(T)).budget.exhausted).toBe(false);
  });

  it('a plan without AI tokens leaves the platform provider off (not configured)', async () => {
    const N = await makeTenant('aicost-noai');
    const nAdmin = await makeUser(ctx, N, { roles: ['COLLEGE_ADMIN'], mfa: true });
    expect((await save(N, nAdmin)).status).toBe(200);
    await TenantModel.updateOne(
      { _id: N._id },
      { $set: { 'subscription.terms': { aiTokensPerStudentMonthly: 0 } } },
    );
    clearTenantCache();
    const rt = await runtime(N);
    expect(rt.chat).toBeNull();
    expect(rt.embedding).toBeNull();
    expect(rt.status).toMatchObject({ answers: false, reason: 'not_configured' });
  });

  it('with its own provider, the college sets any budget (0: none), as before', async () => {
    const O = await makeTenant('aicost-own');
    const oAdmin = await makeUser(ctx, O, { roles: ['COLLEGE_ADMIN'], mfa: true });
    const r = await save(O, oAdmin, {
      chatProvider: 'mock',
      embeddingProvider: 'mock',
      monthlyTokenBudget: 50_000_000,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rt = await runtime(O);
    expect(rt.chat).toMatchObject({ platform: false, model: 'mock-chat-1' });
    expect(rt.budget.limit).toBe(50_000_000);
    expect((await api(ctx, O.host, oAdmin.token).get('/admin/ai')).body.data.planAllowance).toBeNull();
  });
});

describe('usage by feature (B11)', () => {
  it('records the feature and whose key served it; billing and the console show them', async () => {
    const U = await makeTenant('aicost-usage');
    const uAdmin = await makeUser(ctx, U, { roles: ['COLLEGE_ADMIN'], mfa: true });
    await runInTenant(U._id, async () => {
      await usage().record({
        kind: 'chat',
        model: 'mock:mock-chat-1',
        platform: true,
        userId: null,
        inputTokens: 2_000_000,
        outputTokens: 400_000,
      });
      await usage().record({
        kind: 'embedding',
        model: 'mock:mock-embed-1',
        platform: true,
        userId: null,
        inputTokens: 1_000_000,
      });
      await usage().record({
        kind: 'chat',
        feature: 'resume',
        model: 'mock:mock-chat-1',
        userId: null,
        inputTokens: 70,
      });
    });
    const b = await runInTenant(U._id, () => usage().monthBreakdown());
    expect(b.platform).toEqual({ chatInput: 2_000_000, chatOutput: 400_000, embedding: 1_000_000 });
    expect(b.byFeature).toEqual(
      expect.arrayContaining([
        { feature: 'study_chat', platform: 2_400_000, own: 0 },
        { feature: 'embedding', platform: 1_000_000, own: 0 },
        { feature: 'resume', platform: 0, own: 70 },
      ]),
    );
    const v = (await api(ctx, U.host, uAdmin.token).get('/admin/billing')).body.data;
    expect(v.usage.aiTokens).toMatchObject({ used: 3_400_000, ownKey: 70, allowance: ALLOWANCE });
    const p = (await api(ctx, P.host, sa.token).get(`/platform/billing/${U._id}`)).body.data;
    // 2 M input at 1, 0.4 M output at 5, 1 M embedding at 0.02 (per million tokens).
    expect(p.aiCost).toEqual({
      chatInput: 2_000_000,
      chatOutput: 400_000,
      embedding: 1_000_000,
      estimate: 4.02,
      currency: 'USD',
    });
  });

  it('the platform owner edits the prices in the console; the estimate follows without a deploy (prompt 1b, R6)', async () => {
    const V = await makeTenant('aicost-prices');
    const vAdmin = await makeUser(ctx, V, { roles: ['COLLEGE_ADMIN'], mfa: true });
    await runInTenant(V._id, () =>
      usage().record({
        kind: 'chat',
        model: 'mock:mock-chat-1',
        platform: true,
        userId: null,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    );
    const asSa = () => api(ctx, P.host, sa.token);
    const estimate = async () => (await asSa().get(`/platform/billing/${V._id}`)).body.data.aiCost;
    // Env until saved: 1 M input at 1 and 1 M output at 5.
    expect(await estimate()).toMatchObject({ estimate: 6, currency: 'USD' });
    const before = (await asSa().get('/platform/ai-prices')).body.data;
    expect(before).toMatchObject({
      source: 'env',
      input: 1,
      output: 5,
      embedding: 0.02,
      currency: 'USD',
      updatedAt: null,
    });

    // Only the platform's billing permission, only on the platform host.
    const body = { input: 2, output: 10, embedding: 0.04, currency: 'INR' };
    expect((await api(ctx, P.host).get('/platform/ai-prices')).status).toBe(401);
    expect((await api(ctx, V.host, vAdmin.token).get('/platform/ai-prices')).status).toBe(404);
    expect((await api(ctx, V.host, vAdmin.token).put('/platform/ai-prices').send(body)).status).toBe(404);
    // Validation: no negative price, a currency from the list, every field present.
    for (const bad of [
      { ...body, input: -1 },
      { ...body, currency: 'JPY' },
      { input: 2, output: 10, currency: 'INR' },
      { ...body, extra: 1 },
    ])
      expect((await asSa().put('/platform/ai-prices').send(bad)).status, JSON.stringify(bad)).toBe(400);

    const saved = await asSa().put('/platform/ai-prices').send(body);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data).toMatchObject({
      ...body,
      source: 'saved',
      defaults: { input: 1, currency: 'USD' },
    });
    // 1 M input at 2 and 1 M output at 10, in rupees now.
    expect(await estimate()).toMatchObject({ estimate: 12, currency: 'INR' });
    // A price can be cleared (null): that class is then not counted.
    await asSa()
      .put('/platform/ai-prices')
      .send({ ...body, output: null })
      .expect(200);
    expect(await estimate()).toMatchObject({ estimate: 2 });
    const changes = await runInTenant(P._id, () =>
      AuditModel.find({ action: 'platform.ai_prices_changed' }).sort({ _id: 1 }).lean(),
    );
    expect(changes).toHaveLength(2);
    expect(changes[0]?.meta).toMatchObject({
      inputBefore: 1,
      inputAfter: 2,
      currencyBefore: 'USD',
      currencyAfter: 'INR',
    });
    expect(changes[1]?.meta).toMatchObject({ outputBefore: 10, outputAfter: null });
  });

  it('the migration names the feature of older counters (as the college’s own key)', async () => {
    const O = await makeTenant('aicost-legacy-usage');
    await AiUsageModel.collection.insertOne({
      tenantId: O._id,
      day: new Date().toISOString().slice(0, 10),
      userId: null,
      kind: 'rerank',
      model: 'mock:mock-chat-1',
      requests: 1,
      inputTokens: 10,
      outputTokens: 0,
    });
    await rerun('b11-ai-usage-feature');
    const row = await runInTenant(O._id, () => AiUsageModel.findOne({ kind: 'rerank' }).lean());
    expect(row).toMatchObject({ feature: 'rerank', platform: false });
  });
});

/** Runs one named migration again (each runs once per database). */
async function rerun(name: string) {
  await withPlatformScope('test:migrations', () => MigrationModel.deleteOne({ name }));
  const m = MIGRATIONS.find((x) => x.name === name);
  if (!m) throw new Error(`missing migration ${name}`);
  await runMigrations(createLogger('silent'), [m]);
}

describe('D7: faculty never read students’ study chats', () => {
  it('an old settings document with the removed switch still loads and saves', async () => {
    const O = await makeTenant('aicost-legacy-settings');
    await AiSettingsModel.collection.insertOne({
      _id: new Types.ObjectId(),
      tenantId: O._id,
      features: {
        chatbot: true,
        studentUploads: false,
        externalVideos: false,
        ocr: true,
        transcription: true,
        facultySeeChats: true,
      },
    });
    // Before the migration the document loads (an unknown stored field is not an error on read).
    const before = await runInTenant(O._id, () => AiSettingsModel.findOne());
    expect(before).not.toBeNull();
    await rerun('b11-unset-faculty-see-chats');
    const raw = await AiSettingsModel.collection.findOne({ tenantId: O._id });
    expect((raw?.features as Record<string, unknown>).facultySeeChats).toBeUndefined();
    await runInTenant(O._id, async () => {
      const doc = await AiSettingsModel.findOne();
      if (!doc) throw new Error('missing');
      doc.set('dailyMessagesPerUser', 12);
      await doc.save();
      expect((await AiSettingsModel.findOne().lean())?.dailyMessagesPerUser).toBe(12);
    });
  });
});
