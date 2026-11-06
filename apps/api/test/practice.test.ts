import { beforeAll, describe, expect, it } from 'vitest';
import {
  PRACTICE_COMPANY_SETS_PER_DAY,
  PRACTICE_SET_SIZE,
  type PracticeHomeView,
  type PracticeItemView,
  type PracticeMasteryView,
  type PracticeSetView,
} from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { ProductEventModel } from '../src/modules/insights/insights.model.js';
import { XpEventModel } from '../src/modules/gamification/gamification.model.js';
import {
  PracticeCardModel,
  PracticeItemModel,
  PracticeSetModel,
} from '../src/modules/practice/practice.model.js';
import { StubCodeRunner } from '../src/modules/practice/code-runner.js';
import { STARTER_ITEMS } from '../src/modules/practice/starter-items.js';
import { dayKey } from '../src/modules/gamification/gamification.service.js';

/** Prompt 2, G4: the daily set, spaced repetition, answer checking, company prep, the bank and mastery. */

const ctx = testApp({ codeRunner: new StubCodeRunner() });
let T: TestTenant, U: TestTenant;
let student: TestUser,
  repeat: TestUser,
  coder: TestUser,
  other: TestUser,
  alum: TestUser,
  faculty: TestUser,
  admin: TestUser,
  foreign: TestUser;
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const inT = <R>(fn: () => Promise<R>) => runInTenant(T._id, fn);

