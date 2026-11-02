import { beforeAll, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { RESUMES_PER_MEMBER } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { makeMentor, SETTINGS, slotsOf } from './mentorship-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { AcademicRecordModel, DriveRegistrationModel } from '../src/modules/placements/placements.model.js';
import { ResumeCommentModel, ResumeModel } from '../src/modules/resumes/resume.model.js';
import { FileModel } from '../src/modules/files/file.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { addsNumbers, atsScore, extractKeywords, ruleRewrites } from '../src/modules/resumes/ats.js';
import { renderResumePdf } from '../src/modules/resumes/resume-pdf.js';
import type { ResumesService } from '../src/modules/resumes/resumes.service.js';

/** Prompt 2, G2: résumés, the PDF, the ATS check, rewrites, alumni review and drive attachment. */
const ctx = testApp();
let T: TestTenant, U: TestTenant;
let student: TestUser,
  other: TestUser,
  mentor: TestUser,
  stranger: TestUser,
  tpo: TestUser,
  faculty: TestUser;
let foreign: TestUser;
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const DAY = 86_400_000;

const FULL = {
  basics: {
    name: 'Asha Reddy',
    label: 'Final-year CSE student',
    email: 'asha@demo.example',
    phone: '+91 90000 00011',
    location: 'Hyderabad',
    summary: 'Backend-leaning student who likes data.',
    profiles: [{ network: 'GitHub', url: 'https://github.example/asha-demo' }],
  },
  education: [
    {
      institution: 'Deccan Plateau Institute of Technology',
      area: 'CSE',
      studyType: 'B.Tech',
      startDate: '2023-08',
      endDate: '2027-05',
      score: 'CGPA 8.4',
    },
  ],
  work: [
    {
      name: 'Nimbus Labs (demo)',
      position: 'Backend intern',
      startDate: '2026-05',
      endDate: '2026-07',
      highlights: ['Built a REST API serving 12 endpoints in Java', 'responsible for writing unit tests'],
    },
  ],
  projects: [
    {
      name: 'Hostel mess app',
      description: 'Menu and feedback app for 400 students.',
      url: '',
      highlights: ['Reduced queue time by 30% with pre-orders'],
    },
  ],
  skills: [{ name: 'Languages', keywords: ['Java', 'Python', 'SQL'] }],
  certificates: [{ name: 'SQL basics', issuer: 'Demo Academy', date: '2025-11' }],
  awards: [{ title: 'Hackathon runner-up', awarder: 'DPIT', date: '2025-02' }],
};

async function pdfText(buf: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out += `${c.items.map((x) => ('str' in x ? x.str : '')).join(' ')}\n`;
  }
  return out.replace(/\s+/g, ' ');
}
const pdfOf = async (u: TestUser, id: string) => {
  const r = await as(u)
    .get(`/resumes/${id}/pdf`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  return r;
};
async function createFull(u: TestUser, title = 'Core IT') {
  const r = await as(u).post('/resumes').send({ title, content: FULL });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  await ctx.queue.drain();
  return r.body.data as { id: string; version: number };
}

beforeAll(async () => {
  T = await makeTenant('resumes');
  U = await makeTenant('resumesb');
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  other = await makeUser(ctx, T, { roles: ['STUDENT'] });
  stranger = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  foreign = await makeUser(ctx, U, { roles: ['STUDENT'] });
  mentor = await makeMentor(ctx, T, {
    settings: { sessionTypes: SETTINGS.sessionTypes.map((s) => ({ ...s, enabled: true })) },
  });
});

describe('résumés (prompt 2, G2)', () => {
  it('a new résumé is prefilled from the profile and academic record', async () => {
    await runInTenant(T._id, async () => {
      await WhitelistModel.create({
        rollNumber: '23RS1A0001',
        name: 'Demo',
        branch: 'CSE',
        gradYear: 2027,
        kind: 'student',
        source: 'import',
        status: 'claimed',
        claimedBy: student.id,
        claimedAt: new Date(),
      });
      await AcademicRecordModel.create({
        rollNumber: '23RS1A0001',
        cgpa: 8.4,
        activeBacklogs: 0,
        historyBacklogs: 0,
        source: 'import',
        verifiedAt: new Date(),
      });
      await ProfileModel.updateOne(
        { userId: student.id },
        {
          $set: {
            branch: 'CSE',
            gradYear: 2027,
            skills: ['Java', 'SQL'],
            headline: 'Aspiring backend engineer',
          },
        },
      );
    });
    const r = await as(student).post('/resumes').send({ title: 'Draft' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const c = r.body.data.content;
    expect(c.basics.label).toBe('Aspiring backend engineer');
    expect(c.education[0]).toMatchObject({ area: 'CSE', endDate: '2027', score: 'CGPA 8.4' });
    expect(c.skills[0].keywords).toEqual(['Java', 'SQL']);
    // Staff do not build résumés; only my own are listed.
    expect((await as(faculty).post('/resumes').send({ title: 'x' })).status).toBe(403);
    expect((await as(other).get('/resumes')).body.data).toEqual([]);
  });

  it('the PDF is real text: every field comes back out of it, single column, within two pages', async () => {
    const r = await createFull(student);
    const res = await pdfOf(student, r.id);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const text = await pdfText(res.body as Buffer);
    for (const field of [
      'Asha Reddy',
      'asha@demo.example',
      '+91 90000 00011',
      'Hyderabad',
      'https://github.example/asha-demo',
      'Deccan Plateau Institute of Technology',
      'CGPA 8.4',
      'Backend intern, Nimbus Labs (demo)',
      'Built a REST API serving 12 endpoints in Java',
      'Hostel mess app',
      'Reduced queue time by 30% with pre-orders',
      'Languages: Java, Python, SQL',
      'SQL basics',
      'Hackathon runner-up',
      'May 2026 – Jul 2026',
    ])
      expect(text, field).toContain(field);
    const stored = await runInTenant(T._id, () => ResumeModel.findById(r.id).lean());
    expect(stored).toMatchObject({ pdfVersion: 1, pages: 1 });
    // The compact template renders too.
    const compact = await renderResumePdf(FULL, 'compact');
    expect(compact.pages).toBe(1);
  });

  it('a save from an older version is refused; a save re-renders the PDF and keeps one file', async () => {
    const r = await createFull(student, 'Analyst');
    const ok = await as(student).put(`/resumes/${r.id}`).send({ version: 1, title: 'Analyst roles' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.version).toBe(2);
    expect((await as(student).put(`/resumes/${r.id}`).send({ version: 1, title: 'Stale' })).status).toBe(409);
    await ctx.queue.drain();
    const files = await runInTenant(T._id, () =>
      FileModel.countDocuments({ ownerId: student.id, purpose: 'resume_pdf' }),
    );
    const resumes = await runInTenant(T._id, () => ResumeModel.countDocuments({ userId: student.id }));
    expect(files).toBe(resumes);
    // Validation: English only, real dates, https links.
    const bad = { ...FULL, basics: { ...FULL.basics, name: 'ఆశా' } };
    expect((await as(student).put(`/resumes/${r.id}`).send({ version: 2, content: bad })).status).toBe(400);
    expect(
      (
        await as(student)
          .put(`/resumes/${r.id}`)
          .send({ version: 2, content: { ...FULL, certificates: [{ name: 'x', date: 'May 25' }] } })
      ).status,
    ).toBe(400);
  });

  it('at most five résumés per member', async () => {
    const have = (await as(student).get('/resumes')).body.data.length;
    for (let i = have; i < RESUMES_PER_MEMBER; i++)
      await as(student)
        .post('/resumes')
        .send({ title: `R${i}`, content: FULL })
        .expect(201);
    expect((await as(student).post('/resumes').send({ title: 'One more', content: FULL })).status).toBe(409);
  });
});

describe('the ATS check (prompt 2, G2)', () => {
  it('scores parseability out of 100 without a role, and says why', async () => {
    const id = (await as(student).get('/resumes')).body.data.find(
      (r: { title: string }) => r.title === 'Core IT',
    ).id;
    const r = await as(student).post(`/resumes/${id}/ats`).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.keywords).toBeNull();
    // One weak bullet ("responsible for…") of three: still at least half strong.
    expect(r.body.data.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    expect(r.body.data.score).toBe(100);
  });

  it('against a pasted job description: keyword coverage worth 40, gaps without AI from the missing keywords', async () => {
    const id = (await as(student).get('/resumes')).body.data.find(
      (r: { title: string }) => r.title === 'Core IT',
    ).id;
    const jd =
      'We need a backend engineer with Java, Spring Boot and SQL. Experience with Docker and Spring Boot microservices is a plus. Java and SQL daily.';
    const r = await as(student).post(`/resumes/${id}/ats`).send({ jobDescription: jd });
    expect(r.status).toBe(200);
    const k = r.body.data.keywords;
    expect(k.source).toBe('pasted');
    expect(k.matched).toEqual(expect.arrayContaining(['java', 'sql']));
    expect(k.missing).toEqual(expect.arrayContaining(['spring boot', 'docker']));
    expect(r.body.data.score).toBeLessThan(100);
    expect(r.body.data.gaps[0]).toMatch(/^Show “/);
    // Pasting and picking a drive at once is refused.
    expect(
      (
        await as(student)
          .post(`/resumes/${id}/ats`)
          .send({ jobDescription: jd, driveId: '64b000000000000000000001' })
      ).status,
    ).toBe(400);
  });

  it('keyword extraction keeps tech tokens, drops filler, and prefers recurring phrases', () => {
    expect(
      extractKeywords(
        'Node.js and C++ developer; node.js experience; strong communication skills. Machine learning, machine learning!',
      ),
    ).toEqual(expect.arrayContaining(['node.js', 'c++', 'machine learning', 'communication']));
    expect(extractKeywords('the and of experience required candidate')).toEqual([]);
    expect(atsScore(FULL, 3, null).checks.find((c) => c.id === 'length')?.ok).toBe(false);
  });
});

describe('rewrites never add facts (prompt 2, G2)', () => {
  it('property: no rewrite, from rules or the demo model, introduces a number the bullet did not have', () => {
    const verbs = ['Built', 'Led', 'responsible for', 'Worked on', 'I made', 'Helped with', 'Designed'];
    const things = ['a parser', 'the hostel app', 'tests', 'a dashboard', '3 APIs', 'an 8-week course'];
    const tails = [
      '',
      ' for 120 users',
      ' in 2 weeks',
      ', cutting load time by 40%',
      ' successfully',
      ' using Java 17',
    ];
    let checked = 0;
    for (const v of verbs)
      for (const t of things)
        for (const tail of tails) {
          const bullet = `${v} ${t}${tail}.`;
          for (const alt of ruleRewrites(bullet)) {
            expect(addsNumbers(bullet, alt), `${bullet} → ${alt}`).toBe(false);
            checked++;
          }
        }
    expect(checked).toBeGreaterThan(50);
  });

  it("the filter drops a model's alternatives that invent a number, and the route returns the rest", async () => {
    expect(
      addsNumbers('Built a parser for 3 formats', 'Built a parser for 3 formats used by 500 students'),
    ).toBe(true);
    expect(addsNumbers('Cut time by 30%', 'Reduced time by 30%')).toBe(false);
    const id = (await as(student).get('/resumes')).body.data.find(
      (r: { title: string }) => r.title === 'Core IT',
    ).id;
    const r = await as(student).post(`/resumes/${id}/rewrite`).send({ section: 'work', entry: 0, bullet: 1 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ original: 'responsible for writing unit tests', source: 'rules' });
    expect(r.body.data.alternatives).toEqual(['Writing unit tests']);
    expect(r.body.data.tips).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Start with a verb/),
        expect.stringMatching(/^Add a number/),
      ]),
    );
    expect(
      (await as(student).post(`/resumes/${id}/rewrite`).send({ section: 'work', entry: 5, bullet: 0 }))
        .status,
    ).toBe(400);
  });
});

