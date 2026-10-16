import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  MAX_JOB_ALERTS,
  type AlertFilters,
  type JobAlertView,
  type JobBody,
  type JobsQuery,
  type JobView,
  type RadarView,
  type TrackedJobView,
  type TrackStatus,
  type alertBody,
  type trackBody,
} from '@campuslink/shared';
import {
  JobAlertModel,
  JobModel,
  SavedJobModel,
  type JobAlertDoc,
  type JobDoc,
  type SavedJobDoc,
} from './job.model.js';
import {
  dedupeKey,
  extractSkills,
  freshersOk,
  inferBranches,
  inferLevel,
  inferMode,
  inferType,
  isIndiaLocation,
} from './normalize.js';
import type { RawJob } from '../job-sources/adapters.js';
import type { JobSourceDoc } from '../job-sources/job-source.model.js';
import { companyKey } from '../../lib/company.js';
import { plainText, snippet } from '../../lib/text.js';
import { withTextSearch } from '../../db/search.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { requireTenantId, withPlatformScope } from '../../lib/context.js';
import { findTenantById } from '../tenants/tenant.cache.js';
import { backgroundAuth } from '../users/users.service.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { SafetyService } from '../moderation/safety.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { isModerator, type ModerationService, type Removal } from '../moderation/moderation.service.js';
import type { AuthState } from '../../types.js';

export const ALERT_JOB = 'jobs.alert';
const DAY = 86_400_000;
const PURGE_AFTER = 60 * DAY;
/** Imported jobs stay listed this long after they were last seen at the source. */
const IMPORTED_TTL = 21 * DAY;
const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const live = () => ({ status: 'open', expiresAt: { $gt: new Date() } });

export interface JobsDeps {
  profiles: ProfilesService;
  safety: SafetyService;
  notifications: NotificationsService;
  moderation: ModerationService;
}

