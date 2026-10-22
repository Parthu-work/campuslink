/**
 * MANDATORY realtime suite: socket authentication, tenant binding and per-user delivery. Blocks CI.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { decodeJwt } from 'jose';
import { REALTIME_PATH } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { acceptedSession, makeMentor, sendRequest } from './mentorship-fixtures.js';
import { TokenService } from '../src/lib/jwt.js';
import { loadEnv } from '../src/config/env.js';
import type { RealtimeGateway } from '../src/http/realtime.js';
import { makeSubject } from './study-fixtures.js';

const ctx = testApp();
const gateway = (ctx.app.locals.services as { realtime: RealtimeGateway }).realtime;
let server: Server;
let port: number;
let A: TestTenant, B: TestTenant;
let mentor: TestUser, mentee: TestUser, outsider: TestUser, foreign: TestUser, admin: TestUser;
let convId: string;
const open: Socket[] = [];

function connect(host: string, token: string | undefined, origin?: string): Socket {
  const s = ioClient(`http://127.0.0.1:${port}`, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    auth: token ? { token } : {},
    extraHeaders: { host: `${host}:5173`, ...(origin ? { origin } : {}) },
  });
  open.push(s);
  return s;
}
const connected = (s: Socket) =>
  new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', (e) => reject(e));
  });
const rejected = (s: Socket) =>
  new Promise<string>((resolve, reject) => {
    s.once('connect', () => reject(new Error('should not connect')));
    s.once('connect_error', (e: Error & { data?: { code?: string } }) => resolve(e.data?.code ?? e.message));
  });
/** Collects events of a kind for a short while. */
const collect = <T>(s: Socket, event: string, ms = 400) =>
  new Promise<T[]>((resolve) => {
    const got: T[] = [];
    s.on(event, (p: T) => got.push(p));
    setTimeout(() => resolve(got), ms);
  });

