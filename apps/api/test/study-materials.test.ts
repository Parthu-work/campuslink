import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import {
  aiFetcher,
  DEMO_VTT,
  docx,
  fakeMedia,
  fakeOcr,
  fakeTranscriber,
  makeSubject,
  pptx,
  scannedPdf,
  textPdf,
} from './study-fixtures.js';
import { fakeMp4 } from './feed-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import {
  ContentChunkModel,
  MaterialJobModel,
  MaterialModel,
  MaterialPageModel,
  VideoSegmentModel,
} from '../src/modules/study/material.model.js';
import { FileModel } from '../src/modules/files/file.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import type { MaterialPipeline } from '../src/modules/study/pipeline.js';

const media = fakeMedia();
let ocrOn = true;
const ctx = testApp({
  fetcher: aiFetcher().fn,
  media,
  ocr: { id: 'fake', available: async () => ocrOn, recognise: (img) => fakeOcr().recognise(img) },
  whisper: fakeTranscriber(),
});
const pipeline = (ctx.app.locals.services as { materialPipeline: MaterialPipeline }).materialPipeline;
let T: TestTenant;
let faculty: TestUser, faculty2: TestUser, admin: TestUser, alum: TestUser, cse: TestUser, ece: TestUser;
let subject: string, pumpingTopic: string;
const as = (u: TestUser) => api(ctx, T.host, u.token);
const inT = <R>(fn: () => Promise<R>) => runInTenant(T._id, fn);

function upload(u: TestUser, file: Buffer, name: string, fields: Record<string, string> = {}) {
  const r = as(u).post('/study/materials');
  for (const [k, v] of Object.entries({ subjectId: subject, rights: 'true', ...fields })) void r.field(k, v);
  return r.attach('file', file, name);
}
const settle = () => ctx.queue.drain();

const LECTURE = [
  [
    'Unit 2: Regular languages',
    'A regular language is accepted by some DFA.',
    'Every DFA has an equivalent NFA.',
  ],
  [
    'Pumping lemma',
    'The pumping lemma for regular languages shows a language is not regular.',
    'Demo example: a^n b^n is not regular.',
  ],
];

beforeAll(async () => {
  T = await makeTenant('studymat');
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  faculty2 = await makeUser(ctx, T, { roles: ['FACULTY'] });
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  cse = await makeUser(ctx, T, { roles: ['STUDENT'] });
  ece = await makeUser(ctx, T, { roles: ['STUDENT'] });
  await inT(() => ProfileModel.updateOne({ userId: cse.id }, { $set: { branch: 'CSE', gradYear: 2027 } }));
  await inT(() => ProfileModel.updateOne({ userId: ece.id }, { $set: { branch: 'ECE', gradYear: 2027 } }));
  subject = (await makeSubject(ctx, T, faculty, { code: 'MAT501' })).id;
  const tree = await as(faculty)
    .put(`/study/subjects/${subject}/syllabus`)
    .send({
      units: [
        {
          title: 'Regular languages',
          topics: [{ title: 'Pumping lemma', keywords: ['pumping'] }, { title: 'DFA' }],
        },
        { title: 'Grammars', topics: [{ title: 'Context-free grammars', keywords: ['parse tree'] }] },
      ],
    });
  pumpingTopic = tree.body.data.units[0].topics[0].id;
});