const AI = {
  chatProvider: 'mock',
  chatModel: '',
  embeddingProvider: 'mock',
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

const MCQ = {
  kind: 'mcq',
  topic: 'ratio',
  difficulty: 'easy',
  text: 'Split ₹100 in the ratio 3 : 2. What is the larger share?',
  options: ['₹60', '₹40', '₹50'],
  answer: '0',
  explanation: 'Five parts of ₹20 each; the larger share is three parts, ₹60.',
};
const CODING = {
  kind: 'coding',
  topic: 'strings',
  difficulty: 'easy',
  companies: ['Nimbus Labs Pvt. Ltd.'],
  text: 'Read a word and print it back.',
  codeLanguage: 'python',
  explanation: 'Read the input and print it unchanged.',
  tests: [
    { stdin: 'hello', expected: 'hello' },
    { stdin: 'campus', expected: 'campus' },
  ],
};

async function startSet(u: TestUser, body: Record<string, unknown> = {}) {
  const r = await as(u).post('/practice/sets').send(body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as PracticeSetView;
}
async function answer(
  u: TestUser,
  s: PracticeSetView,
  index: number,
  given: string,
  extra: Record<string, unknown> = {},
) {
  const r = await as(u)
    .post(`/practice/sets/${s.id}/answers`)
    .send({ index, answer: given, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as PracticeSetView;
}
/** The right answer for a served item, read from the bank (tests only). */
async function rightAnswer(itemId: string) {
  const i = await inT(() => PracticeItemModel.findById(itemId).lean());
  return i?.answer ?? '';
}
async function addItem(u: TestUser, body: Record<string, unknown>) {
  const r = await as(u).post('/practice/items').send(body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as PracticeItemView;
}

beforeAll(async () => {
  T = await makeTenant('practice');
  U = await makeTenant('practiceb');
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  repeat = await makeUser(ctx, T, { roles: ['STUDENT'] });
  coder = await makeUser(ctx, T, { roles: ['STUDENT'] });
  other = await makeUser(ctx, T, { roles: ['STUDENT'] });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  foreign = await makeUser(ctx, U, { roles: ['STUDENT'] });
  await inT(() =>
    ProfileModel.updateOne({ userId: student.id }, { $set: { branch: 'CSE', gradYear: 2027 } }),
  );
  // Product events are recorded only with aggregate analytics consent (B9).
  await as(student).post('/me/consents').send({ purpose: 'analytics_aggregate', granted: true }).expect(200);
  const saved = await as(admin).put('/admin/ai').send(AI);
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
});

describe('the daily set (prompt 2, G4)', () => {
  it('copies the starter bank in once and serves ten different items, resumed on a second start', async () => {
    const home = (await as(student).get('/practice')).body.data as PracticeHomeView;
    expect(home).toMatchObject({ streak: 0, topics: [], runner: true, today: { setId: null, answered: 0 } });
    expect(await inT(() => PracticeItemModel.countDocuments({ source: 'starter' }))).toBe(
      STARTER_ITEMS.length,
    );
    // A second visit does not copy it again.
    await as(student).get('/practice').expect(200);
    expect(await inT(() => PracticeItemModel.countDocuments({ source: 'starter' }))).toBe(
      STARTER_ITEMS.length,
    );

    const s = await startSet(student);
    expect(s.kind).toBe('daily');
    expect(s.items).toHaveLength(PRACTICE_SET_SIZE);
    expect(new Set(s.items.map((i) => i.item.id)).size).toBe(PRACTICE_SET_SIZE);
    // Nothing that gives the answer away is sent while answering.
    for (const i of s.items) {
      expect(i.result).toBeNull();
      expect(i.item).not.toHaveProperty('answer');
      expect(i.item).not.toHaveProperty('explanation');
      expect(i.item).not.toHaveProperty('tests');
    }
    expect((await startSet(student)).id).toBe(s.id);
  });

  it('checks each answer, shows the right one with the explanation, and refuses a second answer', async () => {
    const s = await startSet(student);
    const first = s.items[0];
    if (!first) throw new Error('no item');
    const wrongly = await answer(student, s, 0, 'not it at all');
    const r = wrongly.items[0]?.result;
    expect(r).toMatchObject({ given: 'not it at all', correct: false });
    expect(r?.explanation.length).toBeGreaterThan(10);
    // A coding item (the shuffle may put one first) shows no single answer: its tests are hidden.
    if (first.item.kind === 'coding') expect(r?.answer).toBe('');
    else expect(r?.answer).not.toBe('');
    expect(
      (await as(student).post(`/practice/sets/${s.id}/answers`).send({ index: 0, answer: 'x' })).status,
    ).toBe(409);
    // The mistake comes back tomorrow.
    const card = await inT(() =>
      PracticeCardModel.findOne({ userId: student.id, itemId: first.item.id }).lean(),
    );
    expect(card).toMatchObject({ box: 0, lastCorrect: false, lapses: 1 });
    expect(card && card.due > dayKey(new Date())).toBe(true);
  });

  it('finishing the set completes it once, records the event and awards XP once a day', async () => {
    let s = await startSet(student);
    for (const i of s.items) {
      if (i.result) continue;
      // A starter coding item may be drawn: the stub cannot pass its tests, so it is a miss.
      s = await answer(
        student,
        s,
        i.index,
        i.item.kind === 'coding' ? 'print:nope' : await rightAnswer(i.item.id),
      );
    }
    expect(s.completedAt).not.toBeNull();
    expect(s.answered).toBe(PRACTICE_SET_SIZE);
    const coding = s.items.filter((i) => i.index !== 0 && i.item.kind === 'coding').length;
    expect(s.correct).toBe(PRACTICE_SET_SIZE - 1 - coding);
    expect(await inT(() => XpEventModel.countDocuments({ userId: student.id, kind: 'practice_set' }))).toBe(
      1,
    );
    expect(
      await inT(() =>
        ProductEventModel.countDocuments({ name: 'practice_set_completed', userId: student.id }),
      ),
    ).toBe(1);
    const home = (await as(student).get('/practice')).body.data as PracticeHomeView;
    expect(home.today).toMatchObject({ setId: s.id, completed: true, answered: PRACTICE_SET_SIZE });
    expect(home.streak).toBe(1);
    expect(home.days).toEqual([dayKey(new Date())]);
    expect(home.topics.length).toBeGreaterThan(0);
  });

  it('brings yesterday\x27s mistakes back first the next day', async () => {
    const s = await startSet(repeat);
    const missed = [s.items[0], s.items[1]].map((i) => i?.item.id ?? '');
    await answer(repeat, s, 0, '');
    await answer(repeat, s, 1, 'wrong');
    // Move to "tomorrow": yesterday's set moves back a day, and the misses are due today.
    const today = dayKey(new Date());
    await inT(() => PracticeSetModel.updateOne({ _id: s.id }, { $set: { day: '2000-01-01' } }));
    await inT(() => PracticeCardModel.updateMany({ userId: repeat.id }, { $set: { due: today } }));
    const next = await startSet(repeat);
    expect(next.id).not.toBe(s.id);
    expect(
      next.items
        .slice(0, 2)
        .map((i) => i.item.id)
        .sort(),
    ).toEqual([...missed].sort());
  });
});

describe('company prep and coding (prompt 2, G4)', () => {
  it('a faculty member tags a coding item to a company; a company set draws only from its tags', async () => {
    const item = await addItem(faculty, CODING);
    expect(item).toMatchObject({
      status: 'approved',
      source: 'faculty',
      companies: ['Nimbus Labs Pvt. Ltd.'],
    });
    const home = (await as(coder).get('/practice')).body.data as PracticeHomeView;
    expect(home.companies).toEqual([
      expect.objectContaining({ key: 'nimbus labs', name: 'Nimbus Labs Pvt. Ltd.', items: 1 }),
    ]);
    const s = await startSet(coder, { company: 'Nimbus Labs' });
    expect(s).toMatchObject({ kind: 'company', company: { key: 'nimbus labs' } });
    expect(s.items.map((i) => i.item.id)).toEqual([item.id]);
  });

  it('runs code through the runner: a failing program shows the first failing test; a passing one counts', async () => {
    const wrong = await startSet(coder, { company: 'nimbus labs' });
    const failed = await answer(coder, wrong, 0, 'print:nope', { codeLanguage: 'python' });
    expect(failed.items[0]?.result).toMatchObject({
      correct: false,
      run: { status: 'failed', passed: 0, total: 2 },
    });
    expect(failed.items[0]?.result?.run?.message).toContain('expected');

    const right = await startSet(coder, { company: 'nimbus labs' });
    const passed = await answer(coder, right, 0, 'print:{stdin}', { codeLanguage: 'java' });
    expect(passed.items[0]?.result).toMatchObject({
      correct: true,
      run: { status: 'passed', passed: 2, total: 2 },
    });
    expect(passed.completedAt).not.toBeNull();
    // Company sets earn no XP (the daily set does).
    expect(await inT(() => XpEventModel.countDocuments({ userId: coder.id, kind: 'practice_set' }))).toBe(0);

    const broken = await startSet(coder, { company: 'nimbus labs' });
    const compile = await answer(coder, broken, 0, 'syntax error here');
    expect(compile.items[0]?.result?.run?.status).toBe('compile_error');
  });

  it('company sets are capped per day', async () => {
    const made = await inT(() => PracticeSetModel.countDocuments({ userId: coder.id, kind: 'company' }));
    for (let i = made; i < PRACTICE_COMPANY_SETS_PER_DAY; i++)
      await startSet(coder, { company: 'nimbus labs' });
    expect((await as(coder).post('/practice/sets').send({ company: 'nimbus labs' })).status).toBe(429);
    expect((await as(student).post('/practice/sets').send({ company: 'nobody here' })).status).toBe(404);
  });
});

describe('the bank: authors and review (prompt 2, G4)', () => {
  it('an alumnus\x27s question waits for review and is not served until approved', async () => {
    const mine = await addItem(alum, { ...MCQ, companies: ['Orbit Systems'] });
    expect(mine).toMatchObject({ status: 'pending', source: 'alumni' });
    expect((await as(other).post('/practice/sets').send({ company: 'Orbit Systems' })).status).toBe(404);
    expect(((await as(alum).get('/practice')).body.data as PracticeHomeView).mineWaiting).toBe(1);

    const queue = (await as(faculty).get('/admin/practice/items?status=pending')).body
      .data as PracticeItemView[];
    expect(queue.map((q) => q.id)).toContain(mine.id);
    const ok = await as(faculty)
      .post(`/admin/practice/items/${mine.id}/decision`)
      .send({ decision: 'approve', edit: { ...MCQ, companies: ['Orbit Systems'], difficulty: 'medium' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({
      status: 'approved',
      difficulty: 'medium',
      reviewedBy: { id: faculty.id },
    });
    expect(
      (await as(faculty).post(`/admin/practice/items/${mine.id}/decision`).send({ decision: 'approve' }))
        .status,
    ).toBe(409);
    const s = await startSet(other, { company: 'Orbit Systems' });
    expect(s.items.map((i) => i.item.id)).toEqual([mine.id]);

    // Rejecting an approved item retires it from new sets.
    await as(faculty)
      .post(`/admin/practice/items/${mine.id}/decision`)
      .send({ decision: 'reject' })
      .expect(200);
    expect((await as(other).post('/practice/sets').send({ company: 'Orbit Systems' })).status).toBe(404);
  });

  it('a reviewer tags a starter item with a company', async () => {
    const starter = await inT(() => PracticeItemModel.findOne({ starterRef: 'pct-1' }).lean());
    if (!starter) throw new Error('no starter');
    const r = await as(faculty)
      .put(`/admin/practice/items/${String(starter._id)}`)
      .send({
        kind: 'mcq',
        topic: 'percentages',
        difficulty: 'easy',
        companies: ['Kestrel Software'],
        text: starter.text,
        options: starter.options,
        answer: starter.answer,
        explanation: starter.explanation,
      });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.companies).toEqual(['Kestrel Software']);
  });

  it('rejects malformed items: no right option, a non-number numeric answer', async () => {
    expect(
      (
        await as(faculty)
          .post('/practice/items')
          .send({ ...MCQ, answer: '7' })
      ).status,
    ).toBe(400);
    expect(
      (
        await as(faculty)
          .post('/practice/items')
          .send({ ...MCQ, kind: 'numeric', options: [], answer: 'sixty' })
      ).status,
    ).toBe(400);
  });

  it('AI drafts land in the review queue, never in sets', async () => {
    const r = await as(faculty)
      .post('/admin/practice/drafts')
      .send({ topic: 'probability', kind: 'mcq', count: 3 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ drafted: 3, reason: null });
    const drafts = await inT(() => PracticeItemModel.find({ source: 'ai_generated' }).lean());
    expect(drafts).toHaveLength(3);
    expect(drafts.every((d) => d.status === 'pending' && d.topic === 'probability')).toBe(true);
    const served = await inT(() =>
      PracticeSetModel.find({ itemIds: { $in: drafts.map((d) => d._id) } }).countDocuments(),
    );
    expect(served).toBe(0);
  });

  it('permissions: students cannot write or review; alumni cannot review; staff do not practise', async () => {
    expect((await as(student).post('/practice/items').send(MCQ)).status).toBe(403);
    expect((await as(student).get('/admin/practice/items')).status).toBe(403);
    expect((await as(alum).get('/admin/practice/items')).status).toBe(403);
    expect((await as(alum).post('/admin/practice/drafts').send({ topic: 'ratio', kind: 'mcq' })).status).toBe(
      403,
    );
    expect((await as(student).get('/admin/practice/mastery')).status).toBe(403);
    expect((await as(faculty).get('/practice')).status).toBe(403);
  });
});

describe('topic mastery by batch (prompt 2, G4)', () => {
  it('counts students per batch and topic, suppressing small groups and their accuracy', async () => {
    const batch: TestUser[] = [];
    for (let i = 0; i < 5; i++) batch.push(await makeUser(ctx, T, { roles: ['STUDENT'] }));
    const lone = await makeUser(ctx, T, { roles: ['STUDENT'] });
    for (const u of batch)
      await inT(() => ProfileModel.updateOne({ userId: u.id }, { $set: { gradYear: 2030 } }));
    await inT(() => ProfileModel.updateOne({ userId: lone.id }, { $set: { gradYear: 2031 } }));
    for (const u of [...batch, lone]) {
      const s = await startSet(u);
      for (const i of s.items.slice(0, 3)) await answer(u, s, i.index, await rightAnswer(i.item.id));
    }
    const all = (await as(faculty).get('/admin/practice/mastery')).body.data as PracticeMasteryView;
    const y2030 = all.batches.find((b) => b.gradYear === 2030);
    const y2031 = all.batches.find((b) => b.gradYear === 2031);
    expect(y2030?.students).toBe(5);
    expect(y2031?.students).toBe('<5');
    for (const b of all.batches)
      for (const t of b.topics) {
        if (t.students === '<5') expect(t.accuracy).toBeNull();
        else expect(typeof t.accuracy).toBe('number');
      }
    const only = (await as(faculty).get('/admin/practice/mastery?gradYear=2031')).body
      .data as PracticeMasteryView;
    expect(only.batches.map((b) => b.gradYear)).toEqual([2031]);
  });
});

describe('isolation and privacy (prompt 2, G4)', () => {
  it('another college or another member never reads or answers a set', async () => {
    const s = await startSet(other);
    expect((await as(foreign).get(`/practice/sets/${s.id}`)).status).toBe(404);
    expect(
      (await as(foreign).post(`/practice/sets/${s.id}/answers`).send({ index: 0, answer: '1' })).status,
    ).toBe(404);
    expect((await as(student).get(`/practice/sets/${s.id}`)).status).toBe(404);
    const theirs = (await as(foreign).get('/practice')).body.data as PracticeHomeView;
    expect(theirs.companies).toEqual([]);
    expect(theirs.today.setId).toBeNull();
    // College U's bank is its own copy of the starter set, with none of T's items.
    const items = await runInTenant(U._id, () =>
      PracticeItemModel.countDocuments({ source: { $ne: 'starter' } }),
    );
    expect(items).toBe(0);
  });

  it('export carries sets, schedule and written questions; erasure removes the member\x27s practice', async () => {
    const exp = await as(alum).get('/me/export');
    expect(exp.status).toBe(200);
    const mine = JSON.parse(exp.text) as { practice: { practiceQuestionsWritten: unknown[] } };
    expect(mine.practice.practiceQuestionsWritten.length).toBeGreaterThan(0);

    const s = await as(other).get('/me/export');
    const data = JSON.parse(s.text) as {
      practice: { practiceSets: { answers: unknown[] }[]; practiceSchedule: unknown[] };
    };
    expect(data.practice.practiceSets.length).toBeGreaterThan(0);

    const svc = ctx.app.locals.services as { practice: { eraseFor: (id: string) => Promise<void> } };
    await inT(() => svc.practice.eraseFor(other.id));
    await inT(() => svc.practice.eraseFor(alum.id));
    expect(await inT(() => PracticeSetModel.countDocuments({ userId: other.id }))).toBe(0);
    expect(await inT(() => PracticeCardModel.countDocuments({ userId: other.id }))).toBe(0);
    // The alumnus's question stays with the college, unattributed.
    expect(await inT(() => PracticeItemModel.countDocuments({ createdBy: alum.id }))).toBe(0);
    expect(await inT(() => PracticeItemModel.countDocuments({ source: 'alumni' }))).toBe(1);
  });
});
