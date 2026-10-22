import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  DEFAULT_TAB,
  MATERIAL_MAX_MB,
  type MaterialDetailView,
  type MaterialLanguage,
  type MaterialTab,
  type MaterialType,
  type MaterialView,
  type MaterialVisibility,
  type PersonRef,
  type ProcessingStage,
  type materialLinkBody,
  type materialUpdateBody,
  type materialUploadFields,
  type materialsQuery,
  type materialReviewBody,
} from '@campuslink/shared';
import {
  ContentChunkModel,
  MaterialJobModel,
  MaterialModel,
  MaterialPageModel,
  VideoSegmentModel,
  type MaterialDoc,
} from './material.model.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { ErrorCode } from '@campuslink/shared';
import { plainText } from '../../lib/text.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { JobQueue } from '../../lib/jobs.js';
import { requireTenantId } from '../../lib/context.js';
import type { safeFetch } from '../../lib/safe-fetch.js';
import type { FilesService } from '../files/files.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { SubjectsService } from './subjects.service.js';
import type { AiSettingsService } from './ai-settings.service.js';
import { PROCESS_JOB, type MaterialPipeline } from './pipeline.js';
import { looksLikeCaptions, parseCaptions } from './extract/captions.js';
import { oembed, parseVideoLink } from './media/links.js';
import type { SubjectDoc } from './subject.model.js';
import type { AuthState } from '../../types.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const FORMER: PersonRef = { userId: '', name: 'Former member', avatarFileId: null };
/** Page text returned with a material for in-viewer search, up to this many characters. */
const PAGES_BUDGET = 1_500_000;

export interface MaterialsDeps {
  files: FilesService;
  subjects: SubjectsService;
  ai: AiSettingsService;
  profiles: ProfilesService;
  notifications: NotificationsService;
  jobs: JobQueue;
  fetcher: typeof safeFetch;
  pipeline: MaterialPipeline;
}

interface Access {
  subject: SubjectDoc;
  manage: boolean;
}

/**
 * The subject library: uploads and video links, versions, review of contributions, takedowns,
 * deletion, keyword search, and who may see each file. Every read goes through the subject's
 * readable filter first, so material of a subject a member does not take is a 404 everywhere.
 */
export class MaterialsService {
  /** Removes a material's vectors (the retrieval step registers it). */
  onRemoved: (materialId: Types.ObjectId) => Promise<void> = async () => undefined;
  /** Visibility changed (published, rejected, taken down): the retrieval step mirrors it. */
  onVisibility: (materialId: Types.ObjectId, visibility: MaterialVisibility) => Promise<void> = async () =>
    undefined;

  constructor(private readonly d: MaterialsDeps) {}

  // ── Access ─────────────────────────────
  private async access(viewer: AuthState, subjectId: string | Types.ObjectId): Promise<Access> {
    const subject = await this.d.subjects.readable(viewer, String(subjectId));
    return { subject, manage: this.d.subjects.canManage(viewer, subject) };
  }

  /** Published material of a readable subject; plus your own uploads; plus everything for managers. */
  private visible(viewer: AuthState, m: MaterialDoc, a: Access): boolean {
    if (a.manage) return true;
    if (m.uploaderId && String(m.uploaderId) === viewer.userId) return true;
    return m.visibility === 'published';
  }

  private async load(viewer: AuthState, id: string): Promise<{ m: MaterialDoc; a: Access }> {
    const m = await MaterialModel.findById(oid(id)).lean<MaterialDoc>();
    if (!m) throw notFound('Material');
    const a = await this.access(viewer, m.subjectId).catch(() => {
      throw notFound('Material');
    });
    if (!this.visible(viewer, m, a)) throw notFound('Material');
    return { m, a };
  }

  /** Uploader (while it is not taken down) or a manager of the subject. */
  private canEdit(viewer: AuthState, m: MaterialDoc, a: Access): boolean {
    if (a.manage) return true;
    return !!m.uploaderId && String(m.uploaderId) === viewer.userId && !m.takedown;
  }

