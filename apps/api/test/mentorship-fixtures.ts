import { Types } from 'mongoose';
import { api, makeUser, type TestTenant, type TestUser, type testApp } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { BookingModel } from '../src/modules/sessions/booking.model.js';

type Ctx = ReturnType<typeof testApp>;

/** Available around the clock in UTC, so slot maths in tests is predictable. */
export const ALL_DAY = {
  timezone: 'UTC',
  weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, windows: [{ start: '00:00', end: '24:00' }] })),
  exceptions: [],
};

export const SETTINGS = {
  accepting: true,
  weeklyCap: 10,
  audience: 'both',
  sessionTypes: [
    { type: 'quick_chat', enabled: true, durationMin: 0 },
    { type: 'video_1on1', enabled: true, durationMin: 30 },
    { type: 'mock_interview', enabled: true, durationMin: 45 },
    { type: 'resume_review', enabled: false, durationMin: 30 },
  ],
  minNoticeHours: 1,
  horizonDays: 30,
  bufferMin: 0,
};

export const REQUEST_TEXT = {
  goal: 'Crack backend interviews this year',
  background: 'Third-year CSE student, comfortable with Java and SQL',
  need: 'A mock system-design round with honest feedback',
};

export async function makeMentor(
  ctx: Ctx,
  tenant: TestTenant,
  opts: { settings?: Partial<typeof SETTINGS>; profile?: Record<string, unknown> } = {},
): Promise<TestUser> {
  const m = await makeUser(ctx, tenant, { roles: ['ALUMNI'] });
  const a = api(ctx, tenant.host, m.token);
  const p = await a.put('/me/profile').send({
    headline: 'Backend engineer',
    company: 'Nimbus Labs (demo)',
    skills: ['Java', 'System design'],
    topics: ['Backend', 'Interview prep'],
    languages: ['Telugu', 'English'],
    ...opts.profile,
  });
  if (p.status !== 200) throw new Error(JSON.stringify(p.body));
  const s = await a.put('/me/mentor').send({ ...SETTINGS, ...opts.settings });
  if (s.status !== 200) throw new Error(JSON.stringify(s.body));
  const av = await a.put('/me/mentor/availability').send(ALL_DAY);
  if (av.status !== 200) throw new Error(JSON.stringify(av.body));
  return m;
}

export async function slotsOf(
  ctx: Ctx,
  tenant: TestTenant,
  viewer: TestUser,
  mentorId: string,
  type = 'video_1on1',
) {
  const r = await api(ctx, tenant.host, viewer.token).get(`/mentors/${mentorId}/slots?type=${type}&days=3`);
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r.body.data.slots as string[];
}

export async function sendRequest(
  ctx: Ctx,
  tenant: TestTenant,
  mentee: TestUser,
  mentor: TestUser,
  sessionType = 'video_1on1',
  slotStart?: string,
) {
  return api(ctx, tenant.host, mentee.token)
    .post('/mentorship/requests')
    .send({ mentorId: mentor.id, sessionType, ...REQUEST_TEXT, ...(slotStart ? { slotStart } : {}) });
}

/** Request + accept; returns the request view (bookingId, conversationId). */
export async function acceptedSession(
  ctx: Ctx,
  tenant: TestTenant,
  mentee: TestUser,
  mentor: TestUser,
  sessionType = 'video_1on1',
  slotIndex = 0,
) {
  const slot =
    sessionType === 'quick_chat'
      ? undefined
      : (await slotsOf(ctx, tenant, mentee, mentor.id, sessionType))[slotIndex];
  const r = await sendRequest(ctx, tenant, mentee, mentor, sessionType, slot);
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  const acc = await api(ctx, tenant.host, mentor.token)
    .post(`/mentorship/requests/${r.body.data.id}/respond`)
    .send({ action: 'accept' });
  if (acc.status !== 200) throw new Error(JSON.stringify(acc.body));
  return acc.body.data as {
    id: string;
    bookingId: string | null;
    conversationId: string;
    slotStart: string | null;
  };
}

/** Moves a booking in time (tests of join windows, completion and no-shows). */
export async function shiftBooking(
  tenant: TestTenant,
  bookingId: string,
  startInMs: number,
  durationMin = 30,
) {
  const start = new Date(Date.now() + startInMs);
  await runInTenant(tenant._id, () =>
    BookingModel.updateOne(
      { _id: new Types.ObjectId(bookingId) },
      { $set: { start, end: new Date(start.getTime() + durationMin * 60_000) } },
    ),
  );
}