describe('alumni review (prompt 2, G2)', () => {
  it('a résumé review carries the résumé: the mentor reads and comments, the owner is told, others see nothing', async () => {
    const id = (await as(student).get('/resumes')).body.data.find(
      (r: { title: string }) => r.title === 'Core IT',
    ).id;
    // Not someone else's résumé.
    const theirs = (await as(other).post('/resumes').send({ title: 'Other', content: FULL })).body.data.id;
    const [slot] = await slotsOf(ctx, T, student, mentor.id, 'resume_review');
    const send = (resumeId: string) =>
      as(student).post('/mentorship/requests').send({
        mentorId: mentor.id,
        sessionType: 'resume_review',
        slotStart: slot,
        resumeId,
        message: 'Please review my résumé for backend roles, thank you!',
      });
    expect((await send(theirs)).status).toBe(400);
    const sent = await send(id);
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.data.resumeId).toBe(id);
    // Before: nobody but the owner. After: the mentor reads it, its PDF and comments.
    expect((await as(stranger).get(`/resumes/${id}`)).status).toBe(404);
    const seen = await as(mentor).get(`/resumes/${id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.data).toMatchObject({ mine: false, owner: { id: student.id } });
    expect((await pdfOf(mentor, id)).status).toBe(200);
    expect((await as(mentor).put(`/resumes/${id}`).send({ version: 1, title: 'Hijack' })).status).toBe(404);
    const c = await as(mentor)
      .post(`/resumes/${id}/comments`)
      .send({ section: 'work', body: 'Lead with the API numbers.' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(
      (await as(stranger).post(`/resumes/${id}/comments`).send({ section: 'work', body: 'Hi' })).status,
    ).toBe(404);
    const list = (await as(student).get(`/resumes/${id}/comments`)).body.data;
    expect(list).toEqual([
      expect.objectContaining({
        section: 'work',
        body: 'Lead with the API numbers.',
        author: { id: mentor.id, name: expect.any(String) },
      }),
    ]);
    expect(
      await runInTenant(T._id, () =>
        NotificationModel.countDocuments({ userId: student.id, type: 'resume_comment' }),
      ),
    ).toBe(1);
    // A declined review ends the mentor's access.
    await as(mentor)
      .post(`/mentorship/requests/${sent.body.data.id}/respond`)
      .send({ action: 'decline', template: 'fully_booked' })
      .expect(200);
    expect((await as(mentor).get(`/resumes/${id}`)).status).toBe(404);
  });

  it('comments are moderatable: a removed comment disappears and can be restored', async () => {
    const svc = (ctx.app.locals.services as { resumes: ResumesService }).resumes;
    const c = await runInTenant(T._id, () => ResumeCommentModel.findOne({ authorId: mentor.id }).lean());
    if (!c) throw new Error('no comment');
    const loaded = await runInTenant(T._id, () => svc.commentHandler.load(String(c._id)));
    expect(loaded).toMatchObject({
      authorId: mentor.id,
      status: 'visible',
      snapshot: 'Lead with the API numbers.',
    });
    const removal = { reason: 'spam' as const, note: '', by: c.resumeId, at: new Date() };
    expect(await runInTenant(T._id, () => svc.commentHandler.setRemoved(String(c._id), removal))).toBe(true);
    expect((await as(student).get(`/resumes/${String(c.resumeId)}/comments`)).body.data).toEqual([]);
    expect(await runInTenant(T._id, () => svc.commentHandler.setRemoved(String(c._id), null))).toBe(true);
    expect((await as(student).get(`/resumes/${String(c.resumeId)}/comments`)).body.data).toHaveLength(1);
  });
});

describe('drive registration attaches a résumé (prompt 2, G2)', () => {
  it('"attach my résumé" stores a copy of its current PDF on the registration', async () => {
    await runInTenant(T._id, () =>
      ProfileModel.updateOne({ userId: student.id }, { $set: { branch: 'CSE', gradYear: 2027 } }),
    );
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
        resumeRequired: true,
      });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    await as(tpo)
      .post(`/admin/placements/drives/${c.body.data.id}/status`)
      .send({ status: 'open' })
      .expect(200);
    const id = (await as(student).get('/resumes')).body.data.find(
      (r: { title: string }) => r.title === 'Core IT',
    ).id;
    // The ATS check can use the drive's role.
    const ats = await as(student).post(`/resumes/${id}/ats`).send({ driveId: c.body.data.id });
    expect(ats.status, JSON.stringify(ats.body)).toBe(200);
    expect(ats.body.data.keywords.source).toBe('drive');
    const reg = await as(student)
      .post(`/placements/drives/${c.body.data.id}/register`)
      .send({ resumeId: id });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const row = await runInTenant(T._id, () => DriveRegistrationModel.findOne({ userId: student.id }).lean());
    const file = await runInTenant(T._id, () => FileModel.findById(row?.resumeFileId).lean());
    expect(file).toMatchObject({ purpose: 'placement_resume', mime: 'application/pdf' });
    expect(file?.attachedAt).not.toBeNull();
    // Someone else's résumé cannot be attached.
    const theirs = (await as(other).get('/resumes')).body.data[0].id;
    expect(
      (await as(student).post(`/placements/drives/${c.body.data.id}/register`).send({ resumeId: theirs }))
        .status,
    ).toBe(404);
  });
});

describe('isolation and privacy (prompt 2, G2)', () => {
  it('another college never reads, writes, checks or deletes a résumé', async () => {
    const id = (await as(student).get('/resumes')).body.data[0].id;
    for (const [m, p, body] of [
      ['get', `/resumes/${id}`, undefined],
      ['get', `/resumes/${id}/pdf`, undefined],
      ['get', `/resumes/${id}/comments`, undefined],
      ['put', `/resumes/${id}`, { version: 1, title: 'x' }],
      ['post', `/resumes/${id}/ats`, {}],
      ['post', `/resumes/${id}/rewrite`, { section: 'work', entry: 0, bullet: 0 }],
      ['post', `/resumes/${id}/comments`, { section: 'general', body: 'hello' }],
      ['delete', `/resumes/${id}`, undefined],
    ] as const) {
      const call = (
        as(foreign) as unknown as Record<
          string,
          (path: string) => { send: (b?: unknown) => Promise<{ status: number }> }
        >
      )[m]!(p);
      expect((await call.send(body)).status, `${m} ${p}`).toBe(404);
    }
    expect((await as(foreign).get('/resumes')).body.data).toEqual([]);
    expect(await runInTenant(T._id, () => ResumeModel.exists({ _id: id }))).not.toBeNull();
  });

  it('export carries every résumé with its PDF; erasure removes résumés, their PDFs and comments', async () => {
    const exp = await as(student).get('/me/export');
    expect(exp.status).toBe(200);
    const mine = (JSON.parse(exp.text) as { resumes: { resumes: { pdfBase64: string | null }[] } }).resumes
      .resumes;
    expect(mine.length).toBeGreaterThan(0);
    expect(
      Buffer.from(mine.find((r) => r.pdfBase64)?.pdfBase64 ?? '', 'base64')
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
    expect((ctx.app.locals.services as { privacy: { modules: string[] } }).privacy.modules).toContain(
      'resumes',
    );
    const services = ctx.app.locals.services as { resumes: ResumesService };
    await runInTenant(T._id, () => services.resumes.eraseFor(student.id));
    await runInTenant(T._id, async () => {
      expect(await ResumeModel.countDocuments({ userId: student.id })).toBe(0);
      expect(await FileModel.countDocuments({ ownerId: student.id, purpose: 'resume_pdf' })).toBe(0);
    });
    await runInTenant(T._id, () => services.resumes.eraseFor(mentor.id));
    expect(await runInTenant(T._id, () => ResumeCommentModel.countDocuments({ authorId: mentor.id }))).toBe(
      0,
    );
  });
});