  /** Who may add material to a subject, and whether it goes straight out or to review. */
  private async uploadRights(viewer: AuthState, a: Access): Promise<'publish' | 'review'> {
    if (this.d.subjects.canUpload(viewer, a.subject))
      return this.d.subjects.publishesDirectly(viewer) ? 'publish' : 'review';
    const settings = (await this.d.ai.runtime()).settings;
    if (a.subject.status === 'active' && settings.features.studentUploads) return 'review';
    throw forbidden();
  }

  private async checkTags(subjectId: Types.ObjectId, unitId: string | null, topicIds: string[]) {
    if (!unitId && !topicIds.length) return;
    const topics = await this.d.subjects.topicsOf(subjectId);
    const units = new Set(topics.map((t) => t.unitId));
    const known = new Set(topics.map((t) => t.id));
    if (unitId && !units.has(unitId) && !(await this.d.subjects.hasUnit(subjectId, unitId)))
      throw badRequest('That unit is not in this subject', [{ path: 'unitId', message: 'Unknown unit' }]);
    if (topicIds.some((t) => !known.has(t)))
      throw badRequest('A topic is not in this subject', [{ path: 'topicIds', message: 'Unknown topic' }]);
  }

  // ── Views ─────────────────────────────
  private async present(viewer: AuthState, rows: MaterialDoc[], a: Access): Promise<MaterialView[]> {
    const people = await this.d.profiles.refsFor(rows.flatMap((r) => (r.uploaderId ? [r.uploaderId] : [])));
    return rows.map((m) => ({
      id: String(m._id),
      subjectId: String(m.subjectId),
      title: m.title,
      description: m.description ?? '',
      type: m.type as MaterialType,
      category: m.category as MaterialTab,
      language: (m.language ?? 'en') as MaterialLanguage,
      mime: m.mime ?? null,
      size: m.size ?? 0,
      pageCount: m.pageCount ?? null,
      durationSec: m.durationSec ?? null,
      unitId: m.unitId ? String(m.unitId) : null,
      topicIds: (m.topicIds ?? []).map(String),
      visibility: m.visibility as MaterialVisibility,
      version: m.version,
      uploader: m.uploaderId ? (people.get(String(m.uploaderId)) ?? FORMER) : FORMER,
      stage: m.stage as ProcessingStage,
      progress: m.progress ?? 0,
      error: m.error ?? null,
      chunkCount: m.chunkCount ?? 0,
      hasTranscript: (m.transcriptSource ?? 'none') !== 'none',
      thumbnailFileId: m.thumbnailFileId ? String(m.thumbnailFileId) : null,
      link: m.link?.provider
        ? {
            provider: m.link.provider as 'youtube' | 'vimeo',
            url: m.link.url ?? '',
            embedUrl: m.link.embedUrl ?? '',
            author: m.link.author ?? '',
          }
        : null,
      reviewNote: a.manage || String(m.uploaderId) === viewer.userId ? (m.reviewNote ?? null) : null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      can: { edit: this.canEdit(viewer, m, a), review: a.manage },
    }));
  }

  async list(
    viewer: AuthState,
    subjectId: string,
    q: z.output<typeof materialsQuery>,
  ): Promise<MaterialView[]> {
    const a = await this.access(viewer, subjectId);
    const filter: Record<string, unknown> = { subjectId: a.subject._id };
    if (q.category) filter.category = q.category;
    if (q.unitId) filter.unitId = oid(q.unitId);
    if (q.topicId) filter.topicIds = oid(q.topicId);
    if (a.manage && q.status !== 'published')
      filter.visibility = q.status === 'in_review' ? 'in_review' : { $ne: 'archived' };
    else
      Object.assign(filter, {
        $or: [
          { visibility: 'published' },
          { uploaderId: oid(viewer.userId), visibility: { $in: ['draft', 'in_review'] } },
        ],
      });
    const rows = await MaterialModel.find(filter).sort({ createdAt: -1 }).limit(300).lean<MaterialDoc[]>();
    return this.present(viewer, rows, a);
  }

