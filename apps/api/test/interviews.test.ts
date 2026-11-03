import { beforeAll, describe, expect, it } from 'vitest';
import {
  INTERVIEW_SESSIONS_PER_DAY,
  RUBRIC_DIMENSIONS,
  type InterviewHistoryView,
  type InterviewView,
} from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { makeMentor, SETTINGS as MENTOR_SETTINGS, slotsOf } from './mentorship-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { FileModel } from '../src/modules/files/file.model.js';
import { InterviewModel, InterviewQuestionModel } from '../src/modules/interviews/interview.model.js';
import { ProductEventModel } from '../src/modules/insights/insights.model.js';
import { answerTask } from '../src/modules/interviews/interview-tasks.js';
import { STARTER_QUESTIONS } from '../src/modules/interviews/starter-questions.js';
import type { MediaTools } from '../src/modules/study/media/tools.js';
import type { TranscriptionProvider } from '../src/modules/study/media/transcribe.js';

/** Prompt 2, G3: AI mock interviews, voice with deletion, the text fallback, the bank and the human mock. */

// A WebM header (what MediaRecorder writes), then the "speech" the fake transcriber reads back.
const WEBM = Buffer.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42,
  0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02,
]);
const MARK = '|SPEECH|';
const recording = (speech: string) => Buffer.concat([WEBM, Buffer.from(`${MARK}${speech}`)]);
const heard: Buffer[] = [];
const whisper: TranscriptionProvider = {
  id: 'whisper',
  transcribe: async (audio) => {
    heard.push(audio);
    const s = audio.toString('latin1');
    const speech = s.includes(MARK) ? s.slice(s.indexOf(MARK) + MARK.length) : '';
    return speech && speech !== 'SILENCE' ? [{ start: 0, end: 5, text: speech }] : [];
  },
};
const media: MediaTools = {
  probe: async () => ({ durationSec: 5 }),
  thumbnail: async () => null,
  audio: async (data) => data,
  pdfPages: async () => [],
};

const ctx = testApp({ whisper, media });
let T: TestTenant, U: TestTenant;
let student: TestUser,
  voicer: TestUser,
  owner2: TestUser,
  other: TestUser,
  faculty: TestUser,
  admin: TestUser,
  mentor: TestUser,
  stranger: TestUser,
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

