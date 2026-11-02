import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';

/** Offline and low-data mode (build B13): data-saver images and replayable offline writes. */
const ctx = testApp();
let T: TestTenant, T2: TestTenant;
let alum: TestUser, student: TestUser, staff: TestUser, other: TestUser;
let avatarId: string;
const as = (u: TestUser, host = T.host) => api(ctx, host, u.token);
const HOUR = 3_600_000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

/** Binary bodies (supertest buffers anything that is not JSON or text). */
const bytes = (r: { body: unknown }) => Buffer.from(r.body as Buffer);

beforeAll(async () => {
  T = await makeTenant('offline');
  T2 = await makeTenant('offline2');
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  staff = await makeUser(ctx, T, { roles: ['FACULTY'] });
  other = await makeUser(ctx, T2, { roles: ['STUDENT'] });
  const png = await sharp({
    create: { width: 512, height: 512, channels: 3, background: { r: 30, g: 120, b: 90 } },
  })
    .png()
    .toBuffer();
  const r = await as(alum).post('/me/avatar').attach('photo', png, 'me.png');
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  avatarId = r.body.data.avatarFileId;
});

describe('data saver images (GET /files/:id?w=)', () => {
  it('serves a smaller WebP at an allowed width, and the original without one', async () => {
    const full = await as(student).get(`/files/${avatarId}`);
    expect(full.status).toBe(200);
    expect((await sharp(bytes(full)).metadata()).width).toBe(512);
    for (const w of [160, 320]) {
      const small = await as(student).get(`/files/${avatarId}?w=${w}`);
      expect(small.status).toBe(200);
      expect(small.headers['content-type']).toBe('image/webp');
      expect(small.headers['x-content-type-options']).toBe('nosniff');
      expect((await sharp(bytes(small)).metadata()).width).toBe(w);
      expect(bytes(small).length).toBeLessThan(bytes(full).length);
    }
    // Never enlarged: 640 of a 512 px image is the 512 px image.
    const big = await as(student).get(`/files/${avatarId}?w=640`);
    expect((await sharp(bytes(big)).metadata()).width).toBe(512);
  });

  it('refuses other widths and unknown query keys', async () => {
    for (const q of ['w=100', 'w=2000', 'w=abc', 'width=160'])
      expect((await as(student).get(`/files/${avatarId}?${q}`)).status, q).toBe(400);
  });

  it('checks access exactly as for the original', async () => {
    expect((await api(ctx, T.host).get(`/files/${avatarId}?w=160`)).status).toBe(401);
    // Another college never sees it (tenant isolation).
    expect((await as(other, T2.host).get(`/files/${avatarId}?w=160`)).status).toBe(404);
  });
});

describe('offline writes replay with their Idempotency-Key', () => {
  it('an RSVP sent twice with one key applies once and replays the first answer', async () => {
    const ev = await as(staff)
      .post('/events')
      .send({
        title: 'Demo offline meetup for the tests',
        description: 'DEMO event used by the offline tests: an RSVP sent twice with one key.',
        kind: 'meetup',
        mode: 'in_person',
        startsAt: at(48),
        endsAt: at(50),
        location: 'Seminar Hall 1',
        capacity: 10,
      });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    const id = ev.body.data.id as string;
    const key = 'offline-rsvp-0001';
    const first = await as(student)
      .put(`/events/${id}/rsvp`)
      .set('Idempotency-Key', key)
      .send({ going: true });
    expect(first.status).toBe(200);
    expect(first.body.data.going).toBe(1);
    const again = await as(student)
      .put(`/events/${id}/rsvp`)
      .set('Idempotency-Key', key)
      .send({ going: true });
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.data.going).toBe(1);
    // The same key with a different body is refused.
    expect(
      (await as(student).put(`/events/${id}/rsvp`).set('Idempotency-Key', key).send({ going: false })).status,
    ).toBe(422);
    // Without a key the route behaves as before.
    expect((await as(student).put(`/events/${id}/rsvp`).send({ going: false })).body.data.going).toBe(0);
  });
});