  async get(viewer: AuthState, id: string): Promise<MaterialDetailView> {
    const { m, a } = await this.load(viewer, id);
    const [view] = await this.present(viewer, [m], a);
    if (!view) throw notFound('Material');
    const [segments, pages] = await Promise.all([
      VideoSegmentModel.find({ materialId: m._id }).sort({ start: 1 }).limit(5000).lean(),
      MaterialPageModel.find({ materialId: m._id }).sort({ page: 1 }).select('page text').lean(),
    ]);
    let budget = PAGES_BUDGET;
    const kept: { page: number; text: string }[] = [];
    for (const p of pages) {
      if ((budget -= p.text.length) < 0) break;
      kept.push({ page: p.page, text: p.text });
    }
    return {
      ...view,
      chapters: (m.chapters ?? []).map((c) => ({ at: c.at ?? 0, title: c.title ?? '' })),
      transcript: segments.map((s) => ({ start: s.start, end: s.end, text: s.text })),
      pages: kept,
    };
  }

  /** A short-lived link to the material's file (access checked now and on every request). */
  async fileLink(viewer: AuthState, id: string) {
    const { m } = await this.load(viewer, id);
    if (!m.fileId) throw notFound('File');
    const s = await this.d.files.signedUrl(String(m.fileId), viewer);
    return { url: `/api/v1/files/s/${s.token}`, expiresAt: s.expiresAt };
  }

  /** Files of purpose `study_*`: readable by whoever may see the material they belong to. */
  async fileAccess(fileId: string, viewer: AuthState): Promise<{ name: string } | null> {
    const m = await MaterialModel.findOne({
      $or: [{ fileId: oid(fileId) }, { thumbnailFileId: oid(fileId) }],
    }).lean<MaterialDoc>();
    if (!m) return null;
    try {
      const a = await this.access(viewer, m.subjectId);
      return this.visible(viewer, m, a) ? { name: m.title } : null;
    } catch {
      return null;
    }
  }

  // ── Writes ─────────────────────────────
  private async enqueue(m: { _id: Types.ObjectId; version: number }) {
    await MaterialJobModel.updateOne(
      { materialId: m._id, version: m.version },
      { $set: { stage: 'uploaded', progress: 0, error: null, dead: false }, $setOnInsert: { attempts: 0 } },
      { upsert: true },
    );
    await this.d.jobs.enqueue(
      PROCESS_JOB,
      { tenantId: String(requireTenantId()), materialId: String(m._id), version: m.version },
      { jobId: `study-${String(m._id)}-v${m.version}-${Date.now()}` },
    );
  }

  private async duplicate(subjectId: Types.ObjectId, checksum: string, except?: Types.ObjectId) {
    const dup = await MaterialModel.findOne({
      subjectId,
      checksum,
      visibility: { $ne: 'archived' },
      ...(except ? { _id: { $ne: except } } : {}),
    })
      .select('_id title')
      .lean<{ _id: Types.ObjectId; title: string }>();
    if (dup)
      throw new AppError(409, ErrorCode.CONFLICT, `This file is already in the library as “${dup.title}”`, {
        materialId: String(dup._id),
      });
  }

  private async afterCreate(viewer: AuthState, m: MaterialDoc, a: Access, meta: RequestMetaLite) {
    await audit.record(
      {
        action: 'study.material_added',
        actorId: viewer.userId,
        targetType: 'material',
        targetId: String(m._id),
        meta: {
          subjectId: String(m.subjectId),
          type: m.type,
          rightsAttested: true,
          visibility: m.visibility,
        },
      },
      meta,
    );
    if (m.visibility === 'in_review') {
      const who = (await this.d.profiles.refsFor([viewer.userId])).get(viewer.userId)?.name ?? '';
      for (const owner of a.subject.ownerIds ?? [])
        await this.d.notifications.notify(owner, 'material_review', {
          materialId: String(m._id),
          subjectId: String(m.subjectId),
          title: m.title,
          name: who,
        });
    }
    await this.enqueue(m);
    const [view] = await this.present(viewer, [m], a);
    return view;
  }

