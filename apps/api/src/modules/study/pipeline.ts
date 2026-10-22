import { Types } from 'mongoose';
import type { ProcessingStage } from '@campuslink/shared';
import {
  ContentChunkModel,
  MaterialJobModel,
  MaterialModel,
  MaterialPageModel,
  VideoSegmentModel,
  type MaterialDoc,
} from './material.model.js';
import { extractPdf, SCANNED_PAGE_CHARS, type ExtractedPage } from './extract/pdf.js';
import { extractDocx, extractPptx } from './extract/office.js';
import {
  chunkPages,
  chunkSegments,
  cleanPages,
  neutraliseInstructions,
  tagTopics,
  type Chunk,
} from './extract/chunker.js';
import type { Segment } from './extract/captions.js';
import type { MediaTools } from './media/tools.js';
import type { OcrProvider } from './media/ocr.js';
import { OpenAiTranscriber, type TranscriptionProvider } from './media/transcribe.js';
import { requireTenantId } from '../../lib/context.js';
import type { TenantJob } from '../../lib/jobs.js';
import type { FilesService } from '../files/files.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { RealtimeGateway } from '../../http/realtime.js';
import type { SubjectsService } from './subjects.service.js';
import type { AiSettingsService } from './ai-settings.service.js';

export const PROCESS_JOB = 'study.process';
/** Attempts before a run is dead-lettered (the queue retries with exponential back-off). */
export const MAX_ATTEMPTS = 3;

export interface PipelineDeps {
  files: FilesService;
  subjects: SubjectsService;
  ai: AiSettingsService;
  notifications: NotificationsService;
  realtime: RealtimeGateway;
  media: MediaTools;
  ocr: OcrProvider;
  /** The platform's local Whisper service, when configured. */
  whisper: TranscriptionProvider | null;
}

/** A failure we can explain to the uploader (anything else is reported generically). */
export class PipelineError extends Error {}

const STAGE_PROGRESS: Record<ProcessingStage, number> = {
  uploaded: 0,
  scanning: 5,
  extracting: 15,
  ocr: 35,
  transcribing: 45,
  chunking: 70,
  embedding: 85,
  indexed: 100,
  failed: 100,
};

/**
 * The ingestion pipeline for one version of one material: scan → extract (text layer, Office XML,
 * plain text) → OCR scanned pages → transcribe audio → clean, chunk and tag → embed (step 3) →
 * indexed. Each run rebuilds the material's pages, chunks and segments from scratch, so a retry or
 * a re-process is idempotent; a run for an outdated version does nothing.
 */
export class MaterialPipeline {
  /** Embeds new chunks (registered by the retrieval step); the default leaves them pending. */
  embed: (materialId: Types.ObjectId) => Promise<void> = async () => undefined;

  constructor(private readonly d: PipelineDeps) {}

  private async stage(
    m: MaterialDoc,
    stage: ProcessingStage,
    extra: { error?: string | null; chunkCount?: number } = {},
  ) {
    const progress = STAGE_PROGRESS[stage];
    await MaterialModel.updateOne(
      { _id: m._id, version: m.version },
      {
        $set: {
          stage,
          progress,
          error: extra.error ?? null,
          ...(extra.chunkCount !== undefined ? { chunkCount: extra.chunkCount } : {}),
        },
      },
    );
    await MaterialJobModel.updateOne(
      { materialId: m._id, version: m.version },
      {
        $set: { stage, progress, error: extra.error ?? null },
        $push: { history: { stage, at: new Date() } },
      },
    );
    if (m.uploaderId)
      this.d.realtime.emitToUser(requireTenantId(), String(m.uploaderId), 'study:material', {
        materialId: String(m._id),
        stage,
        progress,
        error: extra.error ?? null,
      });
  }

  async run(data: TenantJob): Promise<void> {
    const materialId = new Types.ObjectId(String(data.materialId));
    const version = Number(data.version);
    const m = await MaterialModel.findById(materialId).lean<MaterialDoc>();
    // Deleted, or a newer version superseded this run: nothing to do.
    if (!m || m.version !== version || m.visibility === 'archived') return;
    const job = await MaterialJobModel.findOneAndUpdate(
      { materialId, version },
      { $inc: { attempts: 1 }, $set: { startedAt: new Date(), dead: false } },
      { upsert: true, returnDocument: 'after' },
    ).lean();
    try {
      await this.process(m);
      await MaterialJobModel.updateOne({ materialId, version }, { $set: { finishedAt: new Date() } });
    } catch (e) {
      const message = e instanceof PipelineError ? e.message : 'Processing failed unexpectedly';
      const last = (job?.attempts ?? 1) >= MAX_ATTEMPTS || e instanceof PipelineError;
      if (!last) {
        await MaterialJobModel.updateOne({ materialId, version }, { $set: { error: message } });
        throw e; // the queue retries with back-off
      }
      await MaterialJobModel.updateOne(
        { materialId, version },
        { $set: { dead: true, finishedAt: new Date() } },
      );
      await this.stage(m, 'failed', { error: message });
      if (m.uploaderId)
        await this.d.notifications.notify(m.uploaderId, 'material_failed', {
          materialId: String(m._id),
          subjectId: String(m.subjectId),
          title: m.title,
        });
    }
  }

