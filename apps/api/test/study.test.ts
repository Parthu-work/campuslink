import { beforeAll, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { AI_CONSENT_VERSION } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import {
  aiFetcher,
  BAD_KEY,
  FLAT_SYLLABUS,
  GOOD_KEY,
  makeSubject,
  OPENAI_KEY,
  YOUTUBE_KEY,
} from './study-fixtures.js';
import { loadEnv } from '../src/config/env.js';
import { runInTenant } from '../src/lib/context.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { AiSettingsModel } from '../src/modules/study/ai-settings.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';

const fake = aiFetcher();
const logs: string[] = [];
const ctx = testApp({
  fetcher: fake.fn,
  logger: pino(
    { level: 'trace' },
    new Writable({
      write(chunk, _enc, cb) {
        logs.push(String(chunk));
        cb();
      },
    }),
  ),
  env: loadEnv({
    NODE_ENV: 'test',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://*.localhost:5173',
    HIBP_ENABLED: 'false',
    AI_PRIVATE_ENDPOINTS: 'http://ollama.test:11434',
  }),
});
let T: TestTenant;
let admin: TestUser, faculty: TestUser, faculty2: TestUser, alum: TestUser, cse27: TestUser, ece27: TestUser;
let unverified: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);
const setProfile = (u: TestUser, branch: string, gradYear: number) =>
  runInTenant(T._id, () => ProfileModel.updateOne({ userId: u.id }, { $set: { branch, gradYear } }));
const ids = (r: { body: { data: { id: string }[] } }) => r.body.data.map((s) => s.id);

beforeAll(async () => {
  T = await makeTenant('studytest');
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  faculty2 = await makeUser(ctx, T, { roles: ['FACULTY'] });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  cse27 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  ece27 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  unverified = await makeUser(ctx, T, { roles: ['STUDENT'], verified: false });
  await setProfile(cse27, 'CSE', 2027);
  await setProfile(ece27, 'ECE', 2027);
});