  /** An uploaded file (sniffed, scanned and sanitised by FilesService), queued for processing. */
  async upload(
    viewer: AuthState,
    fields: z.output<typeof materialUploadFields>,
    file: { buffer: Buffer; originalname: string } | undefined,
    meta: RequestMetaLite,
  ) {
    if (!file?.buffer.length) throw badRequest('Choose a file to upload');
    const a = await this.access(viewer, fields.subjectId);
    const mode = await this.uploadRights(viewer, a);
    const unitId = fields.unitId || null;
    await this.checkTags(a.subject._id, unitId, fields.topicIds);
    await this.duplicate(a.subject._id, createHash('sha256').update(file.buffer).digest('hex'));
    const stored = await this.d.files.storeStudyMaterial(viewer.userId, file.buffer, file.originalname, {
      documentBytes: MATERIAL_MAX_MB.document * 1048576,
      mediaBytes: MATERIAL_MAX_MB.media * 1048576,
    });
    const type: MaterialType = stored.kind;
    const fallback = plainText(file.originalname.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')).slice(
      0,
      160,
    );
    const m = await MaterialModel.create({
      subjectId: a.subject._id,
      title: plainText(fields.title).slice(0, 160) || fallback || 'Untitled',
      description: plainText(fields.description),
      type,
      category: fields.category ?? DEFAULT_TAB[type],
      language: fields.language,
      uploaderId: oid(viewer.userId),
      fileId: oid(stored.id),
      mime: stored.mime,
      size: stored.size,
      checksum: stored.checksum,
      durationSec: stored.durationSec,
      unitId: unitId ? oid(unitId) : null,
      topicIds: fields.topicIds.map(oid),
      visibility: mode === 'publish' ? 'published' : 'in_review',
      versions: [
        {
          version: 1,
          checksum: stored.checksum,
          size: stored.size,
          uploaderId: oid(viewer.userId),
          at: new Date(),
        },
      ],
      rightsAttestedAt: new Date(),
    });
    return this.afterCreate(viewer, m.toObject() as MaterialDoc, a, meta);
  }

  /** A YouTube or Vimeo link: metadata through official oEmbed only; the video is never downloaded. */
  async addLink(viewer: AuthState, body: z.output<typeof materialLinkBody>, meta: RequestMetaLite) {
    const link = parseVideoLink(body.url);
    if (!link)
      throw badRequest('Paste a YouTube or Vimeo video link', [{ path: 'url', message: 'Not a video link' }]);
    const a = await this.access(viewer, body.subjectId);
    const mode = await this.uploadRights(viewer, a);
    await this.checkTags(a.subject._id, body.unitId, body.topicIds);
    const checksum = createHash('sha256').update(`${link.provider}:${link.videoId}`).digest('hex');
    await this.duplicate(a.subject._id, checksum);
    const info = await oembed(this.d.fetcher, link).catch((e: unknown) => {
      if (e instanceof Error && e.message === 'not_found')
        throw badRequest('We couldn’t find that video (it may be private or removed)', [
          { path: 'url', message: 'Not found' },
        ]);
      return { title: '', author: '', durationSec: null };
    });
    const m = await MaterialModel.create({
      subjectId: a.subject._id,
      title: plainText(body.title).slice(0, 160) || info.title || link.url,
      description: plainText(body.description),
      type: 'video_link',
      category: body.category,
      language: body.language,
      uploaderId: oid(viewer.userId),
      checksum,
      durationSec: info.durationSec,
      unitId: body.unitId ? oid(body.unitId) : null,
      topicIds: body.topicIds.map(oid),
      visibility: mode === 'publish' ? 'published' : 'in_review',
      link: { ...link, author: info.author },
      chapters: body.chapters.map((c) => ({ at: c.at, title: plainText(c.title) })),
      rightsAttestedAt: new Date(),
    });
    return this.afterCreate(viewer, m.toObject() as MaterialDoc, a, meta);
  }

