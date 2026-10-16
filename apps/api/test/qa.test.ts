import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';

const ctx = testApp();
let T: TestTenant;
let student: TestUser, student2: TestUser, alum: TestUser, alum2: TestUser, mod: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);

async function ask(u: TestUser, title: string, extra: Record<string, unknown> = {}) {
  const r = await as(u)
    .post('/questions')
    .send({ title, ...extra });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body.data as { id: string; status: string };
}
async function approved(u: TestUser, title: string, extra: Record<string, unknown> = {}) {
  const q = await ask(u, title, extra);
  const d = await as(mod).post(`/admin/moderation/questions/${q.id}/decision`).send({ decision: 'approve' });
  if (d.status !== 200) throw new Error(JSON.stringify(d.body));
  return q.id;
}

beforeAll(async () => {
  T = await makeTenant('qatest');
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  student2 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  alum2 = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  mod = await makeUser(ctx, T, { roles: ['FACULTY'] });
});

describe('moderated Q&A', () => {
  it('questions wait for a moderator and only the asker sees them meanwhile', async () => {
    const q = await ask(student, 'How do I prepare for GATE CSE in one year?', {
      body: 'Final-year, <b>no</b> coaching',
      topics: ['gate'],
    });
    expect(q).toMatchObject({ status: 'pending', body: 'Final-year, no coaching' });
    expect((await as(student2).get(`/questions/${q.id}`)).status).toBe(404);
    expect((await as(student2).get('/questions')).body.data.map((x: { id: string }) => x.id)).not.toContain(
      q.id,
    );
    expect(
      (await as(student).get('/questions?mine=true')).body.data.map((x: { id: string }) => x.id),
    ).toContain(q.id);
    expect(
      (await as(alum).post(`/questions/${q.id}/answers`).send({ body: 'Start with previous papers.' }))
        .status,
    ).toBe(404);
    const pending = (await as(mod).get('/admin/moderation/questions')).body.data;
    expect(pending.map((x: { id: string }) => x.id)).toContain(q.id);
    expect((await as(mod).get('/admin/moderation/summary')).body.data.pendingQuestions).toBeGreaterThan(0);
    expect((await as(student).get('/admin/moderation/questions')).status).toBe(403);
  });

  it('approval publishes and tells the asker; rejection needs a reason the asker sees', async () => {
    const q = await ask(student, 'Which electives help for data roles?');
    expect(
      (await as(mod).post(`/admin/moderation/questions/${q.id}/decision`).send({ decision: 'approve' })).body
        .data.status,
    ).toBe('published');
    expect(
      (await as(mod).post(`/admin/moderation/questions/${q.id}/decision`).send({ decision: 'approve' }))
        .status,
    ).toBe(404);
    expect((await as(student2).get(`/questions/${q.id}`)).status).toBe(200);
    const notes = (await as(student).get('/notifications')).body.data;
    expect(
      notes.some(
        (n: { type: string; data: { questionId: string } }) =>
          n.type === 'question_approved' && n.data.questionId === q.id,
      ),
    ).toBe(true);

    const bad = await ask(student, 'Buy cheap followers here now!!');
    expect(
      (await as(mod).post(`/admin/moderation/questions/${bad.id}/decision`).send({ decision: 'reject' }))
        .status,
    ).toBe(400);
    expect(
      (
        await as(mod)
          .post(`/admin/moderation/questions/${bad.id}/decision`)
          .send({ decision: 'reject', reason: 'spam' })
      ).status,
    ).toBe(200);
    const mine = (await as(student).get(`/questions/${bad.id}`)).body.data.question;
    expect(mine).toMatchObject({ status: 'rejected', removal: { reason: 'spam' } });
    const rej = (await as(student).get('/notifications')).body.data.find(
      (n: { type: string }) => n.type === 'question_rejected',
    );
    expect(rej.data).toMatchObject({ questionId: bad.id, reason: 'spam' });
  });

  it('alumni and staff answer; students cannot', async () => {
    const id = await approved(student, 'Is a CSE minor worth it for ECE students?');
    expect(
      (await as(student2).post(`/questions/${id}/answers`).send({ body: 'I think yes, definitely.' })).status,
    ).toBe(403);
    const a = await as(alum)
      .post(`/questions/${id}/answers`)
      .send({ body: 'Yes, if you <script>x</script>like coding.' });
    expect(a.status).toBe(201);
    expect(a.body.data.body).toBe('Yes, if you like coding.');
    expect((await as(alum).post(`/questions/${id}/answers`).send({ body: 'short' })).status).toBe(400);
    const notes = (await as(student).get('/notifications')).body.data;
    const n = notes.find((x: { type: string }) => x.type === 'question_answered');
    expect(n.data).toMatchObject({ questionId: id });
    expect(JSON.stringify(n)).not.toContain('coding');
  });

  it('helpful votes, accepting the best answer and ordering', async () => {
    const id = await approved(student, 'Best resources for system design basics?');
    const a1 = (
      await as(alum).post(`/questions/${id}/answers`).send({ body: 'Read the classic papers slowly.' })
    ).body.data.id;
    const a2 = (
      await as(alum2).post(`/questions/${id}/answers`).send({ body: 'Build a small project end to end.' })
    ).body.data.id;
    await as(student2).post(`/answers/${a1}/helpful`).send({});
    await as(student2).post(`/answers/${a1}/helpful`).send({});
    expect((await as(alum).post(`/answers/${a1}/helpful`).send({})).status).toBe(400);
    let r = (await as(student2).get(`/questions/${id}`)).body.data;
    expect(r.answers[0]).toMatchObject({ id: a1, helpful: 1, votedHelpful: true });
    await as(student2).delete(`/answers/${a1}/helpful`);
    expect(
      (await as(student2).get(`/questions/${id}`)).body.data.answers.find((x: { id: string }) => x.id === a1)
        .helpful,
    ).toBe(0);
    // Only the asker accepts.
    expect((await as(student2).post(`/questions/${id}/accept`).send({ answerId: a2 })).status).toBe(404);
    r = (await as(student).post(`/questions/${id}/accept`).send({ answerId: a2 })).body.data;
    expect(r.question.acceptedAnswerId).toBe(a2);
    expect(r.answers[0]).toMatchObject({ id: a2, accepted: true });
    expect(
      (await as(alum2).get('/notifications')).body.data.some(
        (n: { type: string }) => n.type === 'answer_accepted',
      ),
    ).toBe(true);
    // Questions with answers stay; deleting the accepted answer clears acceptance.
    expect((await as(student).delete(`/questions/${id}`)).status).toBe(409);
    expect((await as(alum).delete(`/answers/${a2}`)).status).toBe(404);
    expect((await as(alum2).delete(`/answers/${a2}`)).status).toBe(200);
    r = (await as(student).get(`/questions/${id}`)).body.data;
    expect(r.question).toMatchObject({ acceptedAnswerId: null, answers: 1 });
  });

  it('filters, deletes unanswered questions and searches', async () => {
    const id = await approved(student2, 'Any tips for the TCS NQT aptitude section?', {
      topics: ['placements'],
    });
    expect(
      (await as(student).get('/questions?topic=placements')).body.data.map((x: { id: string }) => x.id),
    ).toContain(id);
    expect(
      (await as(student).get('/questions?topic=gate')).body.data.map((x: { id: string }) => x.id),
    ).not.toContain(id);
    expect(
      (await as(student).get('/questions?unanswered=true')).body.data.map((x: { id: string }) => x.id),
    ).toContain(id);
    const s = await as(student).get('/search?q=aptitude');
    expect(s.body.data.questions.map((x: { id: string }) => x.id)).toContain(id);
    expect((await as(student).delete(`/questions/${id}`)).status).toBe(409);
    expect((await as(student2).delete(`/questions/${id}`)).status).toBe(200);
    expect((await as(student).get(`/questions/${id}`)).status).toBe(404);
  });

  it('blocked askers and answerers are hidden', async () => {
    const id = await approved(student, 'Where do alumni meet up in Hyderabad?');
    await as(alum).post(`/questions/${id}/answers`).send({ body: 'There is a monthly meetup in Madhapur.' });
    await as(student2).post('/me/blocks').send({ userId: alum.id });
    expect((await as(student2).get(`/questions/${id}`)).body.data.answers).toEqual([]);
    await as(student2).post('/me/blocks').send({ userId: student.id });
    expect((await as(student2).get(`/questions/${id}`)).status).toBe(404);
    await as(student2).delete(`/me/blocks/${alum.id}`);
    await as(student2).delete(`/me/blocks/${student.id}`);
  });
});
