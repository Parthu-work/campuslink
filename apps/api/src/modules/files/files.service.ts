import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { readMp4, stripMp4Metadata } from '../../lib/mp4.js';
import { assertSafeZip } from '../../lib/zip-guard.js';
import { ScannerUnavailableError } from '../../lib/clamav.js';
import { fileTypeFromBuffer } from 'file-type';
import { Types } from 'mongoose';
import { ErrorCode, LOGO_TYPES, type Permission } from '@campuslink/shared';
import { FileModel, type FilePurpose } from './file.model.js';
import type { StorageProvider } from '../../lib/storage.js';
import { AppError, notFound } from '../../lib/errors.js';
import type { AuthState } from '../../types.js';

/**
 * Malware-scan hook. `ClamdScanner` (lib/clamav.ts) in production; locally `noopScanner` reports
 * "skipped", never "clean". A scanner that throws `ScannerUnavailableError` refuses the upload.
 */
export interface MalwareScanner {
  scan(data: Buffer): Promise<'clean' | 'infected' | 'skipped'>;
}
export const noopScanner: MalwareScanner = { scan: async () => 'skipped' };

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
type ImagePurpose = 'avatar' | 'id_card' | 'message_attachment' | 'post_media' | 'story_media';
const IMAGE_RULES: Record<ImagePurpose, { maxEdge: number }> = {
  avatar: { maxEdge: 512 },
  id_card: { maxEdge: 2000 },
  message_attachment: { maxEdge: 2000 },
  post_media: { maxEdge: 1600 },
  story_media: { maxEdge: 1440 },
};
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime']);
type ClaimablePurpose = 'post_media' | 'story_media' | 'referral_resume';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/vnd.wave',
  'audio/x-wav',
]);
const ARCHIVES = new Set([
  'application/zip',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/gzip',
  'application/x-tar',
  'application/x-bzip2',
  'application/x-xz',
]);
const TEXT_TYPES: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv' };
export type StudyFileKind = 'pdf' | 'doc' | 'slides' | 'notes' | 'image' | 'video_file' | 'audio';
/** Signed links live this long; authorization is checked again on every request anyway. */
const SIGNED_TTL_SEC = 300;

/** Uploaded-but-unattached media is purged after a day. */
const UNATTACHED_TTL_MS = 24 * 3600_000;

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
    .replace(/[^\p{L}\p{M}\p{N} ._()-]/gu, '_')
    .replace(/^\.+/, '')
    .slice(0, 100)
    .trim();
  return clean || fallback;
}

const isUtf8 = (b: Buffer) => {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
};
const unsupported = (msg: string) => new AppError(415, ErrorCode.VALIDATION_FAILED, msg);
const newKey = () => {
  const hex = randomBytes(25).toString('hex');
  return `${hex.slice(0, 2)}/${hex.slice(2, 50)}`;
};

