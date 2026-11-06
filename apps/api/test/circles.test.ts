import { beforeAll, describe, expect, it } from 'vitest';
import {
  STUDY_GROUP_MAX,
  type CircleView,
  type EventView,
  type PostView,
  type QuestionView,
  type StudyGroupView,
} from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { makeSubject } from './study-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { QuestionModel } from '../src/modules/qa/question.model.js';
import { ProductEventModel } from '../src/modules/insights/insights.model.js';
import { ChatMessageModel } from '../src/modules/study/chat.model.js';
import { CircleMemberModel, StudyGroupModel } from '../src/modules/circles/circle.model.js';

/** Prompt 2, G7: circles (posts, questions and events for members only) and study groups. */

const ctx = testApp();
let T: TestTenant, U: TestTenant;
let member: TestUser,
  outsider: TestUser,
  other2027: TestUser,
  faculty: TestUser,
  admin: TestUser,
  foreign: TestUser;
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const inT = <R>(fn: () => Promise<R>) => runInTenant(T._id, fn);
const setCohort = (u: TestUser, f: Record<string, unknown>) =>
  inT(() => ProfileModel.updateOne({ userId: u.id }, { $set: f }));

beforeAll(async () => {
  // Students post in circles where the college allows student posting (its moderation choice).
  T = await makeTenant('circles', 'college', { studentPosting: true });
  U = await makeTenant('circlesb');
  member = await makeUser(ctx, T, { roles: ['STUDENT'] });
  outsider = await makeUser(ctx, T, { roles: ['STUDENT'] });
  other2027 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  foreign = await makeUser(ctx, U, { roles: ['STUDENT'] });
  await setCohort(member, { branch: 'CSE', gradYear: 2027 });
  await setCohort(other2027, { branch: 'ECE', gradYear: 2027 });
  await setCohort(outsider, { branch: 'CSE', gradYear: 2028 });
  await as(member).post('/me/consents').send({ purpose: 'analytics_aggregate', granted: true }).expect(200);
});

