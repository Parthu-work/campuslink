import { Schema, Types, type InferSchemaType } from 'mongoose';
import type { z } from 'zod';
import {
  ROSTER_SYNC_APPROVAL_SHARE,
  ROSTER_SYNC_PENDING_DAYS,
  type ImportMapping,
  type ImportSourceBody,
  type RosterSyncDiff,
  type RosterSyncView,
  type rosterSyncBody,
  type rosterSyncUpdateBody,
} from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';
import type { FieldCipher } from '../../lib/crypto.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import { requireTenantId } from '../../lib/context.js';
import type { Logger } from '../../lib/logger.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { TenantModel } from '../tenants/tenant.model.js';
import type { ImportsService } from './imports.service.js';
import type { AuthState } from '../../types.js';

/**
 * The scheduled roster sync (prompt 2, G9): the college's Google Sheet or ERP export is read daily
 * or weekly with the mapping of an import the admin already ran. A run that changes more than 5%
 * of the rows waits for an admin to approve its diff; smaller runs apply as an ordinary import
 * (same audit, error report and rollback). One per college.
 */
const syncSchema = new Schema(
  {
    key: { type: String, default: 'roster' },
    enabled: { type: Boolean, default: true },
    frequency: { type: String, enum: ['daily', 'weekly'], required: true },
    weekday: { type: Number, default: 1, min: 0, max: 6 },
    source: {
      kind: { type: String, enum: ['gsheet', 'rest'], required: true },
      url: { type: String, required: true },
      recordsPath: { type: String, default: null },
      /** A REST source's bearer token, encrypted with the field cipher (never returned). */
      tokenEnc: { type: String, default: null },
    },
    label: { type: String, required: true },
    mapping: { type: Schema.Types.Mixed, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    /** The India-time day of the last run (a second job the same day does nothing). */
    lastRunKey: { type: String, default: null },
    lastRunAt: { type: Date, default: null },
    lastStatus: {
      type: String,
      enum: ['applied', 'waiting', 'nochange', 'failed', 'rejected', null],
      default: null,
    },
    lastError: { type: String, default: null },
    lastImportId: { type: Schema.Types.ObjectId, default: null },
    pending: {
      type: new Schema(
        {
          fileId: { type: Schema.Types.ObjectId, required: true },
          diff: { type: Schema.Types.Mixed, required: true },
          at: { type: Date, required: true },
          expiresAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  baseSchemaOptions,
);
syncSchema.index({ tenantId: 1, key: 1 }, { unique: true });
type SyncDoc = Omit<InferSchemaType<typeof syncSchema>, 'source' | 'pending'> & {
  _id: Types.ObjectId;
  source: { kind: string; url: string; recordsPath: string | null; tokenEnc: string | null };
  pending: { fileId: Types.ObjectId; diff: unknown; at: Date; expiresAt: Date } | null;
};
export const RosterSyncModel = defineTenantModel('RosterSync', syncSchema);

export const ROSTER_SYNC_JOB = 'imports.roster_sync';
const DAY = 86_400_000;
const IST_MS = 5.5 * 3600_000;
const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const istWeekday = (d: Date) => new Date(d.getTime() + IST_MS).getUTCDay();

export interface RosterSyncDeps {
  imports: ImportsService;
  cipher: FieldCipher;
  logger: Logger;
  jobs: JobQueue;
  /** College admins (they approve a large change). */
  admins: () => Promise<string[]>;
  notify: (userId: string, data: Record<string, string>) => Promise<void>;
}

export class RosterSyncService {
  constructor(private readonly d: RosterSyncDeps) {}

  private async doc() {
    return RosterSyncModel.findOne({ key: 'roster' }).lean<SyncDoc>();
  }

  private sourceOf(s: SyncDoc): ImportSourceBody {
    return s.source.kind === 'gsheet'
      ? { kind: 'gsheet', url: s.source.url }
      : {
          kind: 'rest',
          url: s.source.url,
          ...(s.source.recordsPath ? { recordsPath: s.source.recordsPath } : {}),
          ...(s.source.tokenEnc ? { bearerToken: this.d.cipher.decrypt(s.source.tokenEnc) } : {}),
        };
  }

  private view(s: SyncDoc | null, now = new Date()): RosterSyncView {
    const pending = s?.pending && s.pending.expiresAt > now ? (s.pending.diff as RosterSyncDiff) : null;
    return {
      configured: !!s,
      enabled: s?.enabled ?? false,
      frequency: (s?.frequency ?? 'daily') as RosterSyncView['frequency'],
      weekday: s?.weekday ?? 1,
      source: s
        ? { kind: s.source.kind as 'gsheet' | 'rest', label: s.label, hasToken: !!s.source.tokenEnc }
        : null,
      lastRunAt: s?.lastRunAt?.toISOString() ?? null,
      lastStatus: (s?.lastStatus ?? null) as RosterSyncView['lastStatus'],
      lastError: s?.lastError ?? null,
      lastImportId: s?.lastImportId ? String(s.lastImportId) : null,
      pending,
    };
  }

  async get(): Promise<RosterSyncView> {
    return this.view(await this.doc());
  }

  /** Sets the sync up from a completed import of this source (its column mapping is reused). */
  async save(
    viewer: AuthState,
    body: z.output<typeof rosterSyncBody>,
    meta: RequestMetaLite,
  ): Promise<RosterSyncView> {
    const mapping = await this.d.imports.rosterMappingOf(body.fromJobId);
    if (!mapping) throw badRequest('Choose a completed roster import to repeat');
    // Read the source now, so a wrong link or a moved column fails here rather than at 2 am.
    const table = await this.d.imports.readSource(body.source);
    const missing = Object.values(mapping.columns).filter((c) => c && !table.headers.includes(c));
    if (missing.length) throw badRequest(`The source no longer has the column “${missing[0]}”`);
    const existing = await this.doc();
    const sameUrl = existing?.source.url === body.source.url;
    const token =
      body.source.kind === 'rest' && body.source.bearerToken
        ? this.d.cipher.encrypt(body.source.bearerToken)
        : body.source.kind === 'rest' && sameUrl
          ? (existing?.source.tokenEnc ?? null)
          : null;
    await RosterSyncModel.updateOne(
      { key: 'roster' },
      {
        $set: {
          enabled: true,
          frequency: body.frequency,
          weekday: body.weekday,
          source: {
            kind: body.source.kind,
            url: body.source.url,
            recordsPath: body.source.kind === 'rest' ? (body.source.recordsPath ?? null) : null,
            tokenEnc: token,
          },
          label: body.source.kind === 'gsheet' ? 'Google Sheet' : new URL(body.source.url).hostname,
          mapping,
          createdBy: new Types.ObjectId(viewer.userId),
        },
        $setOnInsert: { key: 'roster' },
      },
      { upsert: true },
    );
    await audit.record(
      {
        action: 'import.sync_saved',
        actorId: viewer.userId,
        meta: { kind: body.source.kind, frequency: body.frequency },
      },
      meta,
    );
    return this.get();
  }

  async update(viewer: AuthState, body: z.output<typeof rosterSyncUpdateBody>, meta: RequestMetaLite) {
    const r = await RosterSyncModel.updateOne(
      { key: 'roster' },
      {
        $set: {
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.frequency ? { frequency: body.frequency } : {}),
          ...(body.weekday !== undefined ? { weekday: body.weekday } : {}),
        },
      },
    );
    if (!r.matchedCount) throw notFound('Roster sync');
    const changed = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as Record<
      string,
      string | number | boolean
    >;
    await audit.record({ action: 'import.sync_updated', actorId: viewer.userId, meta: changed }, meta);
    return this.get();
  }

  async remove(viewer: AuthState, meta: RequestMetaLite) {
    const s = await this.doc();
    if (!s) throw notFound('Roster sync');
    if (s.pending) await this.d.imports.removeStored(String(s.pending.fileId));
    await RosterSyncModel.deleteOne({ _id: s._id });
    await audit.record({ action: 'import.sync_removed', actorId: viewer.userId }, meta);
    return this.view(null);
  }

  /** Runs the sync now (an admin's "Sync now"); it still waits for approval above 5%. */
  async runNow(viewer: AuthState, meta: RequestMetaLite): Promise<{ queued: true }> {
    const s = await this.doc();
    if (!s) throw notFound('Roster sync');
    await this.d.jobs.enqueue(
      ROSTER_SYNC_JOB,
      { tenantId: String(requireTenantId()), manual: true, at: new Date().toISOString() },
      { jobId: `roster-sync-${String(requireTenantId())}-now-${Math.floor(Date.now() / 60_000)}` },
    );
    await audit.record({ action: 'import.sync_run', actorId: viewer.userId }, meta);
    return { queued: true };
  }

  /** The admin applies the waiting diff: exactly the rows it was made from. */
  async approve(viewer: AuthState, meta: RequestMetaLite): Promise<RosterSyncView> {
    const s = await this.doc();
    if (!s?.pending || s.pending.expiresAt <= new Date()) throw notFound('A change waiting for approval');
    const diff = s.pending.diff as RosterSyncDiff;
    const { id } = await this.d.imports.startStored(
      viewer.userId,
      { kind: s.source.kind as 'gsheet' | 'rest', label: s.label },
      String(s.pending.fileId),
      diff.total,
      s.mapping as ImportMapping,
      meta,
    );
    // The import job reads the stored rows and then removes them.
    await RosterSyncModel.updateOne(
      { _id: s._id },
      {
        $set: { pending: null, lastStatus: 'applied', lastError: null, lastImportId: new Types.ObjectId(id) },
      },
    );
    await audit.record(
      {
        action: 'import.sync_approved',
        actorId: viewer.userId,
        targetType: 'import',
        targetId: id,
        meta: { created: diff.created, updated: diff.updated },
      },
      meta,
    );
    return this.get();
  }

  async reject(viewer: AuthState, meta: RequestMetaLite): Promise<RosterSyncView> {
    const s = await this.doc();
    if (!s?.pending) throw notFound('A change waiting for approval');
    await this.d.imports.removeStored(String(s.pending.fileId));
    await RosterSyncModel.updateOne({ _id: s._id }, { $set: { pending: null, lastStatus: 'rejected' } });
    await audit.record({ action: 'import.sync_rejected', actorId: viewer.userId }, meta);
    return this.get();
  }

  /** Queues today's run per college from 02:00 India time (job ids dedupe per day). */
  static async enqueueDue(jobs: JobQueue, now = new Date()): Promise<number> {
    if (new Date(now.getTime() + IST_MS).getUTCHours() < 2) return 0;
    const day = istDay(now);
    const tenants = await TenantModel.find({ kind: 'college', status: 'active' }).select('_id').lean();
    for (const t of tenants)
      await jobs.enqueue(
        ROSTER_SYNC_JOB,
        { tenantId: String(t._id), day },
        { jobId: `roster-sync-${String(t._id)}-${day.replace(/-/g, '')}` },
      );
    return tenants.length;
  }

  /** Job: read the source, diff it, then apply it, wait for approval, or record why not. */
  async run(job: TenantJob, now = new Date()): Promise<RosterSyncView['lastStatus'] | 'off' | 'skipped'> {
    const s = await this.doc();
    if (!s?.enabled) return 'off';
    const manual = job.manual === true;
    if (!manual && s.frequency === 'weekly' && istWeekday(now) !== s.weekday) return 'skipped';
    const key = manual ? `manual-${now.toISOString()}` : istDay(now);
    const claim = await RosterSyncModel.updateOne(
      { _id: s._id, lastRunKey: { $ne: key } },
      { $set: { lastRunKey: key, lastRunAt: now } },
    );
    if (!claim.modifiedCount) return 'skipped';
    const fail = async (message: string) => {
      await RosterSyncModel.updateOne(
        { _id: s._id },
        { $set: { lastStatus: 'failed', lastError: message.slice(0, 300) } },
      );
      return 'failed' as const;
    };
    let rows: Record<string, string>[];
    try {
      rows = (await this.d.imports.readSource(this.sourceOf(s))).rows;
    } catch (e) {
      return fail(e instanceof AppError ? e.message : 'The source could not be read');
    }
    if (await this.d.imports.busy()) return fail('Another import was running; the next run tries again');
    const mapping = s.mapping as ImportMapping;
    const counts = await this.d.imports.diffRoster(rows, mapping);
    const changed = counts.created + counts.updated;
    if (!changed) {
      await RosterSyncModel.updateOne({ _id: s._id }, { $set: { lastStatus: 'nochange', lastError: null } });
      return 'nochange';
    }
    const share = changed / Math.max(1, rows.length);
    const ttl = ROSTER_SYNC_PENDING_DAYS * DAY;
    const fileId = await this.d.imports.storeRows(String(s.createdBy), rows, ttl);
    if (share <= ROSTER_SYNC_APPROVAL_SHARE) {
      try {
        const { id } = await this.d.imports.startStored(
          String(s.createdBy),
          { kind: s.source.kind as 'gsheet' | 'rest', label: s.label },
          fileId,
          rows.length,
          mapping,
          {},
        );
        await RosterSyncModel.updateOne(
          { _id: s._id },
          { $set: { lastStatus: 'applied', lastError: null, lastImportId: new Types.ObjectId(id) } },
        );
        return 'applied';
      } catch (e) {
        await this.d.imports.removeStored(fileId);
        return fail(e instanceof AppError ? e.message : 'The import could not be started');
      }
    }
    // Too large to apply unseen: keep the rows and the diff for an admin.
    if (s.pending) await this.d.imports.removeStored(String(s.pending.fileId));
    const diff: RosterSyncDiff = {
      ...counts,
      changedShare: Math.round(share * 1000) / 1000,
      at: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl).toISOString(),
    };
    await RosterSyncModel.updateOne(
      { _id: s._id },
      {
        $set: {
          lastStatus: 'waiting',
          lastError: null,
          pending: {
            fileId: new Types.ObjectId(fileId),
            diff,
            at: now,
            expiresAt: new Date(now.getTime() + ttl),
          },
        },
      },
    );
    for (const admin of await this.d.admins())
      await this.d
        .notify(admin, { changed: String(changed), total: String(rows.length) })
        .catch((err: unknown) => this.d.logger.warn({ err }, 'roster sync notice failed'));
    return 'waiting';
  }
}
