import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

/** Swappable object storage (ADR 0005). Keys are server-generated random hex, never user input. */
export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

const KEY = /^[a-f0-9]{2}\/[a-f0-9]{48}$/;

export class LocalDiskStorage implements StorageProvider {
  private readonly root: string;
  constructor(dir: string) {
    this.root = resolve(dir);
  }
  private path(key: string): string {
    if (!KEY.test(key)) throw new Error('Invalid storage key');
    return join(this.root, key);
  }
  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(resolve(p, '..'), { recursive: true, mode: 0o700 });
    await writeFile(p, data, { mode: 0o600 });
  }
  async get(key: string): Promise<Buffer | null> {
    return readFile(this.path(key)).catch(() => null);
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

export class MemoryStorage implements StorageProvider {
  readonly blobs = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.blobs.set(key, data);
  }
  async get(key: string) {
    return this.blobs.get(key) ?? null;
  }
  async delete(key: string) {
    this.blobs.delete(key);
  }
}
