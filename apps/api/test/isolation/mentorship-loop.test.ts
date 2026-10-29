/**
 * MANDATORY tenant-isolation suite for build B5: reviews, mentor stats and rematch suggestions.
 * A review, a request or a mentor of college A means nothing at college B.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { acceptedSession, makeMentor, sendRequest, shiftBooking } from '../mentorship-fixtures.js';
import { runInTenant } from '../../src/lib/context.js';
import { MentorReviewModel } from '../../src/modules/mentorship/review.model.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let mentorA: TestUser, studentA: TestUser, studentB: TestUser, adminB: TestUser;
let bookingA = '';
let reviewA = '';
let requestA = '';

beforeAll(async () => {
  A = await makeTenant('iso-loop-a');
  B = await makeTenant('iso-loop-b');
  mentorA = await makeMentor(ctx, A);
  studentA = await makeUser(ctx, A, { roles: ['STUDENT'] });
  studentB = await makeUser(ctx, B, { roles: ['STUDENT'] });
  adminB = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
  const acc = await acceptedSession(ctx, A, studentA, mentorA);
  bookingA = acc.bookingId as string;
  await shiftBooking(A, bookingA, -2 * 3600_000);
  const a = api(ctx, A.host, studentA.token);
  await a.get('/bookings?when=past');
  await a.post(`/bookings/${bookingA}/feedback`).send({ rating: 5, tags: [] });
  reviewA = (await a.post(`/bookings/${bookingA}/review`).send({ text: 'Isolated review text here.' })).body
    .data.id;
  requestA = (await sendRequest(ctx, A, studentA, mentorA, 'quick_chat')).body.data.id;
});

describe('tenant isolation: reviews, stats and rematch (B5)', () => {
  it("college B cannot read college A's mentor, stats or reviews", async () => {
    const b = api(ctx, B.host, studentB.token);
    expect((await b.get(`/mentors/${mentorA.id}`)).status).toBe(404);
    expect((await b.get(`/mentors/${mentorA.id}/reviews`)).status).toBe(404);
    expect(JSON.stringify((await b.get('/mentors')).body)).not.toContain(mentorA.id);
  });

  it("college B cannot review college A's booking or rematch its request", async () => {
    const b = api(ctx, B.host, studentB.token);
    expect(
      (await b.post(`/bookings/${bookingA}/review`).send({ text: 'Cross-college review.' })).status,
    ).toBe(404);
    expect((await b.get(`/mentorship/requests/${requestA}/alternatives`)).status).toBe(404);
    expect(
      (await b.post(`/mentorship/requests/${requestA}/rematch`).send({ mentorId: mentorA.id })).status,
    ).toBe(404);
  });

  it("college B's moderators cannot remove or report college A's review", async () => {
    const b = api(ctx, B.host, adminB.token);
    const act = await b
      .post('/admin/moderation/actions')
      .send({ targetType: 'review', targetId: reviewA, action: 'remove', reason: 'spam' });
    expect(act.status).toBe(404);
    const rep = await api(ctx, B.host, studentB.token)
      .post('/reports')
      .send({ targetType: 'review', targetId: reviewA, reason: 'spam' });
    expect(rep.status).toBe(404);
    const doc = await runInTenant(A._id, () => MentorReviewModel.findById(reviewA).lean());
    expect(doc?.status).toBe('published');
    expect(await runInTenant(B._id, () => MentorReviewModel.countDocuments())).toBe(0);
  });
});
