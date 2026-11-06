import { beforeAll, describe, expect, it } from 'vitest';
import type { AnswerView, QuestionView } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { FileModel } from '../src/modules/files/file.model.js';
import { AnswerModel, QuestionModel } from '../src/modules/qa/question.model.js';
import { ProductEventModel } from '../src/modules/insights/insights.model.js';
import type { MediaTools } from '../src/modules/study/media/tools.js';
import type { TranscriptionProvider } from '../src/modules/study/media/transcribe.js';

/** Prompt 2, G7: voice Q&A, transcribed (E3), the transcript published and editable, audio kept only on request. */

// A WebM header, then the "speech" the fake transcriber reads back and the length the fake probe reports.
const WEBM = Buffer.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42,
  0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02,
]);
const MARK = '|SPEECH|';
const recording = (speech: string, seconds = 20) =>
  Buffer.concat([WEBM, Buffer.from(`${MARK}${speech}${MARK}${seconds}`)]);
const parts = (b: Buffer) => b.toString('latin1').split(MARK);
const whisper: TranscriptionProvider = {
  id: 'whisper',
  transcribe: async (audio) => {
    const speech = parts(audio)[1] ?? '';
    return speech && speech !== 'SILENCE' ? [{ start: 0, end: 5, text: speech }] : [];
  },
};
const media: MediaTools = {
  probe: async (data) => ({ durationSec: Number(parts(data)[2] ?? 0) || null }),
  thumbnail: async () => null,
  audio: async (data) => data,
  pdfPages: async () => [],
};

const ctx = testApp({ whisper, media });
let T: TestTenant, U: TestTenant;
let asker: TestUser, alum: TestUser, reader: TestUser, foreign: TestUser;
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const inT = <R>(fn: () => Promise<R>) => runInTenant(T._id, fn);