  /** Captions for a video (WebVTT or SRT): they become its transcript and it is re-indexed. */
  async setTranscript(
    viewer: AuthState,
    id: string,
    file: { buffer: Buffer } | undefined,
    meta: RequestMetaLite,
  ) {
    const { m, a } = await this.load(viewer, id);
    if (!this.canEdit(viewer, m, a)) throw forbidden();
    if (!['video_file', 'video_link', 'audio'].includes(m.type))
      throw badRequest('Only videos and audio have transcripts');
    if (!file?.buffer.length) throw badRequest('Choose a caption file');
    const raw = file.buffer.toString('utf8');
    if (!looksLikeCaptions(raw)) throw badRequest('Upload a WebVTT (.vtt) or SRT (.srt) caption file');
    const segments = parseCaptions(raw);
    if (!segments.length) throw badRequest('That caption file has no captions');
    await this.d.files.storeStudyTranscript(viewer.userId, file.buffer);
    await VideoSegmentModel.deleteMany({ materialId: m._id });
    await VideoSegmentModel.insertMany(
      segments.map((s, index) => ({
        subjectId: m.subjectId,
        materialId: m._id,
        index,
        start: s.start,
        end: s.end,
        text: plainText(s.text),
      })),
    );
    const last = segments.at(-1);
    await MaterialModel.updateOne(
      { _id: m._id },
      {
        $set: {
          transcriptSource: 'uploaded',
          ...(m.durationSec ? {} : last ? { durationSec: Math.round(last.end) } : {}),
        },
      },
    );
    await audit.record(
      { action: 'study.transcript_added', actorId: viewer.userId, targetType: 'material', targetId: id },
      meta,
    );
    await this.enqueue(m);
    return this.get(viewer, id);
  }

  /** A new version replaces the file; the old one is removed and the material re-indexed. */
  async newVersion(
    viewer: AuthState,
    id: string,
    file: { buffer: Buffer; originalname: string } | undefined,
    meta: RequestMetaLite,
  ) {
    const { m, a } = await this.load(viewer, id);
    if (!this.canEdit(viewer, m, a) || !m.fileId) throw forbidden();
    if (!file?.buffer.length) throw badRequest('Choose a file to upload');
    await this.duplicate(m.subjectId, createHash('sha256').update(file.buffer).digest('hex'), m._id);
    const stored = await this.d.files.storeStudyMaterial(viewer.userId, file.buffer, file.originalname, {
      documentBytes: MATERIAL_MAX_MB.document * 1048576,
      mediaBytes: MATERIAL_MAX_MB.media * 1048576,
    });
    if (stored.kind !== m.type) {
      await this.d.files.remove(stored.id);
      throw badRequest('A new version must be the same kind of file');
    }
    const version = m.version + 1;
    await MaterialModel.updateOne(
      { _id: m._id, version: m.version },
      {
        $set: {
          fileId: oid(stored.id),
          mime: stored.mime,
          size: stored.size,
          checksum: stored.checksum,
          version,
          stage: 'uploaded',
          progress: 0,
          error: null,
          ...(stored.durationSec ? { durationSec: stored.durationSec } : {}),
          thumbnailFileId: null,
          ...(m.transcriptSource === 'generated' ? { transcriptSource: 'none' } : {}),
        },
        $push: {
          versions: {
            version,
            checksum: stored.checksum,
            size: stored.size,
            uploaderId: oid(viewer.userId),
            at: new Date(),
          },
        },
      },
    );
    await this.d.files.remove(m.fileId);
    if (m.thumbnailFileId) await this.d.files.remove(m.thumbnailFileId);
    await audit.record(
      {
        action: 'study.material_version',
        actorId: viewer.userId,
        targetType: 'material',
        targetId: id,
        meta: { version },
      },
      meta,
    );
    await this.enqueue({ _id: m._id, version });
    return this.get(viewer, id);
  }

