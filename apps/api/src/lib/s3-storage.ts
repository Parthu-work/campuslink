import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
  type ServerSideEncryption,
} from '@aws-sdk/client-s3';
import type { StorageProvider } from './storage.js';

/**
 * Amazon S3 (or an S3-compatible store) behind `StorageProvider`.
 *
 * - Objects are private: no ACLs are ever set; the bucket must block public access. Files are only
 *   ever served through the API (`FilesService`, purpose-based access, sandboxed headers).
 * - Server-side encryption on every put: SSE-KMS by default, with a customer-managed key when
 *   `kmsKeyId` is set (docs/deployment.md).
 * - Keys are the same server-generated random hex as on local disk, validated again here, under a
 *   fixed prefix.
 * - Credentials come from the default AWS chain (the ECS task role in production) unless an access
 *   key pair is given (S3-compatible stores, local development).
 */
export interface S3StorageOptions {
  bucket: string;
  region: string;
  prefix?: string;
  /** S3-compatible endpoint (path-style addressing); unset for AWS. */
  endpoint?: string | undefined;
  sse?: 'none' | 'AES256' | 'aws:kms';
  kmsKeyId?: string | undefined;
  credentials?: { accessKeyId: string; secretAccessKey: string } | undefined;
  timeoutMs?: number;
}

const KEY = /^[a-f0-9]{2}\/[a-f0-9]{48}$/;

export class S3Storage implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly sse: ServerSideEncryption | undefined;
  private readonly kmsKeyId: string | undefined;

  constructor(options: S3StorageOptions, client?: S3Client) {
    this.bucket = options.bucket;
    this.prefix = options.prefix ?? 'files/';
    const sse = options.sse ?? 'aws:kms';
    this.sse = sse === 'none' ? undefined : sse;
    this.kmsKeyId = this.sse === 'aws:kms' ? options.kmsKeyId : undefined;
    const timeout = options.timeoutMs ?? 30_000;
    const config: S3ClientConfig = {
      region: options.region,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: timeout },
      maxAttempts: 3,
      ...(options.credentials ? { credentials: options.credentials } : {}),
      ...(options.endpoint
        ? {
            endpoint: options.endpoint,
            forcePathStyle: true,
            // S3-compatible stores differ in support for the newer default checksums.
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
          }
        : {}),
    };
    this.client = client ?? new S3Client(config);
  }

  private objectKey(key: string): string {
    if (!KEY.test(key)) throw new Error('Invalid storage key');
    return `${this.prefix}${key}`;
  }

  async put(key: string, data: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: data,
        ContentLength: data.length,
        // The real type is in FileModel; the store only ever holds opaque bytes.
        ContentType: 'application/octet-stream',
        ...(this.sse ? { ServerSideEncryption: this.sse } : {}),
        ...(this.kmsKeyId ? { SSEKMSKeyId: this.kmsKeyId } : {}),
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      );
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    // Idempotent in S3: deleting a missing key succeeds.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
  }

  /** Readiness: the bucket exists and these credentials can reach it. */
  async ready(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
