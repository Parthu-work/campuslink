import type { Env } from '../config/env.js';
import { LocalDiskStorage, type StorageProvider } from './storage.js';
import { S3Storage } from './s3-storage.js';

/** The configured `StorageProvider`, plus a readiness check where the backend has one. */
export function storageFromEnv(env: Env): { storage: StorageProvider; ready?: () => Promise<boolean> } {
  if (env.STORAGE_DRIVER !== 's3') return { storage: new LocalDiskStorage(env.STORAGE_LOCAL_DIR) };
  if (!env.S3_BUCKET) throw new Error('STORAGE_DRIVER=s3 needs S3_BUCKET');
  const s3 = new S3Storage({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    prefix: env.S3_PREFIX,
    endpoint: env.S3_ENDPOINT,
    sse: env.S3_SSE,
    kmsKeyId: env.S3_KMS_KEY_ID,
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
  return { storage: s3, ready: () => s3.ready() };
}