  async reprocess(viewer: AuthState, id: string) {
    const { m, a } = await this.load(viewer, id);
    if (!this.canEdit(viewer, m, a)) throw forbidden();
    await MaterialModel.updateOne({ _id: m._id }, { $set: { stage: 'uploaded', progress: 0, error: null } });
    await this.enqueue(m);
    return this.get(viewer, id);
  }

  async update(viewer: AuthState, id: string, body: z.output<typeof materialUpdateBody>) {
    const { m, a } = await this.load(viewer, id);
    if (!this.canEdit(viewer, m, a)) throw forbidden();
    const unitId = body.unitId === undefined ? (m.unitId ? String(m.unitId) : null) : body.unitId;
    const topicIds = body.topicIds ?? (m.topicIds ?? []).map(String);
    await this.checkTags(m.subjectId, unitId, topicIds);
    const set: Record<string, unknown> = {};
    if (body.title !== undefined) set.title = plainText(body.title).slice(0, 160) || m.title;
    if (body.description !== undefined) set.description = plainText(body.description);
    if (body.category) set.category = body.category;
    if (body.language) set.language = body.language;
    if (body.unitId !== undefined) set.unitId = body.unitId ? oid(body.unitId) : null;
    if (body.topicIds) set.topicIds = body.topicIds.map(oid);
    if (body.chapters) set.chapters = body.chapters.map((c) => ({ at: c.at, title: plainText(c.title) }));
    await MaterialModel.updateOne({ _id: m._id }, { $set: set });
    // Tags, chapters or the title change what is indexed: re-chunk.
    if (body.unitId !== undefined || body.topicIds || body.chapters || body.title || body.description)
      await this.enqueue(m);
    return this.get(viewer, id);
  }

  private async setVisibility(
    m: MaterialDoc,
    visibility: MaterialVisibility,
    extra: Record<string, unknown> = {},
  ) {
    await MaterialModel.updateOne({ _id: m._id }, { $set: { visibility, ...extra } });
    await ContentChunkModel.updateMany({ materialId: m._id }, { $set: { visibility } });
    await this.onVisibility(m._id, visibility);
  }

  /** Owners and admins publish or send back a contribution (the uploader is told). */
  async review(
    viewer: AuthState,
    id: string,
    body: z.output<typeof materialReviewBody>,
    meta: RequestMetaLite,
  ) {
    const { m, a } = await this.load(viewer, id);
    if (!a.manage) throw forbidden();
    if (m.visibility !== 'in_review') throw conflict('This material is not waiting for review');
    const publish = body.action === 'publish';
    await this.setVisibility(m, publish ? 'published' : 'draft', {
      reviewNote: body.reason ? plainText(body.reason) : null,
      reviewedBy: oid(viewer.userId),
    });
    await audit.record(
      {
        action: publish ? 'study.material_published' : 'study.material_rejected',
        actorId: viewer.userId,
        targetType: 'material',
        targetId: id,
      },
      meta,
    );
    if (m.uploaderId)
      await this.d.notifications.notify(m.uploaderId, 'material_reviewed', {
        materialId: id,
        subjectId: String(m.subjectId),
        title: m.title,
        decision: publish ? 'published' : 'not_published',
      });
    return this.get(viewer, id);
  }

  /** Copyright or policy takedown by an owner or admin: hidden from everyone, kept for the record. */
  async takedown(viewer: AuthState, id: string, reason: string, meta: RequestMetaLite) {
    const { m, a } = await this.load(viewer, id);
    if (!a.manage) throw forbidden();
    await this.setVisibility(m, 'archived', {
      takedown: { reason: plainText(reason), by: oid(viewer.userId), at: new Date() },
    });
    await audit.record(
      {
        action: 'study.material_taken_down',
        actorId: viewer.userId,
        targetType: 'material',
        targetId: id,
        meta: { reason: plainText(reason).slice(0, 200) },
      },
      meta,
    );
    return this.get(viewer, id);
  }

