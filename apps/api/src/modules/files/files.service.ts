import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
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
const IMAGE_RULES: Record<'avatar' | 'id_card' | 'message_attachment', { maxEdge: number }> = {
  avatar: { maxEdge: 512 },
  id_card: { maxEdge: 2000 },
  message_attachment: { maxEdge: 2000 },
};

/** Who may read a file of a purpose owned by another module (e.g. chat attachments → participants). */
export type FileAccessResolver = (fileId: string, viewer: AuthState) => Promise<{ name: string } | null>;

/**
 * Rebuilds a PDF from its pages only. Copying pages into a new document leaves behind everything
 * not reachable from a page (document info, XMP metadata, open actions, document JavaScript,
 * embedded files, forms). On each page, only plain link annotations with URI actions survive.
 */
export async function sanitisePdf(data: Buffer): Promise<Uint8Array> {
  const src = await PDFDocument.load(data, { updateMetadata: false });
  // Prune the source pages first: copyPages copies everything a page references.
  for (const page of src.getPages()) {
    page.node.delete(PDFName.of('AA'));
    page.node.delete(PDFName.of('Metadata'));
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) {
      page.node.delete(PDFName.of('Annots'));
      continue;
    }
    const keep = annots.asArray().filter((ref) => {
      const a = src.context.lookup(ref);
      if (!(a instanceof PDFDict) || a.get(PDFName.of('Subtype'))?.toString() !== '/Link') return false;
      a.delete(PDFName.of('AA'));
      a.delete(PDFName.of('Popup'));
      const action = a.lookup(PDFName.of('A'));
      if (!(action instanceof PDFDict) || action.get(PDFName.of('S'))?.toString() !== '/URI') return false;
      action.delete(PDFName.of('Next')); // no chained actions behind a link
      return true;
    });
    page.node.set(PDFName.of('Annots'), src.context.obj(keep));
  }
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
  return out.save({ useObjectStreams: false });
}

/** Download name: no paths, no quotes or control characters, bounded length. */
export function safeFileName(raw: string, fallback: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/^\.+/, '')
    .slice(0, 100)
    .trim();
  return clean || fallback;
}

const unsupported = (msg: string) => new AppError(415, ErrorCode.VALIDATION_FAILED, msg);
const newKey = () => {
  const hex = randomBytes(25).toString('hex');
  return `${hex.slice(0, 2)}/${hex.slice(2, 50)}`;
};

export class FilesService {
  private readonly resolvers = new Map<FilePurpose, FileAccessResolver>();
  constructor(
    private readonly storage: StorageProvider,
    private readonly scanner: MalwareScanner = noopScanner,
  ) {}

  registerAccess(purpose: FilePurpose, resolver: FileAccessResolver): void {
    this.resolvers.set(purpose, resolver);
  }

  /**
   * Images: magic-byte check (JPEG/PNG/WebP only), then re-encode to WebP with sharp. Re-encoding
   * drops EXIF/GPS and any appended payload (polyglots), and normalises orientation.
   */
  async storeImage(ownerId: string, purpose: 'avatar' | 'id_card' | 'message_attachment', data: Buffer) {
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

  /**
   * Chat attachment: an image (re-encoded as above) or a PDF. PDFs are parsed and re-saved without
   * document metadata, XMP, auto-run actions, JavaScript or embedded files; encrypted PDFs are
   * refused. They are always served as downloads, never rendered on our origin.
   */
  async storeAttachment(ownerId: string, data: Buffer) {
    const type = await fileTypeFromBuffer(data);
    if (type && IMAGE_TYPES.has(type.mime)) return this.storeImage(ownerId, 'message_attachment', data);
    if (type?.mime !== 'application/pdf') throw unsupported('Attach a JPEG, PNG, WebP image or a PDF');
    let out: Uint8Array;
    try {
      out = await sanitisePdf(data);
    } catch {
      throw unsupported('That PDF could not be read (password-protected PDFs are not supported)');
    }
    return this.store(ownerId, 'message_attachment', Buffer.from(out), 'application/pdf');
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
    let name: string | null = null;
    let allowed =
      f.purpose === 'avatar' || (f.purpose === 'id_card' && (isOwner || can('verification:review')));
    const resolver = this.resolvers.get(f.purpose);
    if (!allowed && resolver) {
      const grant = await resolver(String(f._id), viewer);
      allowed = !!grant;
      name = grant?.name ?? null;
    }
    if (!allowed) throw notFound('File');
    const data = await this.storage.get(f.storageKey);
    if (!data) throw notFound('File');
    return { data, mime: f.mime, purpose: f.purpose, name };
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