describe('subjects: who reads what', () => {
  let flat: string, ece: string, common: string;
  beforeAll(async () => {
    flat = (await makeSubject(ctx, T, faculty, { name: 'Demo FLAT', code: 'CS501' })).id;
    ece = (await makeSubject(ctx, T, faculty, { name: 'Demo Signals', code: 'EC501', branches: ['ECE'] })).id;
    common = (
      await makeSubject(ctx, T, faculty2, { name: 'Demo Maths', code: 'MA101', branches: [], batches: [] })
    ).id;
  });

  it('faculty create subjects and own them; students and alumni cannot create', async () => {
    const r = await as(faculty).get(`/study/subjects/${flat}`);
    expect(r.body.data).toMatchObject({
      code: 'CS501',
      semester: 5,
      can: { manage: true, upload: true },
      mine: true,
    });
    expect(r.body.data.owners.map((o: { userId: string }) => o.userId)).toEqual([faculty.id]);
    for (const u of [cse27, alum])
      expect((await as(u).post('/study/subjects').send({ name: 'Nope', code: 'NO1' })).status).toBe(403);
    expect((await as(unverified).get('/study/subjects')).status).toBe(403);
    const dup = await as(faculty2).post('/study/subjects').send({ name: 'Again', code: 'cs501' });
    expect(dup.status).toBe(409);
  });

  it('students see only subjects for their branch and batch (or for everyone)', async () => {
    expect(ids(await as(cse27).get('/study/subjects')).sort()).toEqual([flat, common].sort());
    expect(ids(await as(ece27).get('/study/subjects')).sort()).toEqual([ece, common].sort());
    expect((await as(ece27).get(`/study/subjects/${flat}`)).status).toBe(404);
    expect((await as(ece27).get(`/study/subjects/${flat}/syllabus`)).status).toBe(404);
    // Faculty and alumni read every subject; "mine" narrows faculty to theirs.
    expect(ids(await as(alum).get('/study/subjects?scope=all'))).toEqual(
      expect.arrayContaining([flat, ece, common]),
    );
    expect(ids(await as(faculty2).get('/study/subjects?scope=mine'))).toEqual([common]);
    expect(ids(await as(cse27).get('/study/subjects?q=Signals'))).toEqual([]);
    expect(ids(await as(alum).get('/study/subjects?scope=all&q=Signals'))).toEqual([ece]);
  });

  it('owners and admins override the rule per student; others cannot', async () => {
    expect(
      (
        await as(faculty2)
          .put(`/study/subjects/${flat}/enrollments`)
          .send({ userId: ece27.id, kind: 'include' })
      ).status,
    ).toBe(403);
    expect(
      (
        await as(faculty)
          .put(`/study/subjects/${flat}/enrollments`)
          .send({ userId: alum.id, kind: 'include' })
      ).status,
    ).toBe(400);
    const inc = await as(faculty)
      .put(`/study/subjects/${flat}/enrollments`)
      .send({ userId: ece27.id, kind: 'include' });
    expect(inc.status).toBe(200);
    expect(inc.body.data).toEqual([expect.objectContaining({ kind: 'include' })]);
    expect((await as(ece27).get(`/study/subjects/${flat}`)).status).toBe(200);
    // Excluding wins over the rule, for lists and direct reads alike.
    await as(admin).put(`/study/subjects/${flat}/enrollments`).send({ userId: cse27.id, kind: 'exclude' });
    expect(ids(await as(cse27).get('/study/subjects'))).toEqual([common]);
    expect((await as(cse27).get(`/study/subjects/${flat}`)).status).toBe(404);
    await as(admin).delete(`/study/subjects/${flat}/enrollments/${cse27.id}`);
    expect((await as(cse27).get(`/study/subjects/${flat}`)).status).toBe(200);
    expect(
      await runInTenant(T._id, () =>
        AuditModel.countDocuments({ action: 'study.enrollment_changed', targetId: flat }),
      ),
    ).toBe(3);
  });

  it('archived subjects leave students’ lists; only managers see them', async () => {
    const tmp = (await makeSubject(ctx, T, faculty, { code: 'TMP1', branches: [], batches: [] })).id;
    expect((await as(faculty2).patch(`/study/subjects/${tmp}`).send({ status: 'archived' })).status).toBe(
      403,
    );
    expect((await as(faculty).patch(`/study/subjects/${tmp}`).send({ status: 'archived' })).status).toBe(200);
    expect(ids(await as(cse27).get('/study/subjects'))).not.toContain(tmp);
    expect((await as(cse27).get(`/study/subjects/${tmp}`)).status).toBe(404);
    expect(ids(await as(faculty).get('/study/subjects?status=archived&scope=all'))).toContain(tmp);
    expect((await as(cse27).get('/study/subjects?status=archived')).body.data).toEqual([]);
  });

  it('owners must be staff of this college', async () => {
    expect(
      (
        await as(faculty)
          .patch(`/study/subjects/${flat}`)
          .send({ ownerIds: [faculty.id, alum.id] })
      ).status,
    ).toBe(400);
    const r = await as(faculty)
      .patch(`/study/subjects/${flat}`)
      .send({ ownerIds: [faculty.id, faculty2.id] });
    expect(r.body.data.owners).toHaveLength(2);
    expect((await as(faculty2).get(`/study/subjects/${flat}`)).body.data.can.manage).toBe(true);
  });
});