  private async purge(m: MaterialDoc) {
    await ContentChunkModel.deleteMany({ materialId: m._id });
    await VideoSegmentModel.deleteMany({ materialId: m._id });
    await MaterialPageModel.deleteMany({ materialId: m._id });
    await MaterialJobModel.deleteMany({ materialId: m._id });
    await this.onRemoved(m._id);
    for (const f of [m.fileId, m.thumbnailFileId]) if (f) await this.d.files.remove(f);
    await MaterialModel.deleteOne({ _id: m._id });
  }

  /** Deletes the material everywhere: file, thumbnail, pages, chunks, vectors and transcript. */
  async remove(viewer: AuthState, id: string, meta: RequestMetaLite) {
    const { m, a } = await this.load(viewer, id);
    if (!this.canEdit(viewer, m, a)) throw forbidden();
    await this.purge(m);
    await audit.record(
      {
        action: 'study.material_deleted',
        actorId: viewer.userId,
        targetType: 'material',
        targetId: id,
        meta: { subjectId: String(m.subjectId) },
      },
      meta,
    );
  }

  /** Called when a syllabus loses topics: their tags come off material and chunks. */
  async detachTopics(subjectId: Types.ObjectId, topicIds: Types.ObjectId[]) {
    await MaterialModel.updateMany({ subjectId }, { $pull: { topicIds: { $in: topicIds } } });
    await ContentChunkModel.updateMany({ subjectId }, { $pull: { topicIds: { $in: topicIds } } });
    await VideoSegmentModel.updateMany({ subjectId }, { $pull: { topicIds: { $in: topicIds } } });
  }

  async counts(subjectIds: Types.ObjectId[]): Promise<Map<string, number>> {
    const rows = await MaterialModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { subjectId: { $in: subjectIds }, visibility: 'published' } },
      { $group: { _id: '$subjectId', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.n]));
  }

  // ── Keyword search (works with no AI provider) ─────────────────────────────
  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    const rows = await MaterialModel.find({ uploaderId: oid(userId) })
      .select('title type subjectId visibility createdAt rightsAttestedAt')
      .lean<MaterialDoc[]>();
    return rows.map((m) => ({
      title: m.title,
      type: m.type,
      subjectId: String(m.subjectId),
      visibility: m.visibility,
      uploadedAt: m.createdAt,
      rightsAttestedAt: m.rightsAttestedAt,
    }));
  }

  /**
   * Published material stays with the college as "Former member"'s (shared content, files detached
   * from the account); drafts and material still in review are deleted with their files and vectors.
   */
  async eraseFor(userId: string) {
    const u = oid(userId);
    const rows = await MaterialModel.find({ uploaderId: u }).lean<MaterialDoc[]>();
    for (const m of rows) {
      if (m.visibility === 'published' || m.visibility === 'archived') {
        await this.d.files.detach([m.fileId, m.thumbnailFileId].filter((x): x is Types.ObjectId => !!x));
        await MaterialModel.updateOne({ _id: m._id }, { $set: { uploaderId: null } });
      } else await this.purge(m);
    }
    await MaterialModel.updateMany({ reviewedBy: u }, { $set: { reviewedBy: null } });
  }
}

/** Up to 240 characters around the first query word found (plain text). */
export function snippet(text: string, q: string): string {
  const words = q
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const lower = text.toLowerCase();
  const at =
    words
      .map((w) => lower.indexOf(w))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 80);
  const out = text
    .slice(start, start + 240)
    .replace(/\s+/g, ' ')
    .trim();
  return `${start > 0 ? '…' : ''}${out}${start + 240 < text.length ? '…' : ''}`;
}