async function start(u: TestUser, body: Record<string, unknown>) {
  const r = await as(u).post('/interviews').send(body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as InterviewView;
}
async function answer(u: TestUser, s: InterviewView, text: string) {
  const r = await as(u).post(`/interviews/${s.id}/answers`).send({ turn: s.current, text });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as InterviewView;
}
const LONG =
  'In my third year our project team missed a demo deadline. My task was the backend. I decided to split the work into daily goals, I fixed the failing database queries myself, and as a result we shipped the demo two days later and I learned to raise problems early.';

beforeAll(async () => {
  T = await makeTenant('interviews');
  U = await makeTenant('interviewsb');
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  voicer = await makeUser(ctx, T, { roles: ['STUDENT'] });
  owner2 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  other = await makeUser(ctx, T, { roles: ['STUDENT'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  stranger = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  foreign = await makeUser(ctx, U, { roles: ['STUDENT'] });
  mentor = await makeMentor(ctx, T, {
    settings: { sessionTypes: MENTOR_SETTINGS.sessionTypes.map((s) => ({ ...s, enabled: true })) },
  });
  await inT(() =>
    ProfileModel.updateOne({ userId: student.id }, { $set: { branch: 'CSE', gradYear: 2027 } }),
  );
  // Product events are recorded only with aggregate analytics consent (B9).
  await as(student).post('/me/consents').send({ purpose: 'analytics_aggregate', granted: true }).expect(200);
  // College T uses the built-in demo model; college U has no AI at all.
  const saved = await as(admin).put('/admin/ai').send(AI);
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
});

describe('practice interviews (prompt 2, G3)', () => {
  it('draws the planned questions from the bank, in the session language, starting with the introduction', async () => {
    const empty = (await as(student).get('/interviews')).body.data as InterviewHistoryView;
    expect(empty).toMatchObject({ sessions: [], trend: [], voiceAvailable: true });
    expect(empty.today).toEqual({ started: 0, limit: INTERVIEW_SESSIONS_PER_DAY });

    const hr = await start(student, { track: 'hr', language: 'te', questions: 5 });
    expect(hr.turns).toHaveLength(5);
    expect(hr.planned).toBe(5);
    expect(hr.turns[0]?.text).toBe('మీ గురించి చెప్పండి.');
    expect(hr.current).toBe(0);
    expect(new Set(hr.turns.map((t) => t.text)).size).toBe(5);

    // Technical for the member's branch (CSE): software questions or any-branch ones, never another branch's.
    const tech = await start(student, { track: 'technical', questions: 6 });
    const allowed = new Set(
      STARTER_QUESTIONS.filter(
        (q) =>
          q.id === 'hr-1' || (q.track === 'technical' && (!q.branches.length || q.branches.includes('CSE'))),
      ).map((q) => q.text.en),
    );
    for (const t of tech.turns) expect(allowed.has(t.text), t.text).toBe(true);
    expect(tech.branch).toBe('CSE');

    expect(
      await inT(() => ProductEventModel.countDocuments({ name: 'mock_started', userId: student.id })),
    ).toBe(2);
  });

  it('scores each answer on the rubric with quotes from the answer, adds a follow-up, and ends with a summary', async () => {
    const s = await start(student, { track: 'hr', questions: 5 });
    const short = await answer(student, s, 'I am a CSE student who likes building apps.');
    const first = short.turns[0];
    expect(first?.status).toBe('answered');
    expect(first?.scores).not.toBeNull();
    for (const k of RUBRIC_DIMENSIONS) {
      const v = first?.scores?.[k];
      if (k === 'correctness')
        expect(v).toBeNull(); // never on an HR question
      else expect(v).toBeGreaterThanOrEqual(1);
      const q = first?.evidence[k];
      if (q) expect('I am a CSE student who likes building apps.').toContain(q);
    }
    expect(first?.tip).toBeTruthy();
    // A short answer earns a follow-up, asked next.
    expect(short.turns[1]).toMatchObject({ kind: 'follow_up', status: 'open' });
    expect(short.current).toBe(1);
    expect(short.turns).toHaveLength(6);

    // The same turn twice: the second is refused, nothing is answered twice.
    const again = await as(student).post(`/interviews/${s.id}/answers`).send({ turn: 0, text: 'Again' });
    expect(again.status).toBe(409);

    let v = await answer(student, short, LONG);
    expect(v.turns[1]?.status).toBe('answered');
    // Skip one, answer the rest at length (no more follow-ups for long answers).
    const sk = await as(student).post(`/interviews/${s.id}/skip`).send({ turn: v.current });
    expect(sk.status).toBe(200);
    v = sk.body.data as InterviewView;
    while (v.current !== null) v = await answer(student, v, LONG);
    expect(v.status).toBe('completed');
    expect(v.summary).toMatchObject({ source: 'ai' });
    expect(v.summary?.averages.correctness).toBeNull();
    expect(v.summary?.averages.clarity).toBeGreaterThan(0);
    expect(JSON.stringify(v.summary)).not.toMatch(/\b(pass|passed|fail|failed|hired|selected)\b/i);
    expect(v.turns.find((t) => t.status === 'skipped')).toBeTruthy();

    const h = (await as(student).get('/interviews')).body.data as InterviewHistoryView;
    expect(h.trend.length).toBeGreaterThanOrEqual(1);
    expect(h.trend.at(-1)?.averages.clarity).toBe(v.summary?.averages.clarity);
    expect(
      await inT(() => ProductEventModel.countDocuments({ name: 'mock_completed', userId: student.id })),
    ).toBe(1);
  });

  it('the rubric output schema refuses scores out of range and unknown fields', () => {
    const ok = {
      scores: { clarity: 3, structure: 4, correctness: null, communication: 5 },
      evidence: { clarity: 'quote' },
      tip: 'Lead with the result.',
      followUp: null,
    };
    expect(answerTask.output.safeParse(ok).success).toBe(true);
    expect(answerTask.output.safeParse({ ...ok, scores: { ...ok.scores, clarity: 6 } }).success).toBe(false);
    expect(answerTask.output.safeParse({ ...ok, scores: { ...ok.scores, clarity: 2.5 } }).success).toBe(
      false,
    );
    expect(answerTask.output.safeParse({ ...ok, verdict: 'pass' }).success).toBe(false);
  });

  it('ending early skips what is left and summarises what was answered', async () => {
    const s = await start(other, { track: 'hr', questions: 5 });
    await answer(other, s, LONG);
    const f = await as(other).post(`/interviews/${s.id}/finish`).send({});
    expect(f.status).toBe(200);
    const v = f.body.data as InterviewView;
    expect(v.status).toBe('completed');
    expect(v.turns.filter((t) => t.status === 'skipped')).toHaveLength(4);
    expect(v.summary?.overall).toMatch(/1 question/);
  });
});

describe('voice answers (prompt 2, G3)', () => {
  it('a recording is transcribed into the answer and deleted straight after', async () => {
    const s = await start(voicer, { track: 'hr', mode: 'voice', questions: 5 });
    expect(s.mode).toBe('voice');
    const up = await as(voicer)
      .post(`/interviews/${s.id}/turns/0/audio`)
      .attach('audio', recording(LONG), { filename: 'answer.webm', contentType: 'audio/webm' });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    await ctx.queue.drain();
    const v = (await as(voicer).get(`/interviews/${s.id}`)).body.data as InterviewView;
    expect(v.turns[0]).toMatchObject({ status: 'answered', answeredBy: 'voice', answer: LONG });
    expect(v.turns[0]?.scores).not.toBeNull();
    expect(heard.length).toBe(1);
    // The recording is gone: no file record, nothing in storage, nothing kept on the turn.
    expect(await inT(() => FileModel.countDocuments({ purpose: 'interview_audio' }))).toBe(0);
    expect(ctx.storage.blobs.size).toBe(0);
    const doc = await inT(() => InterviewModel.findById(s.id).lean());
    expect(doc?.turns[0]?.audioFileId).toBeNull();
  });

  it('when transcription gives nothing, the text box takes over and the recording is still deleted', async () => {
    const s = await start(voicer, { track: 'hr', mode: 'voice', questions: 5 });
    await as(voicer)
      .post(`/interviews/${s.id}/turns/0/audio`)
      .attach('audio', recording('SILENCE'), { filename: 'a.webm', contentType: 'audio/webm' })
      .expect(200);
    await ctx.queue.drain();
    const v = (await as(voicer).get(`/interviews/${s.id}`)).body.data as InterviewView;
    expect(v.turns[0]?.status).toBe('voice_failed');
    expect(v.current).toBe(0);
    expect(await inT(() => FileModel.countDocuments({ purpose: 'interview_audio' }))).toBe(0);
    const typed = await answer(voicer, v, LONG);
    expect(typed.turns[0]).toMatchObject({ status: 'answered', answeredBy: 'text' });
    // Not audio at all: refused before anything is stored.
    const bad = await as(voicer)
      .post(`/interviews/${s.id}/turns/${typed.current}/audio`)
      .attach('audio', Buffer.from('not audio at all, just text'), {
        filename: 'a.webm',
        contentType: 'audio/webm',
      });
    expect(bad.status).toBe(415);
  });
});

describe('the question bank (prompt 2, G3)', () => {
  it('faculty add questions; AI-written ones wait for review; students never see the queue', async () => {
    expect((await as(student).get('/admin/interview-questions')).status).toBe(403);
    const add = await as(faculty).post('/admin/interview-questions').send({
      track: 'technical',
      branch: 'CSE',
      difficulty: 'easy',
      topic: 'Testing',
      text: 'What is the difference between a unit test and an integration test?',
      rubric: 'Scope of each, speed, what they catch, an example of each.',
    });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect(add.body.data).toMatchObject({
      source: 'faculty',
      status: 'approved',
      reviewedBy: { id: faculty.id },
    });

    // An AI-written question (from a drive's role) arrives pending.
    const pending = await inT(() =>
      InterviewQuestionModel.create({
        track: 'technical',
        branch: 'CSE',
        difficulty: 'medium',
        topic: 'Role skills',
        text: 'Pick one skill this role needs and explain how you have used it.',
        rubric: 'A specific skill, a concrete use, what they learned.',
        source: 'ai_generated',
        status: 'pending',
      }),
    );
    const queue = (await as(faculty).get('/admin/interview-questions')).body.data as { id: string }[];
    expect(queue.map((x) => x.id)).toEqual([String(pending._id)]);
    // Pending questions are never drawn into a session.
    for (let i = 0; i < 3; i++) {
      const s = (
        await as(other).post('/interviews').send({ track: 'technical', branch: 'CSE', questions: 8 })
      ).body.data as InterviewView | undefined;
      if (s) expect(s.turns.map((t) => t.text)).not.toContain(pending.text);
    }
    const ok = await as(faculty)
      .post(`/admin/interview-questions/${String(pending._id)}/decision`)
      .send({ decision: 'approve', text: 'Pick one skill this role needs and explain where you used it.' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      status: 'approved',
      text: 'Pick one skill this role needs and explain where you used it.',
    });
    expect(
      (
        await as(faculty)
          .post(`/admin/interview-questions/${String(pending._id)}/decision`)
          .send({ decision: 'reject' })
      ).status,
    ).toBe(409);
    expect(
      (
        await as(student)
          .post(`/admin/interview-questions/${String(pending._id)}/decision`)
          .send({ decision: 'reject' })
      ).status,
    ).toBe(403);
  });

  it('a drive interview asks AI-written role questions and puts them in the review queue', async () => {
    const tpo = await makeUser(ctx, T, { roles: ['TPO'] });
    const DAY = 86_400_000;
    const c = await as(tpo)
      .post('/admin/placements/drives')
      .send({
        companyName: 'Nimbus Labs (demo)',
        title: 'SDE trainee',
        description: 'Java backend role; Spring Boot and SQL.',
        roles: [
          {
            title: 'Software engineer',
            ctcMinLpa: 6,
            ctcMaxLpa: 8,
            location: 'Hyderabad',
            type: 'full_time',
          },
        ],
        mode: 'on_campus',
        venue: 'Block A',
        driveDate: new Date(Date.now() + 10 * DAY).toISOString(),
        registrationCloseAt: new Date(Date.now() + 5 * DAY).toISOString(),
        eligibility: { branches: ['CSE'], gradYears: [2027] },
        questions: [],
        rounds: [{ name: 'HR', kind: 'hr' }],
        resumeRequired: false,
      });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    await as(tpo)
      .post(`/admin/placements/drives/${c.body.data.id}/status`)
      .send({ status: 'open' })
      .expect(200);
    const before = await inT(() => InterviewQuestionModel.countDocuments({ status: 'pending' }));
    const fresh = await makeUser(ctx, T, { roles: ['STUDENT'] });
    await inT(() =>
      ProfileModel.updateOne({ userId: fresh.id }, { $set: { branch: 'CSE', gradYear: 2027 } }),
    );
    const s = await start(fresh, { track: 'drive', driveId: c.body.data.id, questions: 6 });
    expect(s.drive).toMatchObject({ company: 'Nimbus Labs (demo)', title: 'SDE trainee' });
    expect(s.turns.some((t) => t.text.includes('Nimbus Labs (demo)'))).toBe(true);
    expect(await inT(() => InterviewQuestionModel.countDocuments({ status: 'pending' }))).toBe(before + 2);
    expect((await as(fresh).post('/interviews').send({ track: 'drive', questions: 5 })).status).toBe(400);
  });
});

describe('the human follow-up (prompt 2, G3)', () => {
  it('a mock interview request shares a finished report with the mentor only, and is counted', async () => {
    const done = (await as(student).get('/interviews')).body.data.sessions.find(
      (x: { status: string }) => x.status === 'completed',
    ) as { id: string };
    const unfinished = (await start(student, { track: 'hr', questions: 5 })).id;
    const [slot] = await slotsOf(ctx, T, student, mentor.id, 'mock_interview');
    const send = (interviewId: string) =>
      as(student).post('/mentorship/requests').send({
        mentorId: mentor.id,
        sessionType: 'mock_interview',
        slotStart: slot,
        interviewId,
        message: 'Could we do a mock HR round? My practice report is attached.',
      });
    expect((await send(unfinished)).status).toBe(400);
    expect((await as(stranger).get(`/interviews/${done.id}`)).status).toBe(404);
    const sent = await send(done.id);
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.data.interviewId).toBe(done.id);
    const seen = await as(mentor).get(`/interviews/${done.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.data).toMatchObject({ mine: false, owner: { id: student.id } });
    // The mentor reads; they never answer or end it.
    expect((await as(mentor).post(`/interviews/${done.id}/finish`).send({})).status).toBe(404);
    expect((await as(stranger).get(`/interviews/${done.id}`)).status).toBe(404);
    expect(
      await inT(() => ProductEventModel.countDocuments({ name: 'human_mock_booked', userId: student.id })),
    ).toBe(1);
    // A résumé review cannot carry a practice report.
    const wrong = await as(student).post('/mentorship/requests').send({
      mentorId: mentor.id,
      sessionType: 'resume_review',
      slotStart: slot,
      interviewId: done.id,
      message: 'Please review my résumé for backend roles, thank you!',
    });
    expect(wrong.status).toBe(400);
  });
});

describe('isolation and privacy (prompt 2, G3)', () => {
  it('another college never reads or answers an interview; another member neither', async () => {
    const s = await start(owner2, { track: 'hr', questions: 5 });
    expect((await as(foreign).get(`/interviews/${s.id}`)).status).toBe(404);
    expect((await as(foreign).post(`/interviews/${s.id}/answers`).send({ turn: 0, text: 'x' })).status).toBe(
      404,
    );
    expect((await as(other).get(`/interviews/${s.id}`)).status).toBe(404);
    expect((await as(other).post(`/interviews/${s.id}/skip`).send({ turn: 0 })).status).toBe(404);
    const theirs = (await as(foreign).get('/interviews')).body.data as InterviewHistoryView;
    expect(theirs.sessions).toEqual([]);
  });

  it('the daily allowance is enforced', async () => {
    const busy = await makeUser(ctx, T, { roles: ['STUDENT'] });
    for (let i = 0; i < INTERVIEW_SESSIONS_PER_DAY; i++) await start(busy, { track: 'hr', questions: 5 });
    expect((await as(busy).post('/interviews').send({ track: 'hr', questions: 5 })).status).toBe(429);
  });

  it('export carries every session with answers and scores; erasure removes them', async () => {
    const exp = await as(other).get('/me/export');
    expect(exp.status).toBe(200);
    const data = JSON.parse(exp.text) as {
      interviews: { interviews: { turns: { answer: string | null }[] }[] };
    };
    expect(data.interviews.interviews.length).toBeGreaterThan(0);
    expect(data.interviews.interviews.flatMap((s) => s.turns.map((t) => t.answer))).toContain(LONG);
    const svc = ctx.app.locals.services as { interviews: { eraseFor: (id: string) => Promise<void> } };
    await inT(() => svc.interviews.eraseFor(other.id));
    expect(await inT(() => InterviewModel.countDocuments({ userId: other.id }))).toBe(0);
  });
});