describe('upload and processing', () => {
  let pdfId: string;
  let lecturePdf: Buffer;

  it('a PDF is sniffed, sanitised, chunked with page numbers and tagged to topics', async () => {
    lecturePdf = await textPdf(LECTURE);
    const r = await upload(faculty, lecturePdf, 'unit-2_regular-languages.pdf');
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      type: 'pdf',
      category: 'notes',
      visibility: 'published',
      title: 'unit 2 regular languages',
    });
    pdfId = r.body.data.id;
    await settle();
    const m = (await as(cse).get(`/study/materials/${pdfId}`)).body.data;
    expect(m).toMatchObject({ stage: 'indexed', progress: 100, pageCount: 2, error: null });
    expect(m.chunkCount).toBeGreaterThan(0);
    expect(m.pages.map((p: { page: number }) => p.page)).toEqual([1, 2]);
    await inT(async () => {
      const chunks = await ContentChunkModel.find({ materialId: pdfId }).lean();
      expect(
        chunks.every((c) => c.visibility === 'published' && c.embeddingStatus === 'embedding_pending'),
      ).toBe(true);
      const pumping = chunks.find((c) => /pumping lemma/i.test(c.text));
      expect(pumping?.page).toBeGreaterThanOrEqual(1);
      expect(pumping?.topicIds.map(String)).toContain(pumpingTopic);
      // The stored PDF was rebuilt: its metadata is gone.
      const f = await FileModel.findById(
        m.id ? (await MaterialModel.findById(pdfId).lean())?.fileId : null,
      ).lean();
      expect(f?.purpose).toBe('study_material');
      const job = await MaterialJobModel.findOne({ materialId: pdfId }).lean();
      expect(job?.history.map((h: { stage: string }) => h.stage)).toEqual(
        expect.arrayContaining(['scanning', 'extracting', 'chunking', 'embedding', 'indexed']),
      );
    });
    const raw = await ctx.storage.get(
      String((await inT(() => FileModel.findOne({ purpose: 'study_material' }).lean()))?.storageKey),
    );
    expect(raw?.toString('latin1')).not.toContain('SECRET-PDF-AUTHOR');
  });

  it('finds passages by keyword for members who take the subject, and nobody else', async () => {
    const hits = (await as(cse).get('/study/search?q=pumping lemma')).body.data;
    expect(hits[0]).toMatchObject({ materialId: pdfId, subjectId: subject, type: 'pdf' });
    expect(hits[0].page).toBeGreaterThanOrEqual(1);
    expect(hits[0].snippet.toLowerCase()).toContain('pumping');
    expect((await as(ece).get('/study/search?q=pumping lemma')).body.data).toEqual([]);
    expect((await as(ece).get(`/study/materials/${pdfId}`)).status).toBe(404);
    expect((await as(ece).get(`/study/subjects/${subject}/materials`)).status).toBe(404);
    expect(
      (await as(cse).get(`/study/search?q=pumping&subjectId=${new Types.ObjectId()}`)).body.data,
    ).toEqual([]);
  });

  it('refuses duplicates, archives, missing rights and unknown topics', async () => {
    const dup = await upload(faculty2, lecturePdf, 'copy.pdf');
    expect(dup.status).toBe(409);
    expect(dup.body.error.details).toEqual({ materialId: pdfId });
    expect(
      (await upload(faculty, Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.alloc(40)]), 'notes.zip')).status,
    ).toBe(415);
    const noRights = await as(faculty)
      .post('/study/materials')
      .field('subjectId', subject)
      .attach('file', Buffer.from('Demo notes'), 'a.txt');
    expect(noRights.status).toBe(400);
    expect(
      (await upload(faculty, Buffer.from('Demo notes'), 'a.txt', { topicIds: String(new Types.ObjectId()) }))
        .status,
    ).toBe(400);
    expect((await upload(faculty, Buffer.from([0xff, 0xfe, 0x00, 0x41]), 'bad.txt')).status).toBe(415);
  });

  it('Word, PowerPoint (with speaker notes) and plain text are extracted', async () => {
    const d = await upload(
      faculty,
      docx('Demo: closure properties', [
        'Regular languages are closed under union.',
        'They are also closed under complement.',
      ]),
      'closure.docx',
    );
    const s = await upload(
      faculty,
      pptx([
        {
          lines: ['Demo slide: NFA', 'An NFA may have several next states.'],
          notes: 'Demo note: draw the subset construction.',
        },
        { lines: ['Demo slide: epsilon moves'] },
      ]),
      'nfa.pptx',
    );
    const t = await upload(
      faculty,
      Buffer.from('# Demo notes\n\nA context-free grammar has productions.\n'),
      'cfg.md',
    );
    expect([d.body.data.type, s.body.data.type, t.body.data.type]).toEqual(['doc', 'slides', 'notes']);
    expect(s.body.data.category).toBe('slides');
    await settle();
    const deck = (await as(cse).get(`/study/materials/${s.body.data.id}`)).body.data;
    expect(deck).toMatchObject({ stage: 'indexed', pageCount: 2 });
    expect(deck.pages[0].text).toContain('Demo note: draw the subset construction.');
    const doc = (await as(cse).get(`/study/materials/${d.body.data.id}`)).body.data;
    expect(doc.pages[0].text).toContain('closed under complement');
    expect((await as(cse).get('/study/search?q=productions')).body.data[0].materialId).toBe(t.body.data.id);
  });

  it('scanned pages go to OCR; without OCR the material says so and stays findable by title', async () => {
    const r = await upload(faculty, await scannedPdf(), 'scan.pdf', { title: 'Demo scanned notes' });
    await settle();
    const m = (await as(cse).get(`/study/materials/${r.body.data.id}`)).body.data;
    expect(m.pages[0].text).toContain('Turing machine');
    ocrOn = false;
    const img = await upload(
      faculty,
      await (
        await import('sharp')
      )
        .default({ create: { width: 40, height: 30, channels: 3, background: '#fff' } })
        .png()
        .toBuffer(),
      'board.png',
      { title: 'Demo whiteboard photo' },
    );
    await settle();
    ocrOn = true;
    const i = (await as(cse).get(`/study/materials/${img.body.data.id}`)).body.data;
    expect(i).toMatchObject({ type: 'image', stage: 'indexed', chunkCount: 1 });
    expect(i.error).toMatch(/OCR/);
    expect((await as(cse).get('/study/search?q=whiteboard')).body.data[0].materialId).toBe(img.body.data.id);
  });

  it('videos get a poster frame, a transcript (generated or uploaded captions) and timed chunks', async () => {
    const r = await upload(faculty, fakeMp4(90), 'lecture.mp4', { title: 'Demo lecture: grammars' });
    expect(r.body.data).toMatchObject({ type: 'video_file', category: 'videos', durationSec: 90 });
    await settle();
    const v = (await as(cse).get(`/study/materials/${r.body.data.id}`)).body.data;
    expect(v.thumbnailFileId).toBeTruthy();
    expect(v.hasTranscript).toBe(true);
    expect(v.transcript[1]).toMatchObject({ start: 30, text: 'A parse tree shows how a string is derived.' });
    // Captions replace the generated transcript.
    const c = await as(faculty)
      .post(`/study/materials/${r.body.data.id}/transcript`)
      .attach('file', Buffer.from(DEMO_VTT), 'demo.vtt');
    expect(c.status).toBe(200);
    await settle();
    const after = (await as(cse).get(`/study/materials/${r.body.data.id}`)).body.data;
    expect(after.transcript.map((s: { start: number }) => s.start)).toEqual([0, 4, 65]);
    const hit = (await as(cse).get('/study/search?q=pumping lemma regular')).body.data.find(
      (h: { materialId: string }) => h.materialId === r.body.data.id,
    );
    expect(hit?.startSec).toBe(0);
    await inT(async () => {
      const segs = await VideoSegmentModel.find({ materialId: r.body.data.id }).lean();
      expect(segs.find((s) => s.start === 65)?.topicIds.map(String)).toContain(pumpingTopic);
    });
    expect(
      (
        await as(cse)
          .post(`/study/materials/${r.body.data.id}/transcript`)
          .attach('file', Buffer.from(DEMO_VTT), 'x.vtt')
      ).status,
    ).toBe(403);
    expect(
      (
        await as(faculty)
          .post(`/study/materials/${r.body.data.id}/transcript`)
          .attach('file', Buffer.from('not captions'), 'x.vtt')
      ).status,
    ).toBe(400);
  });

  it('video links use official oEmbed and the privacy-enhanced player; nothing is downloaded', async () => {
    const r = await as(faculty)
      .post('/study/materials/link')
      .send({
        subjectId: subject,
        url: 'https://youtu.be/dQw4w9WgXcQ',
        rights: true,
        chapters: [{ at: 65, title: 'Pumping lemma' }],
      });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      type: 'video_link',
      title: 'Demo: pumping lemma, explained',
      link: {
        provider: 'youtube',
        embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
        author: 'Demo Channel',
      },
    });
    await settle();
    expect(
      (await as(cse).get('/study/search?q=pumping explained')).body.data.map(
        (h: { materialId: string }) => h.materialId,
      ),
    ).toContain(r.body.data.id);
    expect(
      (
        await as(faculty)
          .post('/study/materials/link')
          .send({ subjectId: subject, url: 'https://example.com/v', rights: true })
      ).status,
    ).toBe(400);
    expect(
      (
        await as(faculty)
          .post('/study/materials/link')
          .send({ subjectId: subject, url: 'https://www.youtube.com/watch?v=NotThereXXX', rights: true })
      ).status,
    ).toBe(400);
    const vimeo = await as(faculty)
      .post('/study/materials/link')
      .send({ subjectId: subject, url: 'https://vimeo.com/123456789', rights: true });
    expect(vimeo.body.data).toMatchObject({
      durationSec: 754,
      link: { embedUrl: 'https://player.vimeo.com/video/123456789?dnt=1' },
    });
  });
});