async function circle(u: TestUser, body: Record<string, unknown>) {
  const r = await as(u).post('/circles').send(body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as CircleView;
}

describe('circles (prompt 2, G7)', () => {
  let batch: CircleView;
  let club: CircleView;

  it('staff create active circles; a student\x27s proposal waits for approval', async () => {
    batch = await circle(faculty, { name: 'Class of 2027', kind: 'batch', gradYear: 2027 });
    expect(batch).toMatchObject({ status: 'active', members: 1, joined: true, manage: true });
    club = await circle(member, {
      name: 'Robotics club',
      kind: 'club',
      description: 'Build and race robots.',
    });
    expect(club.status).toBe('pending');
    // Not discoverable or joinable before approval.
    expect((await as(outsider).post(`/circles/${club.id}/join`)).status).toBe(404);
    const pending = (await as(faculty).get('/circles?scope=pending')).body.data as CircleView[];
    expect(pending.map((c) => c.id)).toContain(club.id);
    const ok = await as(faculty).post(`/admin/circles/${club.id}/decision`).send({ decision: 'approve' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'active', members: 1 });
    expect(
      (await as(faculty).post(`/admin/circles/${club.id}/decision`).send({ decision: 'approve' })).status,
    ).toBe(409);
    expect(
      (await as(member).post(`/admin/circles/${club.id}/decision`).send({ decision: 'archive' })).status,
    ).toBe(403);
  });

  it('a batch circle is for its batch: its students discover and join it, others cannot', async () => {
    const discover = (await as(other2027).get('/circles?scope=discover')).body.data as CircleView[];
    expect(discover.map((c) => c.id)).toEqual(expect.arrayContaining([batch.id, club.id]));
    expect(
      ((await as(outsider).get('/circles?scope=discover')).body.data as CircleView[]).map((c) => c.id),
    ).not.toContain(batch.id);
    expect((await as(outsider).post(`/circles/${batch.id}/join`)).status).toBe(400);
    const joined = await as(member).post(`/circles/${batch.id}/join`);
    expect(joined.body.data).toMatchObject({ joined: true, members: 2 });
    await as(member).post(`/circles/${batch.id}/join`).expect(200); // twice is still one membership
    expect(await inT(() => CircleMemberModel.countDocuments({ circleId: batch.id }))).toBe(2);
    expect(
      await inT(() => ProductEventModel.countDocuments({ name: 'circle_joined', userId: member.id })),
    ).toBe(1);
  });

  it('a circle post is seen by members only: in the feed, in lists and by id', async () => {
    const r = await as(member)
      .post('/posts')
      .send({ kind: 'text', body: 'Batch study plan for the mid-terms', circleId: batch.id });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const post = r.body.data as PostView;
    expect(post.circle).toEqual({ id: batch.id, name: 'Class of 2027' });
    // Members see it in the circle and in their feed.
    const inCircle = (await as(faculty).get(`/posts?circle=${batch.id}`)).body.data as PostView[];
    expect(inCircle.map((p) => p.id)).toContain(post.id);
    // Others never: not by id, not in the circle's list, not in the main lists.
    expect((await as(outsider).get(`/posts/${post.id}`)).status).toBe(404);
    expect((await as(outsider).get(`/posts?circle=${batch.id}`)).status).toBe(404);
    const theirs = (await as(outsider).get(`/posts?author=${member.id}`)).body.data as PostView[];
    expect(theirs.map((p) => p.id)).not.toContain(post.id);
    const feed = (await as(outsider).get('/feed')).body.data as { items?: PostView[] } | PostView[];
    const items = Array.isArray(feed) ? feed : (feed.items ?? []);
    expect(items.map((p) => p.id)).not.toContain(post.id);
    expect((await as(foreign).get(`/posts/${post.id}`)).status).toBe(404);
    // Only members post in a circle; announcements are for the whole college.
    expect(
      (await as(outsider).post('/posts').send({ kind: 'text', body: 'Can I post here?', circleId: batch.id }))
        .status,
    ).toBe(404);
    expect(
      (
        await as(faculty)
          .post('/posts')
          .send({ kind: 'text', body: 'Official notice', circleId: batch.id, announcement: true })
      ).status,
    ).toBe(400);
  });

  it('a circle\x27s questions and events are for members only too', async () => {
    const q = await as(member)
      .post('/questions')
      .send({ title: 'Who has notes for the automata unit?', circleId: batch.id });
    expect(q.status, JSON.stringify(q.body)).toBe(201);
    const question = q.body.data as QuestionView;
    await inT(() => QuestionModel.updateOne({ _id: question.id }, { $set: { status: 'published' } }));
    const list = (await as(other2027).get(`/questions?circle=${batch.id}`)).status;
    expect(list).toBe(404); // not a member yet
    await as(other2027).post(`/circles/${batch.id}/join`).expect(200);
    const mine = (await as(other2027).get(`/questions?circle=${batch.id}`)).body.data as QuestionView[];
    expect(mine.map((x) => x.id)).toContain(question.id);
    expect((await as(outsider).get(`/questions/${question.id}`)).status).toBe(404);
    const general = (await as(outsider).get('/questions')).body.data as QuestionView[];
    expect(general.map((x) => x.id)).not.toContain(question.id);

    const start = new Date(Date.now() + 3 * 86_400_000);
    const ev = await as(faculty)
      .post('/events')
      .send({
        title: 'Batch meetup',
        description: 'A meetup for the class of 2027 before the placement season.',
        kind: 'meetup',
        mode: 'online',
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 3600_000).toISOString(),
        onlineUrl: 'https://meet.example.com/batch',
        circleId: batch.id,
      });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    const event = ev.body.data as EventView;
    expect(event.circle?.id).toBe(batch.id);
    expect((await as(outsider).get(`/events/${event.id}`)).status).toBe(404);
    const upcoming = (await as(outsider).get('/events')).body.data as EventView[];
    expect(upcoming.map((e) => e.id)).not.toContain(event.id);
    expect(((await as(member).get('/events')).body.data as EventView[]).map((e) => e.id)).toContain(event.id);
  });

  it('leaving a circle hides its content again', async () => {
    await as(other2027).post(`/circles/${batch.id}/leave`).expect(200);
    expect((await as(other2027).get(`/questions?circle=${batch.id}`)).status).toBe(404);
  });

  it('another college never sees a circle', async () => {
    expect((await as(foreign).get(`/circles/${batch.id}`)).status).toBe(404);
    expect((await as(foreign).post(`/circles/${batch.id}/join`)).status).toBe(404);
  });
});

