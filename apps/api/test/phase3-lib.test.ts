import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Redis } from 'ioredis';
import { jwtVerify } from 'jose';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { JitsiVideoProvider, dailyVideoStub, hmsVideoStub, randomRoomName } from '../src/lib/video.js';
import { TurnstileBotProtection, disabledBotProtection } from '../src/lib/bot.js';
import { BullJobQueue, InlineJobQueue } from '../src/lib/jobs.js';
import { safeFetch, type Transport } from '../src/lib/safe-fetch.js';
import { createLogger } from '../src/lib/logger.js';
import { sanitisePdf, safeFileName } from '../src/modules/files/files.service.js';

const reply = (status: number, body = '', headers: Record<string, string> = {}) => ({
  status,
  header: (n: string) => headers[n.toLowerCase()] ?? null,
  body: (async function* () {
    if (body) yield new TextEncoder().encode(body);
  })(),
  cancel: async () => undefined,
});

describe('video provider', () => {
  it('makes 160-bit room names', () => {
    const names = new Set(Array.from({ length: 50 }, randomRoomName));
    expect(names.size).toBe(50);
    for (const n of names) expect(n).toMatch(/^mentor-[a-z2-7]{32}$/);
  });

  it('signs a Jitsi JWT bounded to the join window when token auth is configured', async () => {
    const secret = 's'.repeat(40);
    const v = new JitsiVideoProvider('https://meet.example.org', { appId: 'campus', secret });
    const notBefore = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 3600_000);
    const url = new URL(
      await v.joinUrl({
        room: 'mentor-abc',
        user: { id: 'u1', name: 'Asha "A"' },
        moderator: true,
        notBefore,
        expiresAt,
      }),
    );
    expect(url.origin + url.pathname).toBe('https://meet.example.org/mentor-abc');
    const { payload } = await jwtVerify(url.searchParams.get('jwt') ?? '', new TextEncoder().encode(secret), {
      audience: 'jitsi',
      issuer: 'campus',
    });
    expect(payload).toMatchObject({
      room: 'mentor-abc',
      sub: 'meet.example.org',
      context: { user: { id: 'u1', moderator: true } },
    });
    expect(payload.exp).toBe(Math.floor(expiresAt.getTime() / 1000));
    expect(decodeURIComponent(url.hash)).toContain('userInfo.displayName="Asha \\"A\\""');
    const plain = await new JitsiVideoProvider('https://meet.jit.si').joinUrl({
      room: 'r',
      user: { id: 'u', name: 'n' },
      moderator: false,
      notBefore,
      expiresAt,
    });
    expect(plain).not.toContain('jwt=');
  });

  it('100ms and Daily are explicit stubs', async () => {
    for (const p of [hmsVideoStub(), dailyVideoStub()]) {
      expect(p.newRoom()).toMatch(/^mentor-/);
      await expect(p.joinUrl()).rejects.toThrow(/not set up/);
    }
  });
});

describe('bot protection', () => {
  it('the local adapter lets everything through', async () => {
    expect(disabledBotProtection.enabled).toBe(false);
    expect(await disabledBotProtection.verify(undefined, undefined)).toBe(true);
  });

  it('Turnstile verifies through the safe fetcher and fails closed', async () => {
    const calls: { url: string; body: unknown; allowHosts?: readonly string[] }[] = [];
    const answer = { status: 200, json: '{"success":true}' };
    const fetcher = (async (url: string, o: { body?: unknown; allowHosts?: readonly string[] }) => {
      calls.push({ url, body: o.body, ...(o.allowHosts ? { allowHosts: o.allowHosts } : {}) });
      if (answer.status === 0) throw new Error('down');
      return {
        status: answer.status,
        contentType: 'application/json',
        body: Buffer.from(answer.json),
        finalUrl: url,
      };
    }) as unknown as typeof safeFetch;
    const bot = new TurnstileBotProtection('sekret', fetcher);
    expect(await bot.verify(undefined, '1.2.3.4')).toBe(false);
    expect(await bot.verify('tok', '1.2.3.4')).toBe(true);
    expect(calls[0]).toMatchObject({
      url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      allowHosts: ['challenges.cloudflare.com'],
    });
    expect(String(calls[0]?.body)).toBe('secret=sekret&response=tok&remoteip=1.2.3.4');
    answer.json = '{"success":false}';
    expect(await bot.verify('tok', undefined)).toBe(false);
    answer.status = 0;
    expect(await bot.verify('tok', undefined)).toBe(false);
  });
});

