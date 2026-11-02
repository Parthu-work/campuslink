import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  NON_LATIN_SCRIPT,
  RESUMES_PER_MEMBER,
  resumeContent,
  type AtsReport,
  type ResumeCommentView,
  type ResumeContent,
  type ResumeSummaryView,
  type ResumeView,
  type RewriteView,
  type atsCheckBody,
  type resumeCommentBody,
  type resumeCreateBody,
  type resumeUpdateBody,
  type rewriteBody,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { requireTenantId } from '../../lib/context.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { Logger } from '../../lib/logger.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import { plainText } from '../../lib/text.js';
import type { Removal } from '../moderation/moderation.service.js';
import type { AiTasksService } from '../ai-tasks/ai-tasks.service.js';
import type { FilesService } from '../files/files.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import { findTenantById } from '../tenants/tenant.cache.js';
import { UserModel } from '../auth/user.model.js';
import { ResumeCommentModel, ResumeModel, type ResumeCommentDoc, type ResumeDoc } from './resume.model.js';
import { renderResumePdf } from './resume-pdf.js';
import { atsScore, bulletTips, ruleRewrites, addsNumbers, resumeText } from './ats.js';
import { gapsTask, missingGaps, rewriteTask } from './resume-tasks.js';

export const RESUME_RENDER_JOB = 'resumes.render';

export interface ResumesDeps {
  files: FilesService;
  profiles: ProfilesService;
  ai: AiTasksService;
  jobs: JobQueue;
  notifications: NotificationsService;
  logger: Logger;
  /** The member's academic facts (branch, CGPA) for the prefill, from placements. */
  academics: (userId: string) => Promise<{ cgpa: number | null } | null>;
  /** Roadmaps the member finished, from roadmaps (the prefill's certificates). */
  finishedRoadmaps: (userId: string) => Promise<{ title: string; at: Date }[]>;
  /** A drive's role and description, for an ATS check against it (null: not visible to them). */
  driveText: (viewer: AuthState, driveId: string) => Promise<string | null>;
  /** The viewer reviews this résumé: a résumé-review request to them about it, open or done. */
  isReviewer: (viewer: AuthState, resumeId: string) => Promise<boolean>;
}

const oid = (id: string) => new Types.ObjectId(id);
const month = (d: Date) => d.toISOString().slice(0, 7);

/**
 * Résumés (prompt 2, G2): several per member, edited as JSON Resume-shaped content, rendered as an
 * ATS-friendly PDF in a job (again on download when stale), checked against a role, improved bullet
 * by bullet through the shared AI layer, reviewed by an alumnus through a résumé-review request, and
 * attached to drive registrations as a copy of the current PDF.
 */
export class ResumesService {
  /** Set by the app: records product events after confirmed writes (B9). */
  track: Track = noTrack;

  constructor(private readonly d: ResumesDeps) {}

  // ── Reading ─────────────────────────────