describe('syllabus', () => {
  let subject: string;
  beforeAll(async () => {
    subject = (await makeSubject(ctx, T, faculty, { code: 'SYL1' })).id;
  });

  it('suggests a tree from pasted text, using only words from the text', async () => {
    const r = await as(faculty).post('/study/syllabus/parse').send({ text: FLAT_SYLLABUS });
    expect(r.status).toBe(200);
    const units = r.body.data.units as { title: string; topics: { title: string }[] }[];
    expect(units.map((u) => u.title)).toEqual([
      'Finite Automata',
      'Regular Expressions',
      'Context-Free Grammars',
    ]);
    expect(units[0]?.topics.map((t) => t.title)).toEqual([
      'Alphabet',
      'strings and languages',
      'DFA',
      'NFA',
      'Equivalence of NFA and DFA',
    ]);
    expect(units[1]?.topics.map((t) => t.title)).toEqual([
      'Regular expressions and regular languages',
      'Pumping lemma for regular languages',
    ]);
    expect(units[2]?.topics.map((t) => t.title)).toEqual([
      'Derivations and parse trees',
      'ambiguity (with examples)',
    ]);
    expect((await as(cse27).post('/study/syllabus/parse').send({ text: FLAT_SYLLABUS })).status).toBe(403);
  });

  it('saves, re-orders keeping ids, and deletes what is left out', async () => {
    const first = await as(faculty)
      .put(`/study/subjects/${subject}/syllabus`)
      .send({
        units: [
          {
            title: 'Finite Automata',
            topics: [{ title: 'DFA', keywords: ['dfa', 'automaton'] }, { title: 'NFA' }],
          },
          { title: 'Regular Expressions', topics: [{ title: 'Pumping lemma' }] },
        ],
      });
    expect(first.status).toBe(200);
    const [u1, u2] = first.body.data.units;
    expect(u1.topics[0]).toMatchObject({ title: 'DFA', keywords: ['dfa', 'automaton'] });
    const second = await as(faculty)
      .put(`/study/subjects/${subject}/syllabus`)
      .send({
        units: [
          {
            id: u2.id,
            title: 'Regular Expressions',
            topics: [{ id: u2.topics[0].id, title: 'Pumping lemma' }],
          },
          { id: u1.id, title: 'Automata', topics: [{ id: u1.topics[1].id, title: 'NFA' }] },
        ],
      });
    expect(second.body.data.units.map((u: { id: string }) => u.id)).toEqual([u2.id, u1.id]);
    expect(second.body.data.units[1]).toMatchObject({ title: 'Automata', topics: [{ id: u1.topics[1].id }] });
    expect((await as(cse27).get(`/study/subjects/${subject}`)).body.data).toMatchObject({
      unitCount: 2,
      topicCount: 2,
    });
  });

  it('rejects ids from another subject and edits by non-owners', async () => {
    const other = (await makeSubject(ctx, T, faculty2, { code: 'SYL2' })).id;
    const tree = await as(faculty2)
      .put(`/study/subjects/${other}/syllabus`)
      .send({ units: [{ title: 'Other', topics: [{ title: 'Other topic' }] }] });
    const foreign = tree.body.data.units[0];
    expect(
      (
        await as(faculty)
          .put(`/study/subjects/${subject}/syllabus`)
          .send({ units: [{ id: foreign.id, title: 'Stolen', topics: [] }] })
      ).status,
    ).toBe(400);
    expect(
      (
        await as(faculty2)
          .put(`/study/subjects/${subject}/syllabus`)
          .send({ units: [{ title: 'x', topics: [] }] })
      ).status,
    ).toBe(403);
    expect((await as(admin).put(`/study/subjects/${other}/syllabus`).send({ units: [] })).status).toBe(200);
  });
});

describe('contributors', () => {
  it('only admins grant, and only to alumni or certified contributors', async () => {
    const s = (await makeSubject(ctx, T, faculty, { code: 'CON1' })).id;
    expect(
      (await as(faculty).put(`/study/subjects/${s}/contributors`).send({ userId: alum.id, grant: true }))
        .status,
    ).toBe(403);
    expect(
      (await as(admin).put(`/study/subjects/${s}/contributors`).send({ userId: cse27.id, grant: true }))
        .status,
    ).toBe(400);
    const r = await as(admin).put(`/study/subjects/${s}/contributors`).send({ userId: alum.id, grant: true });
    expect(r.body.data.contributorCount).toBe(1);
    expect((await as(alum).get(`/study/subjects/${s}`)).body.data).toMatchObject({
      mine: true,
      can: { upload: true },
    });
    expect((await as(faculty).get(`/study/subjects/${s}/contributors`)).body.data).toEqual([
      expect.objectContaining({ userId: alum.id }),
    ]);
  });
});

