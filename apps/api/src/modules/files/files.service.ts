import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { Types } from 'mongoose';
import { ErrorCode, type Permission } from '@campuslink/shared';
import { FileModel, type FilePurpose } from './file.model.js';
import type { StorageProvider } from '../../lib/storage.js';
import { AppError, notFound } from '../../lib/errors.js';
import type { AuthState } from '../../types.js';

/** Malware-scan hook (ClamAV adapter documented for deployment). Locally: skipped, never "clean". */
export interface MalwareScanner {
  scan(data: Buffer): Promise<'clean' | 'infected' | 'skipped'>;
}
export const noopScanner: MalwareScanner = { scan: async () => 'skipped' };

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_RULES: Record<'avatar' | 'id_card', { maxEdge: number }> = {
  avatar: { maxEdge: 512 },
  id_card: { maxEdge: 2000 },
};

const unsupported = (msg: string) => new AppError(415, ErrorCode.VALIDATION_FAILED, msg);
const newKey = () => {
  const hex = randomBytes(25).toString('hex');
  return `${hex.slice(0, 2)}/${hex.slice(2, 50)}`;
};

export class FilesService {
  constructor(
    private readonly storage: StorageProvider,
    private readonly scanner: MalwareScanner = noopScanner,
  ) {}

  /**
   * Images: magic-byte check (JPEG/PNG/WebP only), then re-encode to WebP with sharp. Re-encoding
   * drops EXIF/GPS and any appended payload (polyglots), and normalises orientation.
   */
  async storeImage(ownerId: string, purpose: 'avatar' | 'id_card', data: Buffer) {
    const type = await fileTypeFromBuffer(data);
    if (!type || !IMAGE_TYPES.has(type.mime)) throw unsupported('Upload a JPEG, PNG or WebP image');
    let out: Buffer;
    try {
      out = await sharp(data, { limitInputPixels: 40_000_000, failOn: 'error' })
        .rotate()
        .resize({
          width: IMAGE_RULES[purpose].maxEdge,
          height: IMAGE_RULES[purpose].maxEdge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw unsupported('That image could not be read');
    }
    return this.store(ownerId, purpose, out, 'image/webp');
  }

  /** Raw spreadsheet or CSV for an import: kept only until the import job has read it. */
  async storeImportSource(ownerId: string, data: Buffer, mime: string) {
    return this.store(ownerId, 'import_source', data, mime, new Date(Date.now() + 24 * 3600_000));
  }

  private async store(
    ownerId: string,
    purpose: FilePurpose,
    data: Buffer,
    mime: string,
    deleteAfter: Date | null = null,
  ) {
    const scan = await this.scanner.scan(data);
    if (scan === 'infected') throw unsupported('This file was flagged by the malware scanner');
    const storageKey = newKey();
    await this.storage.put(storageKey, data);
    const doc = await FileModel.create({
      ownerId: new Types.ObjectId(ownerId),
      purpose,
      mime,
      size: data.length,
      storageKey,
      sha256: createHash('sha256').update(data).digest('hex'),
      scanStatus: scan,
      deleteAfter,
    });
    return { id: String(doc._id), mime, size: data.length };
  }

  async read(fileId: string): Promise<Buffer> {
    const f = await FileModel.findById(fileId).lean();
    if (!f) throw notFound('File');
    const data = await this.storage.get(f.storageKey);
    if (!data) throw notFound('File');
    return data;
  }

  /**
   * Object-level access. Tenant scoping already hides other colleges' files (404).
   * avatar → any signed-in member; id_card → owner or verification reviewers; import_source → never served.
   */
  async readForViewer(fileId: string, viewer: AuthState) {
    const f = await FileModel.findById(fileId).lean();
    if (!f) throw notFound('File');
    const isOwner = String(f.ownerId) === viewer.userId;
    const can = (p: Permission) => viewer.permissions.has(p);
    const allowed =
      f.purpose === 'avatar' || (f.purpose === 'id_card' && (isOwner || can('verification:review')));
    if (!allowed) throw notFound('File');
    const data = await this.storage.get(f.storageKey);
    if (!data) throw notFound('File');
    return { data, mime: f.mime, purpose: f.purpose };
  }

  async remove(fileId: string | Types.ObjectId): Promise<void> {
    const f = await FileModel.findOneAndDelete({ _id: fileId }).lean();
    if (f) await this.storage.delete(f.storageKey);
  }

  /** Retention purge (runs per tenant from the daily job). */
  async purgeExpired(): Promise<number> {
    const due = await FileModel.find({ deleteAfter: { $lte: new Date() } })
      .select('_id storageKey')
      .lean();
    for (const f of due) await this.remove(f._id);
    return due.length;
  }
}