  private summary(r: ResumeDoc): ResumeSummaryView {
    return {
      id: String(r._id),
      title: r.title,
      template: r.template,
      version: r.version,
      atsScore: r.atsReport?.score ?? null,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async list(viewer: AuthState): Promise<ResumeSummaryView[]> {
    const rows = await ResumeModel.find({ userId: oid(viewer.userId) })
      .sort({ updatedAt: -1 })
      .lean<ResumeDoc[]>();
    return rows.map((r) => this.summary(r));
  }

  /** The owner's résumé, or one the viewer was asked to review; anything else is not found. */
  private async readable(viewer: AuthState, id: string): Promise<{ r: ResumeDoc; mine: boolean }> {
    const r = await ResumeModel.findById(id).lean<ResumeDoc>();
    if (!r) throw notFound('Résumé');
    if (String(r.userId) === viewer.userId) return { r, mine: true };
    if (await this.d.isReviewer(viewer, id)) return { r, mine: false };
    throw notFound('Résumé');
  }

  private async owned(viewer: AuthState, id: string): Promise<ResumeDoc> {
    const r = await ResumeModel.findOne({ _id: id, userId: oid(viewer.userId) }).lean<ResumeDoc>();
    if (!r) throw notFound('Résumé');
    return r;
  }

  async get(viewer: AuthState, id: string): Promise<ResumeView> {
    const { r, mine } = await this.readable(viewer, id);
    const owner = (await this.d.profiles.refsFor([r.userId])).get(String(r.userId));
    return {
      ...this.summary(r),
      content: r.content,
      atsReport: r.atsReport,
      mine,
      owner: { id: String(r.userId), name: owner?.name ?? '' },
    };
  }

  /** Does this member own this résumé (a review request may name only one of theirs)? */
  async owns(userId: string, resumeId: string): Promise<boolean> {
    return !!(await ResumeModel.exists({ _id: resumeId, userId: oid(userId) }));
  }

  // ── Writing ─────────────────────────────

  /** A first draft from what the platform already knows: profile, academics, finished roadmaps. */
  async prefill(viewer: AuthState): Promise<ResumeContent> {
    const [mine, own, user, academic, roadmaps] = await Promise.all([
      this.d.profiles.mine(viewer),
      this.d.profiles.own(viewer.userId),
      UserModel.findById(viewer.userId).select('name email').lean<{ name: string; email: string | null }>(),
      this.d.academics(viewer.userId),
      this.d.finishedRoadmaps(viewer.userId),
    ]);
    const tenant = await findTenantById(requireTenantId());
    const p = mine.profile.fields;
    const english = (s: string) => (NON_LATIN_SCRIPT.test(s) ? '' : s);
    const draft = {
      basics: {
        name: english(user?.name ?? ''),
        label: english(p.headline ?? '').slice(0, 80),
        email: user?.email ?? '',
        location: english(p.location ?? '').slice(0, 80),
        profiles: (p.links ?? [])
          .filter((l) => l.url.startsWith('https://'))
          .slice(0, 4)
          .map((l) => ({ network: english(l.label).slice(0, 30) || 'Link', url: l.url })),
      },
      education: tenant
        ? [
            {
              institution: english(tenant.branding.displayName),
              area: own.branch ?? '',
              studyType: 'B.Tech',
              endDate: own.gradYear ? String(own.gradYear) : '',
              score: academic?.cgpa != null ? `CGPA ${academic.cgpa}` : '',
            },
          ]
        : [],
      skills: own.skills.length
        ? [{ name: 'Skills', keywords: own.skills.map(english).filter(Boolean).slice(0, 15) }]
        : [],
      certificates: roadmaps.slice(0, 10).map((x) => ({
        name: `${english(x.title) || 'Roadmap'} roadmap (completed)`.slice(0, 120),
        issuer: tenant ? english(tenant.branding.displayName).slice(0, 80) : '',
        date: month(x.at),
      })),
    };
    // Through the schema, so the prefill obeys the same limits as anything the member saves.
    const parsed = resumeContent.safeParse(draft);
    return parsed.success
      ? parsed.data
      : resumeContent.parse({ basics: { name: draft.basics.name || 'Your name' } });
  }

  async create(viewer: AuthState, body: z.output<typeof resumeCreateBody>): Promise<ResumeView> {
    if ((await ResumeModel.countDocuments({ userId: oid(viewer.userId) })) >= RESUMES_PER_MEMBER)
      throw conflict(`Keep at most ${RESUMES_PER_MEMBER} résumés: delete one first`);
    const content = body.content ?? (await this.prefill(viewer));
    const r = await ResumeModel.create({
      userId: oid(viewer.userId),
      title: body.title,
      template: body.template,
      content,
    });
    await this.queueRender(r.toObject() as ResumeDoc);
    await this.track(viewer.userId, 'resume_created', { resumeId: String(r._id) });
    return this.get(viewer, String(r._id));
  }

  async update(viewer: AuthState, id: string, body: z.output<typeof resumeUpdateBody>): Promise<ResumeView> {
    const set: Record<string, unknown> = {};
    if (body.title !== undefined) set.title = body.title;
    if (body.template !== undefined) set.template = body.template;
    if (body.content !== undefined) set.content = body.content;
    // Optimistic: an edit made from an older version is refused instead of overwriting a newer one.
    const r = await ResumeModel.findOneAndUpdate(
      { _id: id, userId: oid(viewer.userId), version: body.version },
      { $set: set, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean<ResumeDoc>();
    if (!r) {
      await this.owned(viewer, id);
      throw conflict('This résumé changed in another tab: reload it before saving');
    }
    await this.queueRender(r);
    return this.get(viewer, id);
  }

  async remove(viewer: AuthState, id: string) {
    const r = await this.owned(viewer, id);
    await ResumeModel.deleteOne({ _id: r._id });
    await ResumeCommentModel.deleteMany({ resumeId: r._id });
    if (r.pdfFileId) await this.d.files.remove(r.pdfFileId);
    return { deleted: true };
  }

  // ── The PDF ─────────────────────────────

  private async queueRender(r: ResumeDoc) {
    await this.d.jobs.enqueue(
      RESUME_RENDER_JOB,
      { tenantId: String(requireTenantId()), resumeId: String(r._id), version: r.version },
      { jobId: `resume-${String(r._id)}-v${r.version}` },
    );
  }

  /** Job (the worker runs it): renders a version unless a newer one replaced it. */
  async onRender(job: TenantJob) {
    const r = await ResumeModel.findById(String(job.resumeId)).lean<ResumeDoc>();
    if (r && r.version === Number(job.version) && r.pdfVersion !== r.version) await this.render(r);
  }

  /** Renders and stores the current version's PDF, replacing the older one. */
  private async render(r: ResumeDoc): Promise<{ pdf: Buffer; pages: number }> {
    const out = await renderResumePdf(r.content, r.template);
    const stored = await this.d.files.storeResumePdf(String(r.userId), out.pdf);
    const prev = await ResumeModel.findOneAndUpdate(
      { _id: r._id, version: r.version },
      { $set: { pdfFileId: new Types.ObjectId(stored.id), pdfVersion: r.version, pages: out.pages } },
    ).lean<ResumeDoc>();
    if (!prev)
      await this.d.files.remove(stored.id); // edited meanwhile: the newer render wins
    else if (prev.pdfFileId && String(prev.pdfFileId) !== stored.id)
      await this.d.files.remove(prev.pdfFileId);
    return out;
  }

  private async currentPdf(r: ResumeDoc): Promise<{ pdf: Buffer; pages: number }> {
    if (r.pdfFileId && r.pdfVersion === r.version)
      return { pdf: await this.d.files.read(String(r.pdfFileId)), pages: r.pages };
    return this.render(r);
  }

  async pdf(viewer: AuthState, id: string): Promise<{ data: Buffer; name: string }> {
    const { r } = await this.readable(viewer, id);
    const { pdf } = await this.currentPdf(r);
    const safe = `${r.content.basics.name} ${r.title}`
      .replace(/[^A-Za-z0-9 _-]+/g, '')
      .trim()
      .replace(/\s+/g, '-');
    return { data: pdf, name: `${safe || 'resume'}.pdf` };
  }

  /** Drive registration (B7) with "attach my résumé": a copy of the current PDF, as an upload. */
  async copyForDrive(viewer: AuthState, id: string): Promise<string> {
    const r = await this.owned(viewer, id);
    const { pdf } = await this.currentPdf(r);
    return (await this.d.files.storeResume(viewer.userId, pdf, 'placement_resume')).id;
  }

  // ── ATS check and rewrites ─────────────────────────────

  async ats(viewer: AuthState, id: string, body: z.output<typeof atsCheckBody>): Promise<AtsReport> {
    const r = await this.owned(viewer, id);
    let jd: string | null = body.jobDescription?.trim() || null;
    let source: 'pasted' | 'drive' = 'pasted';
    if (body.driveId) {
      jd = await this.d.driveText(viewer, body.driveId);
      if (!jd) throw notFound('Drive');
      source = 'drive';
    }
    const { pages } = await this.currentPdf(r);
    const s = atsScore(r.content, pages, jd);
    let gaps: string[] = [];
    if (jd) {
      const g = await this.d.ai.run(viewer, gapsTask, {
        jobDescription: jd.slice(0, 6000),
        resume: resumeText(r.content).slice(0, 6000),
        missing: s.missing,
      });
      gaps = g.ok ? g.output.gaps : missingGaps(s.missing);
    }
    const report: AtsReport = {
      score: s.score,
      checks: s.checks,
      keywords: jd ? { source, matched: s.matched, missing: s.missing } : null,
      gaps,
      pages,
      version: r.version,
      checkedAt: new Date().toISOString(),
    };
    await ResumeModel.updateOne({ _id: r._id }, { $set: { atsReport: report } });
    await this.track(viewer.userId, 'ats_checked', { resumeId: id });
    return report;
  }

  async rewrite(viewer: AuthState, id: string, body: z.output<typeof rewriteBody>): Promise<RewriteView> {
    const r = await this.owned(viewer, id);
    const entry = r.content[body.section][body.entry];
    const bullet = entry?.highlights[body.bullet];
    if (!entry || !bullet) throw badRequest('That bullet does not exist (save first?)');
    const res = await this.d.ai.run(viewer, rewriteTask, {
      bullet,
      position: 'position' in entry ? entry.position : 'project',
      organisation: entry.name,
    });
    const original = bullet.trim();
    // Never a new number, never the same text, never over the bullet limit (the facts stay theirs).
    const clean = (list: string[]) =>
      [...new Set(list.map((a) => plainText(a).replace(/\s+/g, ' ').trim()))]
        .filter((a) => a && a !== original && a.length <= 220 && !addsNumbers(original, a))
        .slice(0, 3);
    const ai = res.ok && res.source === 'ai' ? clean(res.output.alternatives) : [];
    return ai.length
      ? { original, alternatives: ai, source: 'ai', tips: bulletTips(original) }
      : {
          original,
          alternatives: clean(ruleRewrites(original)),
          source: 'rules',
          tips: bulletTips(original),
        };
  }

  // ── Review comments ─────────────────────────────

  private commentView(
    c: ResumeCommentDoc,
    viewer: AuthState,
    names: Map<string, { name: string }>,
  ): ResumeCommentView {
    const author = c.authorId ? names.get(String(c.authorId)) : undefined;
    return {
      id: String(c._id),
      section: c.section,
      body: c.body,
      author: c.authorId ? { id: String(c.authorId), name: author?.name ?? 'Former member' } : null,
      resumeVersion: c.resumeVersion,
      mine: !!c.authorId && String(c.authorId) === viewer.userId,
      createdAt: c.createdAt.toISOString(),
    };
  }

  async comments(viewer: AuthState, id: string): Promise<ResumeCommentView[]> {
    const { r } = await this.readable(viewer, id);
    const rows = await ResumeCommentModel.find({ resumeId: r._id, status: 'visible' })
      .sort({ _id: 1 })
      .limit(200)
      .lean<ResumeCommentDoc[]>();
    const names = await this.d.profiles.refsFor(rows.flatMap((c) => (c.authorId ? [c.authorId] : [])));
    return rows.map((c) => this.commentView(c, viewer, names));
  }

  async comment(
    viewer: AuthState,
    id: string,
    body: z.output<typeof resumeCommentBody>,
  ): Promise<ResumeCommentView> {
    const { r, mine } = await this.readable(viewer, id);
    const first =
      !mine && !(await ResumeCommentModel.exists({ resumeId: r._id, authorId: oid(viewer.userId) }));
    const c = await ResumeCommentModel.create({
      resumeId: r._id,
      resumeVersion: r.version,
      authorId: oid(viewer.userId),
      section: body.section,
      body: plainText(body.body),
    });
    if (!mine) {
      const name = (await this.d.profiles.refsFor([viewer.userId])).get(viewer.userId)?.name ?? '';
      await this.d.notifications.notify(r.userId, 'resume_comment', {
        resumeId: id,
        name,
        section: body.section,
      });
      if (first) await this.track(viewer.userId, 'resume_reviewed', { resumeId: id });
    }
    const names = await this.d.profiles.refsFor([viewer.userId]);
    return this.commentView(c.toObject() as ResumeCommentDoc, viewer, names);
  }

  /** Moderation (ModeratableHandler): comments are member text like any other. */
  readonly commentHandler = {
    load: async (cid: string) => {
      const c = await ResumeCommentModel.findById(cid).lean<ResumeCommentDoc>();
      return c
        ? {
            authorId: c.authorId ? String(c.authorId) : '',
            status: c.status,
            snapshot: c.body,
            context: { resumeId: String(c.resumeId) },
          }
        : null;
    },
    setRemoved: async (cid: string, removal: Removal | null) => {
      const r = await ResumeCommentModel.updateOne(
        { _id: cid, status: removal ? 'visible' : 'removed' },
        { $set: { status: removal ? 'removed' : 'visible', removal } },
      );
      return r.modifiedCount > 0;
    },
  };

  // ── Privacy ─────────────────────────────

  /** Data export: every résumé with its content, ATS report and current PDF (base64). */
  async exportFor(userId: string) {
    const rows = await ResumeModel.find({ userId: oid(userId) }).lean<ResumeDoc[]>();
    const resumes = [];
    for (const r of rows) {
      const pdf = r.pdfFileId ? await this.d.files.read(String(r.pdfFileId)).catch(() => null) : null;
      resumes.push({
        title: r.title,
        template: r.template,
        version: r.version,
        content: r.content,
        atsReport: r.atsReport,
        pdfBase64: pdf ? pdf.toString('base64') : null,
      });
    }
    const comments = await ResumeCommentModel.find({ authorId: oid(userId) })
      .select('section body createdAt')
      .lean();
    return { resumes, commentsWritten: comments };
  }

  /** Erasure: their résumés, PDFs and the comments on them go; comments they wrote go too. */
  async eraseFor(userId: string) {
    const rows = await ResumeModel.find({ userId: oid(userId) })
      .select('_id pdfFileId')
      .lean<ResumeDoc[]>();
    for (const r of rows) if (r.pdfFileId) await this.d.files.remove(r.pdfFileId);
    await ResumeCommentModel.deleteMany({ resumeId: { $in: rows.map((r) => r._id) } });
    await ResumeModel.deleteMany({ userId: oid(userId) });
    await ResumeCommentModel.deleteMany({ authorId: oid(userId) });
  }
}