describe('AI settings', () => {
  const aiStatus = async () => (await as(cse27).get('/study/ai-status')).body.data;
  const save = (patch: Record<string, unknown> = {}) =>
    as(admin)
      .put('/admin/ai')
      .send({
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
        chatRetentionDays: 180,
        features: {
          chatbot: true,
          studentUploads: false,
          externalVideos: false,
          ocr: true,
          transcription: true,
          facultySeeChats: false,
        },
        killSwitch: false,
        ...patch,
      });

  it('only college admins open the settings', async () => {
    for (const u of [faculty, alum, cse27]) expect((await as(u).get('/admin/ai')).status).toBe(403);
    const r = await as(admin).get('/admin/ai');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      chatProvider: null,
      consent: null,
      consentVersion: AI_CONSENT_VERSION,
      keys: { chat: { status: 'not_set', last4: null } },
      status: { answers: false, semantic: false },
    });
    expect(r.body.data.providers.find((p: { id: string }) => p.id === 'anthropic')).toMatchObject({
      embeddings: false,
      needsKey: true,
      defaultChatModel: 'claude-opus-5-5',
    });
    expect(await aiStatus()).toMatchObject({ answers: false, reason: 'chatbot_off' });
  });

  it('with no provider the assistant is "not configured"; the demo needs no key or consent', async () => {
    await save();
    expect(await aiStatus()).toMatchObject({ answers: false, semantic: false, reason: 'not_configured' });
    await save({ chatProvider: 'mock', embeddingProvider: 'mock' });
    expect(await aiStatus()).toEqual({ answers: true, semantic: true, reason: null, demo: true });
    await save({ chatProvider: 'mock', embeddingProvider: 'mock', killSwitch: true });
    expect(await aiStatus()).toMatchObject({ answers: false, semantic: false, reason: 'kill_switch' });
  });

  it('stores a key encrypted, tests it, and never returns, logs or audits it', async () => {
    await save({ chatProvider: 'anthropic' });
    const bad = await as(admin).put('/admin/ai/keys').send({ target: 'chat', key: BAD_KEY });
    expect(bad.status).toBe(200);
    expect(bad.body.data.result).toMatchObject({ ok: false });
    expect(bad.body.data.result.error).toContain('rejected the key');
    expect(bad.body.data.settings.keys.chat).toMatchObject({ status: 'invalid', last4: '6666' });
    expect(await aiStatus()).toMatchObject({ answers: false, reason: 'key_invalid' });

    const good = await as(admin).put('/admin/ai/keys').send({ target: 'chat', key: GOOD_KEY });
    expect(good.body.data.result).toEqual({
      ok: true,
      models: ['claude-opus-5-5', 'claude-haiku-5-5'],
      error: null,
    });
    expect(good.body.data.settings.keys.chat).toMatchObject({ status: 'valid', last4: '4444' });
    expect(good.body.data.settings.chatModel).toBe('claude-opus-5-5');
    // External provider: answers wait for the admin to accept the notice.
    expect(await aiStatus()).toMatchObject({ answers: false, reason: 'consent_needed' });
    expect((await as(admin).post('/admin/ai/consent').send({ version: 'old', accept: true })).status).toBe(
      400,
    );
    const c = await as(admin).post('/admin/ai/consent').send({ version: AI_CONSENT_VERSION, accept: true });
    expect(c.body.data.consent).toMatchObject({ version: AI_CONSENT_VERSION, by: { userId: admin.id } });
    expect(await aiStatus()).toEqual({ answers: true, semantic: false, reason: null, demo: false });

    // The key went to the provider in its header, and nowhere else.
    const sent = fake.calls.filter((x) => x.url.startsWith('https://api.anthropic.com/'));
    expect(sent.at(-1)?.opts.headers?.['x-api-key']).toBe(GOOD_KEY);
    const everything = JSON.stringify([
      bad.body,
      good.body,
      c.body,
      (await as(admin).get('/admin/ai')).body,
      (await as(admin).post('/admin/ai/test').send({ target: 'chat' })).body,
    ]);
    for (const k of [GOOD_KEY, BAD_KEY]) {
      expect(everything).not.toContain(k);
      expect(logs.join('\n')).not.toContain(k);
    }
    expect(everything).not.toContain('apiKeyEnc');
    await runInTenant(T._id, async () => {
      const raw = await AiSettingsModel.findOne().lean();
      expect(raw?.keys?.chat?.apiKeyEnc).toMatch(/^v2\./);
      expect(JSON.stringify(raw)).not.toContain(GOOD_KEY);
      expect(ctx.services.cipher.decrypt(String(raw?.keys?.chat?.apiKeyEnc))).toBe(GOOD_KEY);
      const audits = await AuditModel.find({ action: /^ai\./ }).lean();
      expect(audits.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          'ai.key_set',
          'ai.key_replaced',
          'ai.key_tested',
          'ai.consent_accepted',
          'ai.provider_changed',
        ]),
      );
      expect(JSON.stringify(audits)).not.toContain(GOOD_KEY);
      expect(JSON.stringify(audits)).not.toContain('4444');
    });
  });

  it('changing the provider removes the old key; only admins set keys', async () => {
    expect((await as(faculty).put('/admin/ai/keys').send({ target: 'chat', key: GOOD_KEY })).status).toBe(
      403,
    );
    const r = await save({ chatProvider: 'openai', embeddingProvider: 'openai' });
    expect(r.body.data.keys.chat).toMatchObject({ status: 'not_set', last4: null });
    expect(await aiStatus()).toMatchObject({ answers: false });
    const k = await as(admin).put('/admin/ai/keys').send({ target: 'chat', key: OPENAI_KEY });
    expect(k.body.data.result.ok).toBe(true);
    // Same provider for embeddings: the chat key serves both.
    expect(k.body.data.settings.keys.embedding).toMatchObject({ status: 'valid', last4: '8888' });
    const removed = await as(admin).delete('/admin/ai/keys/chat');
    expect(removed.body.data.keys.chat.status).toBe('not_set');
  });

  it('custom endpoints: public https only, unless the platform allowlisted the origin', async () => {
    for (const baseUrl of [
      'http://api.example.com/v1',
      'https://localhost:8080/v1',
      'https://10.0.0.5/v1',
      'https://[::1]/v1',
      'https://models.internal/v1',
    ]) {
      const r = await save({ chatProvider: 'openai_compatible', baseUrl, chatModel: 'x' });
      expect(r.status, baseUrl).toBe(400);
    }
    expect((await save({ chatProvider: 'openai_compatible', baseUrl: null })).status).toBe(400);
    const ok = await save({
      chatProvider: 'openai_compatible',
      baseUrl: 'http://ollama.test:11434/v1',
      chatModel: 'local-model',
    });
    expect(ok.status).toBe(200);
    const t = await as(admin).post('/admin/ai/test').send({ target: 'chat' });
    expect(t.body.data).toEqual({ ok: true, models: ['local-model'], error: null });
    const pub = await save({
      chatProvider: 'openai_compatible',
      baseUrl: 'https://llm.example.org/v1',
      chatModel: 'm',
    });
    expect(pub.body.data.baseUrl).toBe('https://llm.example.org/v1');
    const down = await as(admin).post('/admin/ai/test').send({ target: 'chat' });
    expect(down.body.data).toMatchObject({ ok: false, error: expect.stringContaining('Could not') });
  });

  it('the YouTube key for external suggestions is tested the same way', async () => {
    const r = await as(admin).put('/admin/ai/keys').send({ target: 'youtube', key: YOUTUBE_KEY });
    expect(r.body.data.result.ok).toBe(true);
    expect(r.body.data.settings.keys.youtube).toMatchObject({ status: 'valid', last4: '2222' });
    const bad = await as(admin)
      .put('/admin/ai/keys')
      .send({ target: 'youtube', key: 'AIzaDEMOWrongKey1234' });
    expect(JSON.stringify(bad.body)).not.toContain('AIzaDEMOWrongKey1234');
  });
});