export class JobsService {
  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    const [tracker, alerts, posted] = await Promise.all([
      SavedJobModel.find({ userId }).select('jobId title company status note createdAt').lean(),
      JobAlertModel.find({ userId }).select('name filters createdAt').lean(),
      JobModel.find({ postedBy: userId }).select('title company status postedAt').lean(),
    ]);
    return { tracker, alerts, posted };
  }

  /** Private tracker and alerts are deleted; openings I posted are closed. */
  async eraseFor(userId: string) {
    const u = new Types.ObjectId(userId);
    await Promise.all([
      SavedJobModel.deleteMany({ userId: u }),
      JobAlertModel.deleteMany({ userId: u }),
      JobModel.updateMany({ postedBy: u, status: 'open' }, { $set: { status: 'closed' } }),
    ]);
  }

  /** Set by the referrals module: how many referrers accept requests per company key. */
  referrerCounts: (keys: string[], viewer: AuthState) => Promise<Map<string, number>> = async () => new Map();
  /** Set by the job-sources module: source names and attribution lines. */
  sourceInfo: (ids: string[]) => Promise<Map<string, { name: string; attribution: string | null }>> =
    async () => new Map();

  constructor(private readonly d: JobsDeps) {}

  // ── Views ─────────────────────────────
  async views(viewer: AuthState, docs: JobDoc[]): Promise<JobView[]> {
    if (!docs.length) return [];
    const keys = [...new Set(docs.map((j) => j.companyKey))];
    const [alumni, referrers, saved, authors, sources] = await Promise.all([
      this.d.profiles.alumniAtCompanies(viewer, keys),
      this.referrerCounts(keys, viewer),
      SavedJobModel.find({
        userId: new Types.ObjectId(viewer.userId),
        jobId: { $in: docs.map((j) => j._id) },
      }).lean<SavedJobDoc[]>(),
      this.d.profiles.authorsFor(
        viewer,
        docs.flatMap((j) => (j.postedBy ? [j.postedBy] : [])),
      ),
      this.sourceInfo([...new Set(docs.flatMap((j) => (j.sourceId ? [String(j.sourceId)] : [])))]),
    ]);
    const track = new Map(saved.map((s) => [String(s.jobId), s]));
    const now = Date.now();
    return docs.map((j) => {
      const t = track.get(String(j._id));
      return {
        id: String(j._id),
        title: j.title,
        company: j.company,
        location: j.location,
        mode: (j.mode ?? null) as JobView['mode'],
        type: j.type as JobView['type'],
        level: (j.level ?? null) as JobView['level'],
        skills: j.skills,
        branches: j.branches as JobView['branches'],
        salary: j.salary?.max
          ? {
              min: j.salary.min ?? 0,
              max: j.salary.max,
              currency: j.salary.currency ?? 'INR',
              period: (j.salary.period ?? 'year') as 'year' | 'month',
            }
          : null,
        applyUrl: j.applyUrl,
        description: j.description,
        freshersOk: j.freshersOk,
        origin: j.origin as JobView['origin'],
        source: j.sourceId ? (sources.get(String(j.sourceId)) ?? null) : null,
        postedBy: j.postedBy ? (authors.get(String(j.postedBy)) ?? null) : null,
        postedAt: j.postedAt.toISOString(),
        expiresAt: j.expiresAt.toISOString(),
        status:
          j.status === 'open' && j.expiresAt.getTime() <= now
            ? 'expired'
            : j.status === 'open'
              ? 'open'
              : j.status === 'expired'
                ? 'expired'
                : 'closed',
        isMine: !!j.postedBy && String(j.postedBy) === viewer.userId,
        alumniCount: alumni.get(j.companyKey)?.length ?? 0,
        referrers: referrers.get(j.companyKey) ?? 0,
        track: t
          ? { status: t.status as TrackStatus, note: t.note, updatedAt: t.updatedAt.toISOString() }
          : null,
      };
    });
  }

  // ── Posting ─────────────────────────────
  async create(viewer: AuthState, body: JobBody): Promise<JobView> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + body.expiresInDays * DAY);
    const description = plainText(body.description);
    if (description.length < 30) throw badRequest('Describe the role in a few sentences');
    const skills = [...new Set(body.skills.map((s) => plainText(s)).filter(Boolean))];
    const doc = await JobModel.create({
      origin: 'posted',
      postedBy: new Types.ObjectId(viewer.userId),
      title: plainText(body.title),
      company: plainText(body.company),
      companyKey: companyKey(body.company) || 'unknown',
      location: plainText(body.location),
      mode: body.mode,
      type: body.type,
      level: body.level,
      skills,
      skillKeys: skills.map((s) => s.toLowerCase()),
      branches: body.branches,
      salary: body.salary ?? null,
      applyUrl: body.applyUrl,
      description,
      freshersOk: body.freshersOk || body.level === 'fresher' || body.type === 'internship',
      postedAt: now,
      expiresAt,
      dedupeKey: `posted-${new Types.ObjectId().toHexString()}`,
      purgeAt: new Date(expiresAt.getTime() + PURGE_AFTER),
    });
    return (await this.views(viewer, [doc.toObject() as JobDoc]))[0] as JobView;
  }

  async close(viewer: AuthState, id: string) {
    const r = await JobModel.updateOne(
      { _id: id, postedBy: new Types.ObjectId(viewer.userId), status: 'open' },
      { $set: { status: 'closed', purgeAt: new Date(Date.now() + PURGE_AFTER) } },
    );
    if (!r.matchedCount) throw notFound('Open job you posted');
    return { status: 'closed' as const };
  }

  // ── Reading ─────────────────────────────
  private async visibleDoc(viewer: AuthState, id: string): Promise<JobDoc> {
    const j = await JobModel.findById(id).lean<JobDoc>();
    if (!j) throw notFound('Job');
    const mine = !!j.postedBy && String(j.postedBy) === viewer.userId;
    if (j.status === 'removed' && !mine && !isModerator(viewer)) throw notFound('Job');
    if (j.postedBy && !mine && (await this.d.safety.isBlockedEither(viewer.userId, j.postedBy)))
      throw notFound('Job');
    return j;
  }

  async get(viewer: AuthState, id: string) {
    const j = await this.visibleDoc(viewer, id);
    const [view] = await this.views(viewer, [j]);
    const removal = j.removal?.reason
      ? ((
          await this.d.moderation.removalViews('job', [
            j as { _id: Types.ObjectId; status: string; removal?: Removal | null },
          ])
        ).get(id) ?? null)
      : null;
    return {
      ...(view as JobView),
      removal: removal && (view?.isMine || isModerator(viewer)) ? removal : null,
    };
  }

  /** Mongo filter for search filters (shared by the list and alerts). */
  private async filterFor(viewer: AuthState, f: AlertFilters & { alumni?: boolean }) {
    const and: Record<string, unknown>[] = [];
    if (f.skills?.length) and.push({ skillKeys: { $in: f.skills.map((s) => s.toLowerCase()) } });
    if (f.branch) and.push({ $or: [{ branches: f.branch }, { branches: { $size: 0 } }] });
    if (f.level) and.push({ level: f.level });
    if (f.mode) and.push({ mode: f.mode });
    if (f.type) and.push({ type: f.type });
    if (f.location) and.push({ location: new RegExp(escapeRegex(f.location), 'i') });
    if (f.fresher) and.push({ freshersOk: true });
    if (f.alumni) {
      const keys = await this.alumniCompanyKeys(viewer);
      and.push({ companyKey: { $in: keys } });
    }
    const hidden = await this.d.safety.hiddenFor(viewer.userId);
    if (hidden.size) and.push({ postedBy: { $nin: [...hidden].map((h) => new Types.ObjectId(h)) } });
    return and;
  }

  /** Company keys where at least one alumnus (visible to the viewer) works. */
  private async alumniCompanyKeys(viewer: AuthState): Promise<string[]> {
    const keys = await JobModel.distinct('companyKey', live());
    const map = await this.d.profiles.alumniAtCompanies(viewer, keys as string[]);
    return [...map.keys()];
  }

  async list(viewer: AuthState, q: JobsQuery) {
    if (q.mine) {
      const rows = await JobModel.find({
        postedBy: new Types.ObjectId(viewer.userId),
        ...(q.cursor ? { _id: { $lt: new Types.ObjectId(q.cursor) } } : {}),
      })
        .sort({ _id: -1 })
        .limit(q.limit + 1)
        .lean<JobDoc[]>();
      const page = rows.slice(0, q.limit);
      return {
        items: await this.views(viewer, page),
        nextCursor: rows.length > q.limit ? String(page.at(-1)?._id) : null,
      };
    }
    const and = await this.filterFor(viewer, {
      ...(q.skills ? { skills: q.skills } : {}),
      ...(q.branch ? { branch: q.branch } : {}),
      ...(q.level ? { level: q.level } : {}),
      ...(q.mode ? { mode: q.mode } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.location ? { location: q.location } : {}),
      fresher: !!q.fresher,
      alumni: !!q.alumni,
    });
    const filter: Record<string, unknown> = { ...live(), ...(and.length ? { $and: and } : {}) };
    if (q.q && q.q.length >= 3) {
      const rows = await withTextSearch(JobModel.find(filter), q.q).limit(30).lean<JobDoc[]>();
      if (rows.length) return { items: await this.views(viewer, rows), nextCursor: null };
    }
    // Short or partial words ("Mech"): match the start of a word in the title or company.
    if (q.q) {
      const re = new RegExp(`\\b${escapeRegex(q.q)}`, 'i');
      filter.$or = [{ title: re }, { company: re }];
    }
    if (q.cursor) filter._id = { $lt: new Types.ObjectId(q.cursor) };
    const rows = await JobModel.find(filter)
      .sort({ _id: -1 })
      .limit(q.limit + 1)
      .lean<JobDoc[]>();
    const page = rows.slice(0, q.limit);
    return {
      items: await this.views(viewer, page),
      nextCursor: rows.length > q.limit ? String(page.at(-1)?._id) : null,
    };
  }

  /**
   * Job Radar: smart sections from the newest 300 open jobs. "For you" scores skill overlap with
   * your profile, your branch, fresher-friendliness for students, alumni who refer, and recency.
   */
  async radar(viewer: AuthState): Promise<RadarView> {
    const hidden = await this.d.safety.hiddenFor(viewer.userId);
    const docs = (await JobModel.find(live()).sort({ _id: -1 }).limit(300).lean<JobDoc[]>()).filter(
      (j) => !j.postedBy || !hidden.has(String(j.postedBy)),
    );
    const own = await this.d.profiles.own(viewer.userId);
    const mySkills = new Set(own.skills.map((s) => s.toLowerCase()));
    const student = viewer.roles.includes('STUDENT');
    const keys = [...new Set(docs.map((j) => j.companyKey))];
    const referrers = await this.referrerCounts(keys, viewer);
    const now = Date.now();
    const score = (j: JobDoc) => {
      const skills = j.skillKeys.filter((s) => mySkills.has(s)).length;
      const branch = own.branch && (j.branches as string[]).includes(own.branch) ? 1 : 0;
      const ageDays = (now - j.postedAt.getTime()) / DAY;
      return (
        2 * Math.min(4, skills) +
        1.5 * branch +
        (student && j.freshersOk ? 1.5 : 0) +
        ((referrers.get(j.companyKey) ?? 0) > 0 ? 1 : 0) +
        2 * 0.5 ** (Math.max(0, ageDays) / 7)
      );
    };
    const take = (rows: JobDoc[]) => this.views(viewer, rows.slice(0, 8));
    const forYou = [...docs].sort((a, b) => score(b) - score(a));
    const soon = docs
      .filter((j) => j.expiresAt.getTime() - now < 7 * DAY)
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
    const [a, b, c, d] = await Promise.all([
      take(forYou),
      take(docs.filter((j) => (referrers.get(j.companyKey) ?? 0) > 0)),
      take(docs.filter((j) => j.freshersOk)),
      take(soon),
    ]);
    return {
      forYou: a,
      alumniCanRefer: b,
      fresherFriendly: c,
      closingSoon: d,
      newThisWeek: docs.filter((j) => now - j.postedAt.getTime() < 7 * DAY).length,
    };
  }

  // ── Saved jobs and tracker ─────────────────────────────
  async track(viewer: AuthState, id: string, body: z.output<typeof trackBody>) {
    const j = await this.visibleDoc(viewer, id);
    await SavedJobModel.updateOne(
      { userId: new Types.ObjectId(viewer.userId), jobId: j._id },
      {
        $set: { status: body.status, ...(body.note !== undefined ? { note: plainText(body.note) } : {}) },
        $setOnInsert: { title: j.title, company: j.company },
      },
      { upsert: true },
    );
    return this.get(viewer, id);
  }

  async unsave(viewer: AuthState, id: string) {
    await SavedJobModel.deleteOne({
      userId: new Types.ObjectId(viewer.userId),
      jobId: new Types.ObjectId(id),
    });
    return { saved: false };
  }

  async tracker(viewer: AuthState): Promise<TrackedJobView[]> {
    const saved = await SavedJobModel.find({ userId: new Types.ObjectId(viewer.userId) })
      .sort({ updatedAt: -1 })
      .limit(300)
      .lean<SavedJobDoc[]>();
    const docs = await JobModel.find({
      _id: { $in: saved.map((s) => s.jobId) },
      status: { $ne: 'removed' },
    }).lean<JobDoc[]>();
    const views = new Map((await this.views(viewer, docs)).map((v) => [v.id, v]));
    return saved.map((s) => ({
      jobId: String(s.jobId),
      title: s.title,
      company: s.company,
      status: s.status as TrackStatus,
      note: s.note,
      updatedAt: s.updatedAt.toISOString(),
      job: views.get(String(s.jobId)) ?? null,
    }));
  }

  // ── Alerts ─────────────────────────────
  private alertView(a: JobAlertDoc): JobAlertView {
    const f = (a.filters ?? {}) as AlertFilters;
    const filters: AlertFilters = Object.fromEntries(
      Object.entries(f).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)),
    );
    return {
      id: String(a._id),
      name: a.name,
      filters,
      lastRunAt: a.lastRunAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
    };
  }

  async alerts(viewer: AuthState) {
    const rows = await JobAlertModel.find({ userId: new Types.ObjectId(viewer.userId) })
      .sort({ _id: 1 })
      .lean<JobAlertDoc[]>();
    return rows.map((a) => this.alertView(a));
  }

  async createAlert(viewer: AuthState, body: z.output<typeof alertBody>) {
    const me = new Types.ObjectId(viewer.userId);
    if ((await JobAlertModel.countDocuments({ userId: me })) >= MAX_JOB_ALERTS)
      throw conflict(`You can keep ${MAX_JOB_ALERTS} job alerts. Delete one first.`);
    const a = await JobAlertModel.create({
      userId: me,
      name: plainText(body.name),
      filters: body.filters,
      lastRunAt: new Date(),
      nextRunAt: new Date(Date.now() + DAY),
    });
    return this.alertView(a.toObject() as JobAlertDoc);
  }

  async deleteAlert(viewer: AuthState, id: string) {
    const r = await JobAlertModel.deleteOne({ _id: id, userId: new Types.ObjectId(viewer.userId) });
    if (!r.deletedCount) throw notFound('Alert');
    return { deleted: true };
  }

  /** Scheduler (named platform path): queue one run per due alert, in its college. */
  static async enqueueDueAlerts(jobs: JobQueue, now = new Date()) {
    const due = await withPlatformScope('jobs:due-alerts', () =>
      JobAlertModel.find({ nextRunAt: { $lte: now } })
        .select('_id tenantId nextRunAt')
        .limit(1000)
        .lean<(JobAlertDoc & { tenantId: Types.ObjectId })[]>(),
    );
    for (const a of due)
      await jobs.enqueue(
        ALERT_JOB,
        { tenantId: String(a.tenantId), alertId: String(a._id) },
        { jobId: `alert-${String(a._id)}-${a.nextRunAt.getTime()}` },
      );
    return due.length;
  }

  /** Job handler: new matching openings since the last run → one notification (never the listings). */
  async runAlert(job: TenantJob) {
    const now = new Date();
    const a = await JobAlertModel.findOneAndUpdate(
      { _id: job.alertId, nextRunAt: { $lte: now } },
      { $set: { nextRunAt: new Date(now.getTime() + DAY) } },
      { returnDocument: 'before' },
    ).lean<JobAlertDoc>();
    if (!a) return;
    const tenant = await findTenantById(requireTenantId());
    const viewer = tenant ? await backgroundAuth(a.userId, tenant) : null;
    if (!viewer?.permissions.has('jobs:read')) return;
    const f = (a.filters ?? {}) as AlertFilters;
    const and = await this.filterFor(viewer, f);
    const filter: Record<string, unknown> = {
      ...live(),
      createdAt: { $gt: a.lastRunAt ?? a.createdAt },
      ...(and.length ? { $and: and } : {}),
    };
    let count: number;
    if (f.q && f.q.length >= 3)
      count = (await withTextSearch(JobModel.find(filter), f.q).select('_id').limit(50).lean()).length;
    else count = await JobModel.countDocuments(filter);
    await JobAlertModel.updateOne({ _id: a._id }, { $set: { lastRunAt: now } });
    if (count > 0)
      await this.d.notifications.notify(a.userId, 'job_alert', {
        alert: a.name,
        alertId: String(a._id),
        count: String(count),
      });
  }

  // ── Ingestion (called by job sources) ─────────────────────────────
  /** Normalise, filter and upsert a source's postings; ATS boards are authoritative, so missing jobs close. */
  async ingest(src: JobSourceDoc, raws: RawJob[]) {
    const started = new Date();
    let added = 0;
    let seen = 0;
    for (const r of raws.slice(0, 500)) {
      const title = plainText(r.title).slice(0, 160);
      if (title.length < 3) continue;
      const location = plainText(r.location).slice(0, 160);
      if (src.indiaOnly && src.kind !== 'rss' && src.kind !== 'adzuna' && !isIndiaLocation(location))
        continue;
      const company = plainText(r.company || src.company || src.name).slice(0, 100);
      const description = snippet(plainText(r.description), 1500);
      const type = inferType(title, description, r.employment);
      const level = inferLevel(title, description);
      const skills = extractSkills(title, description);
      const key = dedupeKey(company, title, location);
      const postedAt = r.postedAt && r.postedAt.getTime() <= Date.now() + DAY ? r.postedAt : started;
      const expiresAt = new Date(
        Math.max(
          started.getTime() + (src.kind === 'rss' || src.kind === 'adzuna' ? 0 : IMPORTED_TTL),
          postedAt.getTime() + IMPORTED_TTL,
        ),
      );
      const fields = {
        title,
        company,
        companyKey: companyKey(company) || 'unknown',
        location: location || 'India',
        mode: inferMode(`${location} ${description}`, r.workplace, r.remote),
        type,
        level,
        skills,
        skillKeys: skills.map((s) => s.toLowerCase()),
        branches: inferBranches(title, description, src.branches as never[]),
        salary: r.salary,
        applyUrl: r.applyUrl,
        description,
        freshersOk: freshersOk(level, type, `${title} ${description}`),
        expiresAt,
        lastSeenAt: started,
        purgeAt: new Date(expiresAt.getTime() + PURGE_AFTER),
      };
      const existing = await JobModel.findOne({ dedupeKey: key }).select('sourceId status').lean<JobDoc>();
      if (existing) {
        if (String(existing.sourceId) !== String(src._id)) continue; // listed first by another source
        seen++;
        await JobModel.updateOne(
          { _id: existing._id },
          { $set: { ...fields, ...(existing.status === 'closed' ? { status: 'open' } : {}) } },
        );
        continue;
      }
      try {
        await JobModel.create({
          origin: src.kind,
          sourceId: src._id,
          externalId: r.externalId.slice(0, 200),
          postedAt,
          dedupeKey: key,
          ...fields,
        });
        added++;
        seen++;
      } catch (e) {
        if (!isDuplicate(e)) throw e;
      }
    }
    let closed = 0;
    if (src.kind !== 'rss' && src.kind !== 'adzuna') {
      const r = await JobModel.updateMany(
        { sourceId: src._id, status: 'open', lastSeenAt: { $lt: started } },
        { $set: { status: 'closed', purgeAt: new Date(Date.now() + PURGE_AFTER) } },
      );
      closed = r.modifiedCount;
    }
    return { added, seen, closed };
  }

  async openCount(sourceIds: Types.ObjectId[]) {
    const rows = await JobModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { sourceId: { $in: sourceIds }, status: 'open', expiresAt: { $gt: new Date() } } },
      { $group: { _id: '$sourceId', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.n]));
  }

  async removeSourceJobs(sourceId: Types.ObjectId) {
    await JobModel.updateMany(
      { sourceId, status: 'open' },
      { $set: { status: 'closed', purgeAt: new Date(Date.now() + PURGE_AFTER) } },
    );
  }

  // ── For referrals ─────────────────────────────
  async openJob(id: string) {
    const j = await JobModel.findOne({ _id: id, ...live() }).lean<JobDoc>();
    if (!j) throw notFound('Open job');
    return j;
  }

  // ── Moderation and search ─────────────────────────────
  readonly handler = {
    load: async (id: string) => {
      const j = await JobModel.findById(id).lean<JobDoc>();
      return j
        ? {
            authorId: j.postedBy ? String(j.postedBy) : '',
            // Moderation speaks "published" / "removed".
            status: j.status === 'removed' ? 'removed' : 'published',
            snapshot: `${j.title} at ${j.company}\n${j.applyUrl}\n${j.description.slice(0, 1500)}`,
            context: {},
          }
        : null;
    },
    setRemoved: async (id: string, removal: Removal | null) =>
      (
        await JobModel.updateOne(
          removal ? { _id: id, status: { $ne: 'removed' } } : { _id: id, status: 'removed' },
          { $set: { status: removal ? 'removed' : 'open', removal } },
        )
      ).modifiedCount > 0,
  };

  async search(viewer: AuthState, text: string) {
    if (text.length < 3) return [];
    const rows = await withTextSearch(JobModel.find(live()), text).limit(5).lean<JobDoc[]>();
    return this.views(viewer, rows);
  }

  /** Analytics: openings posted by members since a date (dates only), and how many are open. */
  async postedSince(since: Date) {
    const [rows, open] = await Promise.all([
      JobModel.find({ origin: 'posted', createdAt: { $gte: since } })
        .select('createdAt')
        .limit(100_000)
        .lean<{ createdAt: Date }[]>(),
      JobModel.countDocuments(live()),
    ]);
    return { posted: rows.map((r) => r.createdAt), open };
  }
}