describe('safeFetch POST', () => {
  it('sends the method and body, and never follows redirects for POST', async () => {
    const seen: string[] = [];
    const transport: Transport = async (u, _ip, init) => {
      seen.push(`${init.method} ${u.pathname} ${String(init.body)}`);
      return reply(302, '', { location: 'https://elsewhere.example/' });
    };
    const r = await safeFetch('https://push.example/send', {
      method: 'POST',
      body: 'payload',
      resolve: async () => ['93.184.216.34'],
      transport,
    });
    expect(r.status).toBe(302);
    expect(seen).toEqual(['POST /send payload']);
  });
});

describe('delayed jobs', () => {
  it('inline: delays wait for runDelayed, dedupe by id, can be cancelled', async () => {
    const q = new InlineJobQueue();
    const ran: string[] = [];
    q.register('later', async (d) => void ran.push(String(d.v)));
    const tenantId = String(new Types.ObjectId());
    await q.enqueue('later', { tenantId, v: 'a' }, { jobId: 'j-a', delayMs: 1000 });
    await q.enqueue('later', { tenantId, v: 'dup' }, { jobId: 'j-a', delayMs: 1000 });
    await q.enqueue('later', { tenantId, v: 'b' }, { jobId: 'j-b', delayMs: 5000 });
    await q.enqueue('later', { tenantId, v: 'c' }, { jobId: 'j-c', delayMs: 1000 });
    await q.cancel('later', 'j-c');
    await expect(q.enqueue('later', { tenantId }, { jobId: 'bad:id' })).rejects.toThrow(/cannot contain/);
    await q.drain();
    expect(ran).toEqual([]);
    await q.runDelayed({ until: Date.now() + 2000 });
    expect(ran).toEqual(['a']);
    await q.runDelayed();
    expect(ran).toEqual(['a', 'b']);
  });

  it('BullMQ: a delayed job can be cancelled before it runs', async () => {
    const conn = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    await conn.connect();
    const q = new BullJobQueue(conn, createLogger('silent'));
    const name = `delay-${new Types.ObjectId()}`;
    const ran: string[] = [];
    let resolveRun: () => void = () => undefined;
    const ranOnce = new Promise<void>((r) => (resolveRun = r));
    q.register(name, async (d) => {
      ran.push(String(d.v));
      resolveRun();
    });
    const tenantId = String(new Types.ObjectId());
    await q.enqueue(name, { tenantId, v: 'cancelled' }, { jobId: 'job-x', delayMs: 800 });
    await q.cancel(name, 'job-x');
    await q.cancel(name, 'no-such-job');
    await q.enqueue(name, { tenantId, v: 'kept' }, { jobId: 'job-y', delayMs: 300 });
    await ranOnce;
    await new Promise((r) => setTimeout(r, 900));
    expect(ran).toEqual(['kept']);
    await q.close();
    await conn.quit();
  }, 20_000);
});

describe('attachment helpers', () => {
  it('keeps URI links in PDFs but drops script links and page actions', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const uri = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [0, 0, 10, 10],
      A: { S: 'URI', URI: PDFString.of('https://github.com/demo') },
    });
    const js = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [0, 20, 10, 30],
      A: { S: 'JavaScript', JS: PDFString.of('app.alert(2)') },
    });
    page.node.set(
      PDFName.of('Annots'),
      doc.context.obj([doc.context.register(uri), doc.context.register(js)]),
    );
    page.node.set(
      PDFName.of('AA'),
      doc.context.obj({ O: { S: 'JavaScript', JS: PDFString.of('app.alert(3)') } }),
    );
    const out = Buffer.from(
      await sanitisePdf(Buffer.from(await doc.save({ useObjectStreams: false }))),
    ).toString('latin1');
    expect(out).toContain('https://github.com/demo');
    expect(out).not.toContain('JavaScript');
    expect(out).not.toContain('app.alert');
  });

  it('sanitises download names', () => {
    expect(safeFileName('../../etc/passwd', 'x')).toBe('passwd');
    expect(safeFileName('Résumé – final.pdf', 'x')).toBe('Résumé _ final.pdf');
    expect(safeFileName('...', 'fallback')).toBe('fallback');
    expect(safeFileName('a\r\nb"c', 'x')).toBe('a__b_c');
  });
});
