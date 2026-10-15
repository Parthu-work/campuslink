import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Types } from 'mongoose';
import { Redis } from 'ioredis';
import { LocalDiskStorage, MemoryStorage, S3StorageStub } from '../src/lib/storage.js';
import { DisabledSmsProvider } from '../src/lib/sms.js';
import { BullJobQueue, InlineJobQueue } from '../src/lib/jobs.js';
import { getContext } from '../src/lib/context.js';
import { createLogger } from '../src/lib/logger.js';

const KEY = 'ab/' + 'c'.repeat(48);

describe('storage providers', () => {
  it('local disk: put/get/delete with random keys only (no traversal)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cl-store-'));
    const s = new LocalDiskStorage(dir);
    await s.put(KEY, Buffer.from('hello'));
    expect((await s.get(KEY))?.toString()).toBe('hello');
    await s.delete(KEY);
    expect(await s.get(KEY)).toBeNull();
    await expect(s.put('../../etc/passwd', Buffer.from('x'))).rejects.toThrow(/Invalid storage key/);
    await expect(s.get('ab/../../x')).rejects.toThrow(/Invalid storage key/);
    await rm(dir, { recursive: true, force: true });
  });
  it('memory storage and the S3 stub', async () => {
    const m = new MemoryStorage();
    await m.put(KEY, Buffer.from('x'));
    expect(m.blobs.size).toBe(1);
    await m.delete(KEY);
    expect(await m.get(KEY)).toBeNull();
    await expect(new S3StorageStub().put()).rejects.toThrow(/not configured/);
    await expect(new S3StorageStub().get()).rejects.toThrow(/not configured/);
    await expect(new S3StorageStub().delete()).rejects.toThrow(/not configured/);
  });
  it('SMS is explicitly unavailable', async () => {
    const sms = new DisabledSmsProvider();
    expect(sms.available).toBe(false);
    await expect(sms.send()).rejects.toThrow(/not configured/);
  });
});

describe('job queues run every job inside its tenant', () => {
  it('inline queue', async () => {
    const q = new InlineJobQueue();
    const tenantId = new Types.ObjectId();
    let seen = '';
    q.register('t', async () => {
      seen = String(getContext()?.tenantId);
    });
    await q.enqueue('t', { tenantId: String(tenantId) });
    await q.drain();
    expect(seen).toBe(String(tenantId));
    await expect(q.enqueue('missing', { tenantId: String(tenantId) })).rejects.toThrow(/No handler/);
    await q.close();
  });

  it('BullMQ queue (needs Redis: docker compose locally, a service in CI)', async () => {
    const conn = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    await conn.connect();
    const q = new BullJobQueue(conn, createLogger('silent'));
    const tenantId = new Types.ObjectId();
    const name = `test-${tenantId}`;
    const done = new Promise<string>((resolve) => {
      q.register(name, async (data, progress) => {
        await progress(50);
        resolve(`${String(getContext()?.tenantId)}|${String(data.payload)}`);
      });
    });
    await q.enqueue(name, { tenantId: String(tenantId), payload: 'p1' }, { jobId: 'job-1' });
    expect(await done).toBe(`${tenantId}|p1`);
    await expect(q.enqueue('unknown', { tenantId: String(tenantId) })).rejects.toThrow(/Unknown queue/);
    await q.close();
    await conn.quit();
  }, 20_000);
});