describe('files are served only through short-lived signed links, re-checked on every request', () => {
  it('signs, serves ranges, and stops working when access goes', async () => {
    const r = await upload(
      faculty,
      await textPdf([['Demo signed file', 'Signed links demo text.']]),
      'signed.pdf',
    );
    await settle();
    const link = (await as(cse).get(`/study/materials/${r.body.data.id}/file`)).body.data;
    expect(link.url).toMatch(/^\/api\/v1\/files\/s\/[\w-]+\.[\w-]{43}$/);
    expect(Date.parse(link.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000);
    const anon = request(ctx.app);
    const full = await anon.get(link.url).set('Host', T.host);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toBe('application/pdf');
    expect(full.headers['cache-control']).toBe('private, max-age=300');
    const part = await anon.get(link.url).set('Host', T.host).set('Range', 'bytes=0-3');
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toMatch(/^bytes 0-3\/\d+$/);
    expect(Buffer.from(part.body as Buffer).toString('latin1')).toBe('%PDF');
    // Tampered, or used on another college's address: not found.
    expect((await anon.get(`${link.url.slice(0, -2)}xx`).set('Host', T.host)).status).toBe(404);
    const other = await makeTenant('studymat2');
    expect((await anon.get(link.url).set('Host', other.host)).status).toBe(404);
    // A member who may not see the material cannot mint a link.
    expect((await as(ece).get(`/study/materials/${r.body.data.id}/file`)).status).toBe(404);
    // Taken down: the link already handed out stops working for the student.
    expect(
      (
        await as(faculty)
          .post(`/study/materials/${r.body.data.id}/takedown`)
          .send({ reason: 'Demo copyright request' })
      ).status,
    ).toBe(200);
    expect((await anon.get(link.url).set('Host', T.host)).status).toBe(404);
    expect((await as(cse).get(`/study/materials/${r.body.data.id}`)).status).toBe(404);
    expect(
      await inT(() =>
        AuditModel.countDocuments({ action: 'study.material_taken_down', targetId: r.body.data.id }),
      ),
    ).toBe(1);
  });
});

describe('review, versions and deletion', () => {
  it('contributions wait for review; owners publish; the uploader is told', async () => {
    await as(admin).put(`/study/subjects/${subject}/contributors`).send({ userId: alum.id, grant: true });
    const r = await upload(alum, Buffer.from('Demo alumni notes on Myhill-Nerode.'), 'myhill.txt');
    expect(r.body.data.visibility).toBe('in_review');
    await settle();
    expect(
      await inT(() => NotificationModel.countDocuments({ userId: faculty.id, type: 'material_review' })),
    ).toBe(1);
    expect((await as(cse).get(`/study/materials/${r.body.data.id}`)).status).toBe(404);
    expect((await as(cse).get('/study/search?q=Myhill')).body.data).toEqual([]);
    const queue = (await as(faculty).get(`/study/subjects/${subject}/materials?status=in_review`)).body.data;
    expect(queue.map((m: { id: string }) => m.id)).toEqual([r.body.data.id]);
    expect(
      (await as(cse).post(`/study/materials/${r.body.data.id}/review`).send({ action: 'publish' })).status,
    ).toBe(403);
    const pub = await as(faculty)
      .post(`/study/materials/${r.body.data.id}/review`)
      .send({ action: 'publish' });
    expect(pub.body.data.visibility).toBe('published');
    expect((await as(cse).get('/study/search?q=Myhill')).body.data[0].materialId).toBe(r.body.data.id);
    expect(
      await inT(() => NotificationModel.countDocuments({ userId: alum.id, type: 'material_reviewed' })),
    ).toBe(1);
  });

  it('students may upload only when the college allows it, and then only for review', async () => {
    expect((await upload(cse, Buffer.from('Demo student notes.'), 'mine.txt')).status).toBe(403);
    const settings = (await as(admin).get('/admin/ai')).body.data;
    await as(admin)
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
        features: { ...settings.features, studentUploads: true },
        killSwitch: false,
      });
    const r = await upload(cse, Buffer.from('Demo student notes on minimisation.'), 'mine.txt');
    expect(r.status).toBe(201);
    expect(r.body.data.visibility).toBe('in_review');
    expect((await as(ece).get(`/study/materials/${r.body.data.id}`)).status).toBe(404);
  });

  it('a new version replaces the file and re-indexes; deleting removes everything', async () => {
    const r = await upload(
      faculty,
      await textPdf([['Demo v1', 'Version one talks about Moore machines.']]),
      'v.pdf',
    );
    await settle();
    const id = r.body.data.id;
    const oldFile = (await inT(() => MaterialModel.findById(id).lean()))?.fileId;
    expect(
      (
        await as(faculty2)
          .post(`/study/materials/${id}/versions`)
          .attach('file', await textPdf([['x', 'y']]), 'v2.pdf')
      ).status,
    ).toBe(403);
    const v2 = await as(faculty)
      .post(`/study/materials/${id}/versions`)
      .attach('file', await textPdf([['Demo v2', 'Version two talks about Mealy machines.']]), 'v2.pdf');
    expect(v2.body.data.version).toBe(2);
    await settle();
    expect(await inT(() => FileModel.countDocuments({ _id: oldFile }))).toBe(0);
    expect((await as(cse).get('/study/search?q=Mealy')).body.data[0].materialId).toBe(id);
    expect((await as(cse).get('/study/search?q=Moore')).body.data).toEqual([]);
    expect(
      (
        await as(faculty)
          .post(`/study/materials/${id}/versions`)
          .attach('file', Buffer.from('Demo text'), 'v3.txt')
      ).status,
    ).toBe(400);

    expect((await as(cse).delete(`/study/materials/${id}`)).status).toBe(403);
    expect((await as(faculty).delete(`/study/materials/${id}`)).status).toBe(204);
    await inT(async () => {
      expect(await MaterialModel.countDocuments({ _id: id })).toBe(0);
      expect(await ContentChunkModel.countDocuments({ materialId: id })).toBe(0);
      expect(await MaterialPageModel.countDocuments({ materialId: id })).toBe(0);
      expect(await MaterialJobModel.countDocuments({ materialId: id })).toBe(0);
      expect(await AuditModel.countDocuments({ action: 'study.material_deleted', targetId: id })).toBe(1);
    });
  });

  it('a stale job does nothing; a failing one retries, then is dead-lettered and the uploader told', async () => {
    const r = await upload(
      faculty,
      await textPdf([['Demo fail', 'Demo text that will be lost.']]),
      'fail.pdf',
    );
    await settle();
    const id = r.body.data.id;
    await inT(async () => {
      await pipeline.run({ tenantId: String(T._id), materialId: id, version: 99 });
      const m = await MaterialModel.findById(id).lean();
      // The blob disappears: every attempt fails.
      await ctx.storage.delete(String((await FileModel.findById(m?.fileId).lean())?.storageKey));
      await MaterialJobModel.deleteMany({ materialId: id });
      for (let i = 0; i < 2; i++)
        await expect(pipeline.run({ tenantId: String(T._id), materialId: id, version: 1 })).rejects.toThrow();
      await pipeline.run({ tenantId: String(T._id), materialId: id, version: 1 });
      const after = await MaterialModel.findById(id).lean();
      expect(after).toMatchObject({ stage: 'failed', error: 'Processing failed unexpectedly' });
      expect((await MaterialJobModel.findOne({ materialId: id }).lean())?.dead).toBe(true);
      expect(await NotificationModel.countDocuments({ userId: faculty.id, type: 'material_failed' })).toBe(1);
    });
    const m = (await as(faculty).get(`/study/materials/${id}`)).body.data;
    expect(m).toMatchObject({ stage: 'failed', error: 'Processing failed unexpectedly' });
  });
});