  private async process(m: MaterialDoc) {
    const ai = await this.d.ai.runtime();
    await this.stage(m, 'scanning');
    // Files were scanned (fail-closed) before they were stored; links have no file.
    const data = m.fileId ? await this.d.files.read(String(m.fileId)) : null;
    let pages: ExtractedPage[] = [];
    let ocrPages: number[] = [];
    let segments: Segment[] | null = null;
    let note: string | null = null;

    await this.stage(m, 'extracting');
    if (data) {
      if (m.type === 'pdf') {
        const r = await extractPdf(data).catch(() => {
          throw new PipelineError('The PDF could not be read');
        });
        pages = r.pages;
        await MaterialModel.updateOne({ _id: m._id }, { $set: { pageCount: r.pageCount } });
        ocrPages = pages
          .filter((p) => p.text.replace(/\s/g, '').length < SCANNED_PAGE_CHARS)
          .map((p) => p.page);
      } else if (m.type === 'doc' || m.type === 'slides') {
        const r = (() => {
          try {
            return m.type === 'doc' ? extractDocx(data) : extractPptx(data);
          } catch {
            throw new PipelineError(
              m.type === 'doc' ? 'The document could not be read' : 'The slides could not be read',
            );
          }
        })();
        pages = r.pages;
        await MaterialModel.updateOne({ _id: m._id }, { $set: { pageCount: r.pageCount } });
      } else if (m.type === 'notes') {
        pages = [{ page: 1, text: data.toString('utf8'), headings: [] }];
      } else if (m.type === 'image') {
        pages = [{ page: 1, text: '', headings: [] }];
        ocrPages = [1];
      } else if (m.type === 'video_file' || m.type === 'audio') {
        const probe = m.durationSec ? { durationSec: m.durationSec } : await this.d.media.probe(data);
        const set: Record<string, unknown> = {};
        if (probe.durationSec) set.durationSec = probe.durationSec;
        if (m.type === 'video_file' && !m.thumbnailFileId && m.uploaderId) {
          const frame = await this.d.media.thumbnail(data, Math.min(5, (probe.durationSec ?? 3) / 3));
          if (frame) {
            const thumb = await this.d.files
              .storeStudyThumbnail(String(m.uploaderId), frame)
              .catch(() => null);
            if (thumb) set.thumbnailFileId = new Types.ObjectId(thumb.id);
          }
        }
        if (Object.keys(set).length) await MaterialModel.updateOne({ _id: m._id }, { $set: set });
      }
    }

    if (ocrPages.length) {
      await this.stage(m, 'ocr');
      if (!ai.settings.features.ocr || !(await this.d.ocr.available())) {
        if (pages.every((p) => !p.text.trim()))
          note = 'No text found: scanned pages need OCR, which is not set up';
      } else if (data) {
        const images = m.type === 'image' ? [data] : await this.d.media.pdfPages(data, ocrPages);
        for (const [i, n] of ocrPages.entries()) {
          const img = images[i];
          if (!img?.length) continue;
          const text = await this.d.ocr.recognise(img).catch(() => '');
          const page = pages.find((p) => p.page === n);
          if (page && text) page.text = text;
        }
      }
    }

    if (m.type === 'video_file' || m.type === 'audio' || m.type === 'video_link') {
      const stored = await VideoSegmentModel.find({ materialId: m._id }).sort({ start: 1 }).lean();
      if (m.transcriptSource === 'uploaded' && stored.length)
        segments = stored.map((s) => ({ start: s.start, end: s.end, text: s.text }));
      else if (data && m.type !== 'video_link' && ai.settings.features.transcription) {
        await this.stage(m, 'transcribing');
        const transcriber = this.transcriber(ai);
        if (transcriber) {
          const audio = await this.d.media.audio(data);
          if (audio) {
            segments = await transcriber
              .transcribe(audio, m.language === 'other' ? null : m.language)
              .catch(() => null);
            if (segments?.length)
              await MaterialModel.updateOne({ _id: m._id }, { $set: { transcriptSource: 'generated' } });
          }
        }
        if (!segments?.length)
          note = 'No transcript yet: upload captions (.vtt or .srt) so students can jump to topics';
      }
    }

    await this.stage(m, 'chunking');
    const topics = await this.d.subjects.topicsOf(m.subjectId);
    let chunks: Chunk[];
    const clean = cleanPages(pages);
    const chapters = (m.chapters ?? []).map((c) => ({ at: c.at ?? 0, title: c.title ?? '' }));
    if (segments?.length) chunks = chunkSegments(segments, chapters);
    else if (clean.some((p) => p.text.trim())) chunks = chunkPages(clean);
    else chunks = [];
    // Every material is findable by its title, description and chapters, even without text.
    const meta = [m.title, m.description, ...(m.chapters ?? []).map((c) => c.title)]
      .filter(Boolean)
      .join('\n');
    if (!chunks.length && meta)
      chunks = chunkPages([{ page: 1, text: neutraliseInstructions(meta), headings: [] }]).map((c) => ({
        ...c,
        page: null,
      }));

    const tagged = (c: Chunk) => {
      const auto = tagTopics(c.text, c.heading, topics);
      const all = [...new Set([...auto, ...(m.topicIds ?? []).map(String)])];
      const unit = m.unitId ? String(m.unitId) : (topics.find((t) => t.id === all[0])?.unitId ?? null);
      return {
        topicIds: all.map((id) => new Types.ObjectId(id)),
        unitId: unit ? new Types.ObjectId(unit) : null,
      };
    };
    await ContentChunkModel.deleteMany({ materialId: m._id });
    await MaterialPageModel.deleteMany({ materialId: m._id });
    if (clean.length)
      await MaterialPageModel.insertMany(
        clean.map((p) => ({ materialId: m._id, page: p.page, text: p.text, ocr: ocrPages.includes(p.page) })),
      );
    if (segments?.length && m.transcriptSource !== 'uploaded') {
      await VideoSegmentModel.deleteMany({ materialId: m._id });
      await VideoSegmentModel.insertMany(
        segments.map((s, index) => ({ subjectId: m.subjectId, materialId: m._id, index, ...s })),
      );
    }
    if (segments?.length) {
      // Chapter and topic tags on each timed segment, for `/videos` deep links.
      const chapterAt = (t: number) =>
        [...(m.chapters ?? [])].reverse().find((c) => (c.at ?? 0) <= t)?.title ?? '';
      const segs = await VideoSegmentModel.find({ materialId: m._id }).select('_id start text').lean();
      for (const s of segs)
        await VideoSegmentModel.updateOne(
          { _id: s._id },
          {
            $set: {
              chapter: chapterAt(s.start),
              topicIds: tagTopics(s.text, '', topics).map((id) => new Types.ObjectId(id)),
            },
          },
        );
    }
    // A review may have published (or a takedown hidden) the material while it was processing.
    const visibility =
      (await MaterialModel.findById(m._id).select('visibility').lean<{ visibility: string }>())?.visibility ??
      m.visibility;
    if (chunks.length)
      await ContentChunkModel.insertMany(
        chunks.map((c) => ({
          subjectId: m.subjectId,
          materialId: m._id,
          version: m.version,
          index: c.index,
          text: c.text,
          heading: c.heading,
          page: c.page,
          startSec: c.startSec,
          endSec: c.endSec,
          tokenCount: c.tokenCount,
          contentHash: c.contentHash,
          visibility,
          ...tagged(c),
        })),
      );

    await this.stage(m, 'embedding', { chunkCount: chunks.length });
    await this.embed(m._id);

    await this.stage(m, 'indexed', { chunkCount: chunks.length, error: note });
    if (m.uploaderId)
      await this.d.notifications.notify(m.uploaderId, 'material_ready', {
        materialId: String(m._id),
        subjectId: String(m.subjectId),
        title: m.title,
      });
  }

  /** The platform's Whisper service, else OpenAI with the college's key (consent given), else none. */
  private transcriber(ai: Awaited<ReturnType<AiSettingsService['runtime']>>): TranscriptionProvider | null {
    if (this.d.whisper) return this.d.whisper;
    const conn = this.d.ai.openAiConnection(ai);
    return conn ? new OpenAiTranscriber(conn) : null;
  }
}