async function voiceQuestion(u: TestUser, speech: string, keep = false, seconds = 20) {
  const r = await as(u)
    .post(`/questions/voice?keepAudio=${keep}`)
    .attach('audio', recording(speech, seconds), { filename: 'q.webm', contentType: 'audio/webm' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  await ctx.queue.drain();
  return r.body.data as QuestionView;
}

beforeAll(async () => {
  T = await makeTenant('voiceqa');
  U = await makeTenant('voiceqab');
  asker = await makeUser(ctx, T, { roles: ['STUDENT'] });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  reader = await makeUser(ctx, T, { roles: ['STUDENT'] });
  foreign = await makeUser(ctx, U, { roles: ['STUDENT'] });
  await as(asker).post('/me/consents').send({ purpose: 'analytics_aggregate', granted: true }).expect(200);
});

describe('voice questions (prompt 2, G7)', () => {
  it('is transcribed in the worker: the transcript becomes the question, moderated as usual, and the audio is deleted', async () => {
    const q = await voiceQuestion(
      asker,
      'How should I prepare for the aptitude round? I have three weeks left.',
    );
    expect(q.voice?.state).toBe('transcribing');
    const doc = await inT(() => QuestionModel.findById(q.id).lean());
    expect(doc).toMatchObject({
      title: 'How should I prepare for the aptitude round?',
      body: 'I have three weeks left.',
      status: 'pending',
    });
    expect(doc?.voice).toMatchObject({ state: 'ready', audioFileId: null, durationSec: 20 });
    expect(await inT(() => FileModel.countDocuments({ purpose: 'qa_audio', ownerId: asker.id }))).toBe(0);
    expect(
      await inT(() => ProductEventModel.countDocuments({ name: 'voice_question', userId: asker.id })),
    ).toBe(1);
  });

  it('keeps the recording when the author asks, for readers who may see the question', async () => {
    const q = await voiceQuestion(asker, 'Which companies visited last year for data roles?', true);
    await inT(() => QuestionModel.updateOne({ _id: q.id }, { $set: { status: 'published' } }));
    const seen = (await as(reader).get(`/questions/${q.id}`)).body.data as { question: QuestionView };
    const fileId = seen.question.voice?.audioFileId;
    expect(fileId).toBeTruthy();
    expect(await inT(() => FileModel.findById(fileId).lean())).toMatchObject({
      deleteAfter: null,
      durationSec: 20,
    });
  });

  it('nothing heard, or longer than a minute, hands it back to type; the edit sends it to moderation', async () => {
    const silent = await voiceQuestion(asker, 'SILENCE');
    expect(await inT(() => QuestionModel.findById(silent.id).lean())).toMatchObject({
      status: 'voice_failed',
      voice: { state: 'voice_failed', audioFileId: null },
    });
    const long = await voiceQuestion(
      asker,
      'A question that went on and on for far too long to be useful.',
      false,
      95,
    );
    expect((await inT(() => QuestionModel.findById(long.id).lean()))?.status).toBe('voice_failed');
    // Others never see a failed or transcribing question.
    expect((await as(reader).get(`/questions/${silent.id}`)).status).toBe(404);
    const fixed = await as(asker)
      .put(`/questions/${silent.id}/transcript`)
      .send({ title: 'What is the cut-off for the Nimbus drive?', body: '' });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect((await inT(() => QuestionModel.findById(silent.id).lean()))?.status).toBe('pending');
    // Only the author edits, and only voice questions.
    expect(
      (
        await as(reader)
          .put(`/questions/${silent.id}/transcript`)
          .send({ title: 'Something else entirely', body: '' })
      ).status,
    ).toBe(404);
  });
});

describe('voice answers (prompt 2, G7)', () => {
  let question: QuestionView;
  beforeAll(async () => {
    const r = await as(asker).post('/questions').send({ title: 'How do I get a referral at Nimbus Labs?' });
    question = r.body.data as QuestionView;
    await inT(() => QuestionModel.updateOne({ _id: question.id }, { $set: { status: 'published' } }));
  });

  it('is published when the transcript is ready, counted on the question, with a play button when kept', async () => {
    const r = await as(alum)
      .post(`/questions/${question.id}/answers/voice?keepAudio=true`)
      .attach('audio', recording('Ask an alumnus there with a short note and your CV link.'), {
        filename: 'a.webm',
        contentType: 'audio/webm',
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((r.body.data as AnswerView).voice?.state).toBe('transcribing');
    await ctx.queue.drain();
    const page = (await as(reader).get(`/questions/${question.id}`)).body.data as {
      question: QuestionView;
      answers: AnswerView[];
    };
    expect(page.question.answers).toBe(1);
    const a = page.answers[0];
    expect(a?.body).toBe('Ask an alumnus there with a short note and your CV link.');
    expect(a?.voice?.audioFileId).toBeTruthy();
    // The author corrects a word of the transcript.
    const fixed = await as(alum)
      .put(`/answers/${a?.id ?? ''}/transcript`)
      .send({ body: 'Ask an alumnus there with a short note and your resume link.' });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect((await inT(() => AnswerModel.findById(a?.id).lean()))?.body).toContain('resume link');
  });

  it('students cannot answer by voice (answering is for alumni and staff); another college sees nothing', async () => {
    const r = await as(reader)
      .post(`/questions/${question.id}/answers/voice`)
      .attach('audio', recording('I think you should just apply.'), {
        filename: 'a.webm',
        contentType: 'audio/webm',
      });
    expect(r.status).toBe(403);
    expect((await as(foreign).get(`/questions/${question.id}`)).status).toBe(404);
  });
});

describe('privacy (prompt 2, G7)', () => {
  it('erasure removes the member\x27s kept recordings with their questions', async () => {
    const svc = ctx.app.locals.services as { qa: { eraseFor: (id: string) => Promise<void> } };
    await inT(() => svc.qa.eraseFor(asker.id));
    expect(await inT(() => FileModel.countDocuments({ purpose: 'qa_audio', ownerId: asker.id }))).toBe(0);
    expect(await inT(() => QuestionModel.countDocuments({ authorId: asker.id }))).toBe(0);
  });
});
