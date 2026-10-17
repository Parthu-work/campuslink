import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { S3Storage } from '../src/lib/s3-storage.js';
import { storageFromEnv } from '../src/lib/storage-factory.js';
import { loadEnv } from '../src/config/env.js';
import { FilesService } from '../src/modules/files/files.service.js';
import { FileModel } from '../src/modules/files/file.model.js';
import { runInTenant } from '../src/lib/context.js';
import { makeTenant } from './helpers.js';

const key = () => `${randomBytes(1).toString('hex')}/${randomBytes(24).toString('hex')}`;

/** Records every command sent; answers GetObject from what was put. */
function recordingClient() {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const objects = new Map<string, Uint8Array>();
  const client = {
    send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      const k = String(cmd.input.Key);
      if (cmd instanceof PutObjectCommand) objects.set(k, cmd.input.Body as Uint8Array);
      if (cmd instanceof GetObjectCommand) {
        const body = objects.get(k);
        if (!body) throw new NoSuchKey({ message: 'missing', $metadata: {} });
        return { Body: { transformToByteArray: async () => body } };
      }
      return {};
    },
  };
  return { client: client as unknown as S3Client, sent };
}

describe('S3Storage', () => {
  it('encrypts with SSE-KMS by default, under the prefix, with no ACL', async () => {
    const { client, sent } = recordingClient();
    const s = new S3Storage(
      { bucket: 'b', region: 'ap-south-1', kmsKeyId: 'alias/campuslink-files' },
      client,
    );
    const k = key();
    await s.put(k, Buffer.from('hello'));
    expect(sent[0]).toMatchObject({
      name: 'PutObjectCommand',
      input: {
        Bucket: 'b',
        Key: `files/${k}`,
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: 'alias/campuslink-files',
        ContentType: 'application/octet-stream',
      },
    });
    expect(sent[0]?.input).not.toHaveProperty('ACL');
    expect((await s.get(k))?.toString()).toBe('hello');
    expect(await s.get(key())).toBeNull();
  });

  it('can use SSE-S3 or no SSE header (S3-compatible stores), and never sends a KMS key without KMS', async () => {
    const { client, sent } = recordingClient();
    await new S3Storage({ bucket: 'b', region: 'r', sse: 'AES256', kmsKeyId: 'ignored' }, client).put(
      key(),
      Buffer.from('x'),
    );
    await new S3Storage({ bucket: 'b', region: 'r', sse: 'none' }, client).put(key(), Buffer.from('x'));
    expect(sent[0]?.input).toMatchObject({ ServerSideEncryption: 'AES256' });
    expect(sent[0]?.input).not.toHaveProperty('SSEKMSKeyId');
    expect(sent[1]?.input).not.toHaveProperty('ServerSideEncryption');
  });

  it('rejects keys that are not server-generated (no traversal or other prefixes)', async () => {
    const { client, sent } = recordingClient();
    const s = new S3Storage({ bucket: 'b', region: 'r' }, client);
    for (const bad of ['../x', 'ab/../../etc', 'AB/' + 'a'.repeat(48), 'ab/short', '']) {
      await expect(s.put(bad, Buffer.from('x'))).rejects.toThrow(/Invalid storage key/);
      await expect(s.get(bad)).rejects.toThrow(/Invalid storage key/);
    }
    expect(sent).toHaveLength(0);
  });

  it('configuration: s3 needs a bucket, credential pairs, and encryption in production', () => {
    expect(() => loadEnv({ STORAGE_DRIVER: 's3' })).toThrow(/needs S3_BUCKET/);
    expect(() =>
      loadEnv({ STORAGE_DRIVER: 's3', S3_BUCKET: 'campuslink-files', S3_ACCESS_KEY_ID: 'k' }),
    ).toThrow(/S3_SECRET_ACCESS_KEY/);
    const prod = {
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      JWT_TICKET_SECRET: 'b'.repeat(40),
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      MALWARE_SCANNER: 'clamav',
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'campuslink-files',
    };
    expect(() => loadEnv({ ...prod, S3_SSE: 'none' })).toThrow(/S3_SSE=none is not allowed/);
    expect(storageFromEnv(loadEnv(prod)).storage).toBeInstanceOf(S3Storage);
  });
});

/** A real S3-compatible store (docker compose --profile s3). Runs when S3_TEST_ENDPOINT is set. */
describe.skipIf(!process.env.S3_TEST_ENDPOINT)('S3Storage against a real S3-compatible store', () => {
  const endpoint = process.env.S3_TEST_ENDPOINT ?? '';
  const bucket = `campuslink-test-${randomBytes(4).toString('hex')}`;
  const credentials = { accessKeyId: 'local-test', secretAccessKey: 'local-test-not-a-secret' };
  const s3 = new S3Storage({
    bucket,
    region: 'us-east-1',
    endpoint,
    sse: 'none',
    credentials,
    prefix: 'files/',
  });

  beforeAll(async () => {
    const raw = new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true, credentials });
    await raw.send(new CreateBucketCommand({ Bucket: bucket }));
  });

  it('puts, gets and deletes objects; a missing object is null; delete is idempotent', async () => {
    expect(await s3.ready()).toBe(true);
    const k = key();
    const data = randomBytes(300_000);
    await s3.put(k, data);
    expect((await s3.get(k))?.equals(data)).toBe(true);
    await s3.delete(k);
    expect(await s3.get(k)).toBeNull();
    await s3.delete(k);
  });

  it('reports not ready for a bucket that does not exist', async () => {
    const missing = new S3Storage({
      bucket: `${bucket}-missing`,
      region: 'us-east-1',
      endpoint,
      credentials,
    });
    expect(await missing.ready()).toBe(false);
  });

  it('serves uploads end to end through FilesService', async () => {
    const T = await makeTenant('s3files');
    const files = new FilesService(s3, { scan: async () => 'clean' });
    await runInTenant(T._id, async () => {
      const data = Buffer.from('roll,name\n1,Demo');
      const f = await files.storeImportSource('64b7f0000000000000000001', data, 'text/csv');
      const doc = await FileModel.findById(f.id).lean();
      expect(doc?.storageKey).toMatch(/^[a-f0-9]{2}\/[a-f0-9]{48}$/);
      expect((await s3.get(String(doc?.storageKey)))?.equals(data)).toBe(true);
    });
  });
});