beforeAll(async () => {
  server = createServer(ctx.app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  gateway.attach(server);
  A = await makeTenant('rtalpha');
  B = await makeTenant('rtbravo');
  mentor = await makeMentor(ctx, A);
  mentee = await makeUser(ctx, A, { roles: ['STUDENT'] });
  outsider = await makeUser(ctx, A, { roles: ['STUDENT'] });
  admin = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  foreign = await makeUser(ctx, B, { roles: ['STUDENT'] });
  convId = (await acceptedSession(ctx, A, mentee, mentor, 'quick_chat')).conversationId;
});

afterAll(async () => {
  for (const s of open) s.disconnect();
  await gateway.close();
});

describe('socket authentication', () => {
  it('refuses missing or invalid tokens', async () => {
    expect(await rejected(connect(A.host, undefined))).toBe('UNAUTHENTICATED');
    expect(await rejected(connect(A.host, 'not-a-jwt'))).toBe('UNAUTHENTICATED');
  });

  it('binds a token to its own college host', async () => {
    expect(await rejected(connect(A.host, foreign.token))).toBe('TENANT_MISMATCH');
    expect(await rejected(connect(B.host, mentee.token))).toBe('TENANT_MISMATCH');
    expect(await rejected(connect('nowhere.localhost', mentee.token))).toBe('UNKNOWN_TENANT');
  });

  it('refuses cross-site origins', async () => {
    await expect(connected(connect(A.host, mentee.token, 'https://evil.example'))).rejects.toBeTruthy();
    await connected(connect(A.host, mentee.token, `http://${A.host}:5173`));
  });

  it('disconnects when the access token expires', async () => {
    const env = loadEnv({ NODE_ENV: 'test' });
    const short = new TokenService(env.JWT_ACCESS_SECRET, env.JWT_TICKET_SECRET, 1);
    const claims = decodeJwt(mentee.token);
    const token = await short.signAccess({
      sub: String(claims.sub),
      tid: String(claims.tid),
      sid: String(claims.sid),
      ver: Number(claims.ver),
    });
    const s = connect(A.host, token);
    await connected(s);
    const reason = await new Promise<string>((r) => s.once('disconnect', r));
    expect(reason).toBe('io server disconnect');
  });

  it('disconnects a member who gets suspended', async () => {
    const victim = await makeUser(ctx, A, { roles: ['STUDENT'] });
    const s = connect(A.host, victim.token);
    await connected(s);
    const gone = new Promise<string>((r) => s.once('disconnect', r));
    expect(
      (
        await api(ctx, A.host, admin.token)
          .patch(`/admin/users/${victim.id}/status`)
          .send({ status: 'suspended' })
      ).status,
    ).toBe(200);
    expect(await gone).toBe('io server disconnect');
  });
});

describe('delivery is per user and per college', () => {
  it('sends a new message only to the two participants', async () => {
    const [sMentor, sOutsider, sForeign] = [
      connect(A.host, mentor.token),
      connect(A.host, outsider.token),
      connect(B.host, foreign.token),
    ];
    await Promise.all([connected(sMentor), connected(sOutsider), connected(sForeign)]);
    const got = {
      mentor: collect<{ body: string }>(sMentor, 'message:new'),
      outsider: collect(sOutsider, 'message:new'),
      foreign: collect(sForeign, 'message:new'),
    };
    await api(ctx, A.host, mentee.token)
      .post(`/conversations/${convId}/messages`)
      .send({ body: 'Live hello' });
    expect((await got.mentor).map((m) => m.body)).toEqual(['Live hello']);
    expect(await got.outsider).toEqual([]);
    expect(await got.foreign).toEqual([]);
  });

  it('relays typing only from participants, and read receipts to the sender', async () => {
    const [sMentor, sMentee, sOutsider] = [
      connect(A.host, mentor.token),
      connect(A.host, mentee.token),
      connect(A.host, outsider.token),
    ];
    await Promise.all([connected(sMentor), connected(sMentee), connected(sOutsider)]);
    const typing = collect<{ conversationId: string; userId: string }>(sMentor, 'typing', 600);
    sOutsider.emit('typing', { conversationId: convId }); // not a participant
    sMentee.emit('typing', { conversationId: convId });
    sMentee.emit('typing', { conversationId: convId }); // throttled (one per second)
    expect(await typing).toEqual([{ conversationId: convId, userId: mentee.id }]);
    await new Promise((r) => setTimeout(r, 1100));
    const invalid = collect(sMentor, 'typing', 1800);
    sMentee.emit('typing', { conversationId: convId, extra: 1 }); // strict schema
    await new Promise((r) => setTimeout(r, 1100));
    sMentee.emit('typing', { conversationId: 'not-an-id' });
    expect(await invalid).toEqual([]);
    const reads = collect<{ userId: string }>(sMentee, 'message:read');
    const last = (await api(ctx, A.host, mentor.token).get(`/conversations/${convId}/messages`)).body.data.at(
      -1,
    );
    await api(ctx, A.host, mentor.token).post(`/conversations/${convId}/read`).send({ messageId: last.id });
    expect((await reads).map((r) => r.userId)).toEqual([mentor.id]);
  });

  it('pushes in-app notifications live', async () => {
    const m = await makeMentor(ctx, A);
    const s = connect(A.host, m.token);
    await connected(s);
    const got = collect<{ type: string; data: Record<string, string> }>(s, 'notification:new');
    await sendRequest(ctx, A, outsider, m, 'quick_chat');
    const n = await got;
    expect(n.map((x) => x.type)).toEqual(['request_received']);
    // Notification payloads carry names and ids, never request text.
    expect(JSON.stringify(n)).not.toContain('Crack backend interviews');
  });

  it('sends study processing progress only to the uploader', async () => {
    const faculty = await makeUser(ctx, A, { roles: ['FACULTY'] });
    const other = await makeUser(ctx, A, { roles: ['FACULTY'] });
    const subject = (await makeSubject(ctx, A, faculty, { branches: [], batches: [] })).id;
    const mine = connect(A.host, faculty.token);
    const theirs = connect(A.host, other.token);
    const student = connect(A.host, outsider.token);
    const far = connect(B.host, foreign.token);
    await Promise.all([mine, theirs, student, far].map(connected));
    const got = [mine, theirs, student, far].map((s) =>
      collect<{ materialId: string; stage: string; progress: number }>(s, 'study:material', 700),
    );
    const up = await api(ctx, A.host, faculty.token)
      .post('/study/materials')
      .field('subjectId', subject)
      .field('rights', 'true')
      .attach('file', Buffer.from('Demo realtime notes about automata.'), 'rt.txt');
    expect(up.status).toBe(201);
    await ctx.queue.drain();
    const [m, t, st, f] = await Promise.all(got);
    expect(m?.map((e) => e.stage)).toEqual(expect.arrayContaining(['scanning', 'chunking', 'indexed']));
    expect(m?.every((e) => e.materialId === up.body.data.id)).toBe(true);
    expect([t, st, f]).toEqual([[], [], []]);
  });
});