describe('study groups (prompt 2, G7)', () => {
  let subjectId: string;
  let group: StudyGroupView;
  const joiners: TestUser[] = [];
  beforeAll(async () => {
    subjectId = (await makeSubject(ctx, T, admin, { branches: [], batches: [] })).id;
    for (let i = 0; i < STUDY_GROUP_MAX; i++) joiners.push(await makeUser(ctx, T, { roles: ['STUDENT'] }));
    for (const j of joiners.slice(0, 2))
      await as(j).post('/me/consents').send({ purpose: 'analytics_aggregate', granted: true }).expect(200);
  });

  it('forms when the third member joins and never grows past six', async () => {
    const r = await as(member).post('/study-groups').send({ subjectId, name: 'Automata revision' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    group = r.body.data as StudyGroupView;
    expect(group).toMatchObject({
      formed: false,
      joined: true,
      members: [expect.objectContaining({ id: member.id })],
    });
    await as(joiners[0] as TestUser)
      .post(`/study-groups/${group.id}/join`)
      .expect(200);
    const third = (await as(joiners[1] as TestUser).post(`/study-groups/${group.id}/join`)).body
      .data as StudyGroupView;
    expect(third.formed).toBe(true);
    expect(
      await inT(() => ProductEventModel.countDocuments({ name: 'study_group_formed' })),
    ).toBeGreaterThanOrEqual(1);
    for (const j of joiners.slice(2, 5)) await as(j).post(`/study-groups/${group.id}/join`).expect(200);
    expect((await as(joiners[5] as TestUser).post(`/study-groups/${group.id}/join`)).status).toBe(409);
    const doc = await inT(() => StudyGroupModel.findById(group.id).lean());
    expect(doc?.memberIds).toHaveLength(STUDY_GROUP_MAX);
  });

  it('members share questions and a slot; outsiders see the group but not its list', async () => {
    await as(member)
      .post(`/study-groups/${group.id}/questions`)
      .send({ text: 'Prove the pumping lemma for regular languages' })
      .expect(200);
    const slot = new Date(Date.now() + 86_400_000).toISOString();
    const v = (
      await as(member)
        .put(`/study-groups/${group.id}/slot`)
        .send({ slot: { at: slot, place: 'Library, room 2' } })
    ).body.data as StudyGroupView;
    expect(v.slot?.place).toBe('Library, room 2');
    const qid = v.questions[0]?.id ?? '';
    const done = (
      await as(joiners[0] as TestUser)
        .put(`/study-groups/${group.id}/questions/${qid}`)
        .send({ done: true })
    ).body.data as StudyGroupView;
    expect(done.questions[0]?.done).toBe(true);
    const seen = (await as(outsider).get(`/study-groups/${group.id}`)).body.data as StudyGroupView;
    expect(seen.joined).toBe(false);
    expect(seen.questions).toEqual([]);
    expect(
      (await as(outsider).post(`/study-groups/${group.id}/questions`).send({ text: 'Let me in please' }))
        .status,
    ).toBe(404);
    expect((await as(foreign).get(`/study-groups/${group.id}`)).status).toBe(404);
  });

  it('a member shares their own /quiz; each member takes it once and sees the key after', async () => {
    const msg = await inT(() =>
      ChatMessageModel.create({
        sessionId: member.id,
        userId: member.id,
        role: 'assistant',
        command: 'quiz',
        result: {
          kind: 'quiz',
          topic: 'Finite automata',
          questions: [
            {
              kind: 'mcq',
              q: 'A DFA has how many transitions per symbol per state?',
              options: ['One', 'Many', 'None'],
              answer: 0,
              explain: 'Deterministic: exactly one.',
              cite: null,
            },
            {
              kind: 'short',
              q: 'NFA stands for?',
              answer: 'Nondeterministic finite automaton',
              explain: 'N is for nondeterministic.',
              cite: null,
            },
          ],
          score: null,
        },
      }),
    );
    // Only the member's own quiz can be shared.
    expect(
      (
        await as(joiners[0] as TestUser)
          .post(`/study-groups/${group.id}/quizzes`)
          .send({ messageId: String(msg._id) })
      ).status,
    ).toBe(404);
    const shared = (
      await as(member)
        .post(`/study-groups/${group.id}/quizzes`)
        .send({ messageId: String(msg._id) })
    ).body.data as StudyGroupView;
    const quiz = shared.quizzes[0];
    expect(quiz?.questions[0]).not.toHaveProperty('answer');
    expect(quiz?.mine).toBeNull();
    const taken = (
      await as(joiners[0] as TestUser)
        .post(`/study-groups/${group.id}/quizzes/${quiz?.id ?? ''}/answers`)
        .send({ answers: [0, 'nondeterministic finite automaton'] })
    ).body.data as StudyGroupView;
    expect(taken.quizzes[0]?.mine).toMatchObject({ correct: 2, total: 2 });
    expect(taken.quizzes[0]?.mine?.key[0]?.explain).toBeTruthy();
    expect(
      (
        await as(joiners[0] as TestUser)
          .post(`/study-groups/${group.id}/quizzes/${quiz?.id ?? ''}/answers`)
          .send({ answers: [1, 'x'] })
      ).status,
    ).toBe(409);
  });
});

describe('privacy (prompt 2, G7)', () => {
  it('export carries circles and study groups; erasure removes memberships', async () => {
    const exp = JSON.parse((await as(member).get('/me/export')).text) as {
      circles: { circles: unknown[] };
      studyGroups: { studyGroups: unknown[] };
    };
    expect(exp.circles.circles.length).toBeGreaterThan(0);
    expect(exp.studyGroups.studyGroups.length).toBeGreaterThan(0);
    const svc = ctx.app.locals.services as {
      circles: { eraseFor: (id: string) => Promise<void> };
      studyGroups: { eraseFor: (id: string) => Promise<void> };
    };
    await inT(() => svc.circles.eraseFor(member.id));
    await inT(() => svc.studyGroups.eraseFor(member.id));
    expect(await inT(() => CircleMemberModel.countDocuments({ userId: member.id }))).toBe(0);
    expect(await inT(() => StudyGroupModel.countDocuments({ memberIds: member.id }))).toBe(0);
  });
});