export class FilesService {
  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    return FileModel.find({ ownerId: userId }).select('purpose mime size createdAt').lean();
  }

  async eraseFor(userId: string) {
    const owned = await FileModel.find({ ownerId: userId }).select('_id').lean();
    for (const f of owned) await this.remove(f._id);
  }

  private readonly resolvers = new Map<FilePurpose, FileAccessResolver>();
  constructor(
    private readonly storage: StorageProvider,
    private readonly scanner: MalwareScanner = noopScanner,
    /** HMAC key for signed file links (derived from a server secret). */
    private readonly signingKey: Buffer = randomBytes(32),
  ) {}

  registerAccess(purpose: FilePurpose, resolver: FileAccessResolver): void {
    this.resolvers.set(purpose, resolver);
  }

  /**
   * Images: magic-byte check (JPEG/PNG/WebP only), then re-encode to WebP with sharp. Re-encoding
   * drops EXIF/GPS and any appended payload (polyglots), and normalises orientation.
   */
  async storeImage(ownerId: string, purpose: ImagePurpose, data: Buffer) {
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
    const pending = purpose === 'post_media' || purpose === 'story_media';
    return this.store(
      ownerId,
      purpose,
      out,
      'image/webp',
      pending ? new Date(Date.now() + UNATTACHED_TTL_MS) : null,
    );
  }

  /**
   * The college logo: PNG or WebP only (sniffed, so SVG and everything else is refused), re-encoded
   * to WebP on a transparent 512 px square (so it can also be the installed app's icon), and scanned
   * like every upload. The college owns it, not the admin who uploaded it, so erasing their account
   * leaves the logo in place.
   */
  async storeLogo(data: Buffer) {
    const type = await fileTypeFromBuffer(data);
    if (!type || !(LOGO_TYPES as readonly string[]).includes(type.mime))
      throw unsupported('Upload a PNG or WebP logo');
    let out: Buffer;
    try {
      out = await sharp(data, { limitInputPixels: 40_000_000, failOn: 'error' })
        .resize({ width: 512, height: 512, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 90, alphaQuality: 100 })
        .toBuffer();
    } catch {
      throw unsupported('That image could not be read');
    }
    return this.store(null, 'branding', out, 'image/webp');
  }

  /** The college logo, for anyone on the college's site (the sign-in page shows it). */
  async readLogo(fileId: string) {
    const f = await FileModel.findOne({ _id: fileId, purpose: 'branding' }).lean();
    const data = f && (await this.storage.get(f.storageKey));
    if (!f || !data) throw notFound('Logo');
    return { data, mime: f.mime };
  }

  /**
   * Tips reel: MP4/QuickTime only (sniffed), at most `maxSeconds` long (read from the container
   * header), metadata boxes (GPS, device, XMP) neutralised in place. No transcoding.
   */
  async storeVideo(ownerId: string, data: Buffer, maxSeconds: number) {
    const type = await fileTypeFromBuffer(data);
    if (!type || !VIDEO_TYPES.has(type.mime)) throw unsupported('Upload an MP4 or MOV video');
    const info = readMp4(data);
    if (!info) throw unsupported('That video could not be read');
    if (info.durationSec > maxSeconds + 0.5)
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, `Reels can be up to ${maxSeconds} seconds`);
    return {
      ...(await this.store(
        ownerId,
        'post_media',
        stripMp4Metadata(data),
        type.mime,
        new Date(Date.now() + UNATTACHED_TTL_MS),
        {
          durationSec: Math.round(info.durationSec * 10) / 10,
        },
      )),
      durationSec: Math.round(info.durationSec * 10) / 10,
    };
  }

  /**
   * Attaches uploaded media to a post or story: only the uploader, only the right purpose, only
   * once. `keepUntil` null keeps the file; a date schedules deletion (stories).
   */
  /** An unattached upload of the owner (for validation before claiming), or null. */
  async pending(fileId: string, ownerId: string, purpose: ClaimablePurpose) {
    const f = await FileModel.findOne({
      _id: fileId,
      ownerId: new Types.ObjectId(ownerId),
      purpose,
      attachedAt: null,
    })
      .select('mime durationSec')
      .lean();
    return f ? { id: String(f._id), mime: f.mime, durationSec: f.durationSec ?? null } : null;
  }

  async claim(fileId: string, ownerId: string, purpose: ClaimablePurpose, keepUntil: Date | null) {
    const f = await FileModel.findOneAndUpdate(
      { _id: fileId, ownerId: new Types.ObjectId(ownerId), purpose, attachedAt: null },
      { $set: { attachedAt: new Date(), deleteAfter: keepUntil } },
      { returnDocument: 'after' },
    ).lean();
    if (!f)
      throw new AppError(
        400,
        ErrorCode.VALIDATION_FAILED,
        'Upload the media again (it expired or is already used)',
      );
    return { id: String(f._id), mime: f.mime, durationSec: f.durationSec ?? null };
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

  /** Résumé for a referral request: PDF only, rebuilt like chat PDFs; purged unless a request claims it. */
  async storeResume(ownerId: string, data: Buffer) {
    const type = await fileTypeFromBuffer(data);
    if (type?.mime !== 'application/pdf') throw unsupported('Upload your résumé as a PDF');
    let out: Uint8Array;
    try {
      out = await sanitisePdf(data);
    } catch {
      throw unsupported('That PDF could not be read (password-protected PDFs are not supported)');
    }
    return this.store(
      ownerId,
      'referral_resume',
      Buffer.from(out),
      'application/pdf',
      new Date(Date.now() + UNATTACHED_TTL_MS),
    );
  }

  /** Raw spreadsheet or CSV for an import: kept only until the import job has read it. */
  async storeImportSource(ownerId: string, data: Buffer, mime: string) {
    return this.store(ownerId, 'import_source', data, mime, new Date(Date.now() + 24 * 3600_000));
  }

  /**
   * Study material. The real type is sniffed (the name only decides between plain-text kinds):
   * PDFs are rebuilt without scripts, metadata or attachments; Word and PowerPoint files pass the
   * zip-bomb check; images are re-encoded; MP4 metadata is neutralised; archives are refused.
   * `checksum` is of the uploaded bytes (duplicate detection).
   */
  async storeStudyMaterial(
    ownerId: string,
    data: Buffer,
    originalName: string,
    caps: { documentBytes: number; mediaBytes: number },
  ): Promise<{
    id: string;
    mime: string;
    size: number;
    checksum: string;
    kind: StudyFileKind;
    durationSec: number | null;
  }> {
    const checksum = createHash('sha256').update(data).digest('hex');
    const type = await fileTypeFromBuffer(data);
    const tooBig = (limit: number) =>
      new AppError(
        413,
        ErrorCode.VALIDATION_FAILED,
        `File is too large (max ${Math.round(limit / 1048576)} MB)`,
      );
    const doc = (kind: StudyFileKind, out: Buffer, mime: string) => {
      if (data.length > caps.documentBytes) throw tooBig(caps.documentBytes);
      return { kind, out, mime, durationSec: null as number | null };
    };
    let r: { kind: StudyFileKind; out: Buffer; mime: string; durationSec: number | null };
    if (type?.mime === 'application/pdf') {
      if (data.length > caps.documentBytes) throw tooBig(caps.documentBytes);
      try {
        r = doc('pdf', Buffer.from(await sanitisePdf(data)), 'application/pdf');
      } catch {
        throw unsupported('That PDF could not be read (password-protected PDFs are not supported)');
      }
    } else if (type?.mime === DOCX || type?.mime === PPTX) {
      try {
        assertSafeZip(data, { maxTotal: 150 * 1024 * 1024, maxRatio: 120, maxEntries: 5000 });
      } catch {
        throw unsupported('That file expands too much to be safe');
      }
      r = doc(type.mime === DOCX ? 'doc' : 'slides', data, type.mime);
    } else if (type && ARCHIVES.has(type.mime)) {
      throw unsupported('Archives are not accepted: upload the files themselves');
    } else if (type && IMAGE_TYPES.has(type.mime)) {
      if (data.length > caps.documentBytes) throw tooBig(caps.documentBytes);
      try {
        const out = await sharp(data, { limitInputPixels: 60_000_000, failOn: 'error' })
          .rotate()
          .resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();
        r = { kind: 'image', out, mime: 'image/webp', durationSec: null };
      } catch {
        throw unsupported('That image could not be read');
      }
    } else if (type && (VIDEO_TYPES.has(type.mime) || type.mime === 'video/webm')) {
      if (data.length > caps.mediaBytes) throw tooBig(caps.mediaBytes);
      const mp4 = type.mime === 'video/webm' ? null : readMp4(data);
      if (type.mime !== 'video/webm' && !mp4) throw unsupported('That video could not be read');
      r = {
        kind: 'video_file',
        out: type.mime === 'video/webm' ? data : stripMp4Metadata(data),
        mime: type.mime,
        durationSec: mp4 ? Math.round(mp4.durationSec) : null,
      };
    } else if (type && AUDIO_TYPES.has(type.mime)) {
      if (data.length > caps.mediaBytes) throw tooBig(caps.mediaBytes);
      r = { kind: 'audio', out: data, mime: type.mime, durationSec: null };
    } else if (!type) {
      const ext = /\.([a-z0-9]+)$/i.exec(originalName)?.[1]?.toLowerCase() ?? '';
      const mime = TEXT_TYPES[ext];
      if (!mime) throw unsupported('Upload a PDF, Word, PowerPoint, text, image, video or audio file');
      if (data.length > 5 * 1024 * 1024) throw tooBig(5 * 1024 * 1024);
      if (data.includes(0) || !isUtf8(data)) throw unsupported('That text file is not UTF-8 text');
      r = doc('notes', data, `${mime}; charset=utf-8`);
    } else {
      throw unsupported('Upload a PDF, Word, PowerPoint, text, image, video or audio file');
    }
    const stored = await this.store(ownerId, 'study_material', r.out, r.mime, null, {
      ...(r.durationSec !== null ? { durationSec: r.durationSec } : {}),
    });
    return { ...stored, checksum, kind: r.kind, durationSec: r.durationSec };
  }

  /** A caption file (WebVTT or SRT) kept with its video; plain UTF-8 text only. */
  async storeStudyTranscript(ownerId: string, data: Buffer) {
    if (data.length > 2 * 1024 * 1024) throw unsupported('Caption files can be up to 2 MB');
    if (data.includes(0) || !isUtf8(data)) throw unsupported('Upload a WebVTT (.vtt) or SRT (.srt) file');
    return this.store(ownerId, 'study_transcript', data, 'text/vtt; charset=utf-8');
  }

  /** A video's poster frame (from ffmpeg), re-encoded like every other image. */
  async storeStudyThumbnail(ownerId: string, data: Buffer) {
    const out = await sharp(data, { limitInputPixels: 40_000_000, failOn: 'error' })
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return this.store(ownerId, 'study_thumbnail', out, 'image/webp');
  }

  // ── Signed links (owner decision Q9) ─────────────────────────────
  private mac(payload: string) {
    return createHmac('sha256', this.signingKey).update(payload).digest('base64url');
  }

  /**
   * A short-lived link to a file for `viewer`, minted only after their access is checked. It is
   * bound to the college, file, purpose, member and expiry, and access is checked again on every
   * request (`readSigned`), so revoking access takes effect at once.
   */
  async signedUrl(fileId: string, viewer: AuthState) {
    const f = await this.authorise(fileId, viewer);
    const exp = Math.floor(Date.now() / 1000) + SIGNED_TTL_SEC;
    const payload = Buffer.from(
      JSON.stringify({ t: String(f.tenantId), f: String(f._id), p: f.purpose, u: viewer.userId, e: exp }),
    ).toString('base64url');
    return {
      token: `${payload}.${this.mac(payload)}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  /** Verifies a signed link; null when it is forged, expired or for another college. */
  verifySigned(token: string, tenantId: string): { fileId: string; purpose: string; userId: string } | null {
    const [payload = '', mac = ''] = token.split('.');
    const want = Buffer.from(this.mac(payload));
    const got = Buffer.from(mac);
    if (!payload || want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try {
      const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
      if (p.t !== tenantId || typeof p.f !== 'string' || typeof p.u !== 'string' || typeof p.p !== 'string')
        return null;
      if (typeof p.e !== 'number' || p.e < Date.now() / 1000) return null;
      return { fileId: p.f, purpose: p.p, userId: p.u };
    } catch {
      return null;
    }
  }

  /** `ownerId` null: the college's own file (its logo). */
  private async store(
    ownerId: string | null,
    purpose: FilePurpose,
    data: Buffer,
    mime: string,
    deleteAfter: Date | null = null,
    extra: { durationSec?: number } = {},
  ) {
    const scan = await this.scanner.scan(data).catch((e: unknown) => {
      // Fail closed: no verdict, no storage.
      if (e instanceof ScannerUnavailableError)
        throw new AppError(
          503,
          ErrorCode.INTERNAL,
          'Uploads are paused while the file scanner is unavailable. Please try again shortly.',
        );
      throw e;
    });
    if (scan === 'infected') throw unsupported('This file was flagged by the malware scanner');
    const storageKey = newKey();
    await this.storage.put(storageKey, data);
    const doc = await FileModel.create({
      ownerId: ownerId ? new Types.ObjectId(ownerId) : null,
      purpose,
      mime,
      size: data.length,
      storageKey,
      sha256: createHash('sha256').update(data).digest('hex'),
      scanStatus: scan,
      deleteAfter,
      ...extra,
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
    const f = await this.authorise(fileId, viewer);
    const data = await this.storage.get(f.storageKey);
    if (!data) throw notFound('File');
    return { data, mime: f.mime, purpose: f.purpose, name: f.grantName };
  }

  /** The file record if `viewer` may read it (404 otherwise, like a missing file). */
  private async authorise(fileId: string, viewer: AuthState) {
    const f = await FileModel.findById(fileId).lean();
    if (!f) throw notFound('File');
    const isOwner = String(f.ownerId) === viewer.userId;
    const can = (p: Permission) => viewer.permissions.has(p);
    let name: string | null = null;
    let allowed =
      f.purpose === 'avatar' ||
      (f.purpose === 'id_card' && (isOwner || can('verification:review'))) ||
      // The uploader previews their own media before posting.
      ((f.purpose === 'post_media' || f.purpose === 'story_media' || f.purpose === 'referral_resume') &&
        isOwner);
    const resolver = this.resolvers.get(f.purpose);
    if (!allowed && resolver) {
      const grant = await resolver(String(f._id), viewer);
      allowed = !!grant;
      name = grant?.name ?? null;
    }
    if (!allowed) throw notFound('File');
    return { ...f, grantName: name };
  }

  /**
   * Shared study material outlives its uploader's account: the files stop belonging to the member
   * (so erasing them leaves the college's material in place) and keep their access rules.
   */
  async detach(fileIds: (string | Types.ObjectId)[]): Promise<void> {
    if (fileIds.length)
      await FileModel.updateMany(
        {
          _id: { $in: fileIds },
          purpose: { $in: ['study_material', 'study_thumbnail', 'study_transcript'] },
        },
        { $set: { ownerId: null } },
      );
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
