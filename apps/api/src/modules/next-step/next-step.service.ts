import { Types } from 'mongoose';
import { isoWeek, nextStepDue, type NextStepView } from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { requireTenantId } from '../../lib/context.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { Logger } from '../../lib/logger.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import { TenantModel } from '../tenants/tenant.model.js';
import { findTenantById } from '../tenants/tenant.cache.js';
import { backgroundAuth } from '../users/users.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { NextStepModel, type NextStepDoc } from './next-step.model.js';

export const NEXT_STEP_JOB = 'habits.next_step';

/** Each item comes from the module that owns it (modules talk through services). */
export interface NextStepDeps {
  notifications: NotificationsService;
  logger: Logger;
  /** Active, verified students of the college (not alumni). */
  students: () => Promise<{ userId: string; name: string }[]>;
  roadmapStep: (viewer: AuthState) => Promise<NextStepView['roadmapStep']>;
  opportunity: (viewer: AuthState) => Promise<NextStepView['opportunity']>;
  alumnus: (viewer: AuthState) => Promise<NextStepView['alumnus']>;
  /** The readiness score now (G5), or null when readiness is not available. */
  readiness: (viewer: AuthState) => Promise<number | null>;
}

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

/**
 * The weekly Next Step (prompt 2, G7). From Monday 19:00 India time, one job per college and ISO
 * week (the job id carries the week) gives every active student four things: one roadmap step,
 * one drive or job they can apply to, one alumnus to ask, and how their readiness moved. It is
 * saved once per member and week, sent on WhatsApp within the member's caps (push or email
 * otherwise), and shown on Home. A student who opens Home before Monday's run gets theirs early.
 */
export class NextStepService {
  track: Track = noTrack;

  constructor(private readonly d: NextStepDeps) {}

  /** Queues this week's run per active college once it is due; ids dedupe per college and week. */
  static async enqueueWeekly(jobs: JobQueue, now = new Date()): Promise<number> {
    if (!nextStepDue(now)) return 0;
    const week = isoWeek(now);
    const tenants = await TenantModel.find({ kind: 'college', status: 'active' }).select('_id').lean();
    for (const t of tenants)
      await jobs.enqueue(
        NEXT_STEP_JOB,
        { tenantId: String(t._id), week },
        { jobId: `next-step-${String(t._id)}-${week}` },
      );
    return tenants.length;
  }

  private view(doc: NextStepDoc): NextStepView {
    return {
      week: doc.week,
      roadmapStep: doc.roadmapStep ?? null,
      opportunity: doc.opportunity ?? null,
      alumnus: doc.alumnus ?? null,
      readiness:
        doc.readinessScore === null ? null : { score: doc.readinessScore, delta: doc.readinessDelta },
      openedAt: doc.openedAt?.toISOString() ?? null,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  /** Builds this member's Next Step for a week once (a second call returns the saved one). */
  private async ensure(viewer: AuthState, week: string): Promise<{ doc: NextStepDoc; created: boolean }> {
    const existing = await NextStepModel.findOne({ userId: oid(viewer.userId), week }).lean<NextStepDoc>();
    if (existing) return { doc: existing, created: false };
    const [roadmapStep, opportunity, alumnus, score, last] = await Promise.all([
      safe(() => this.d.roadmapStep(viewer), null),
      safe(() => this.d.opportunity(viewer), null),
      safe(() => this.d.alumnus(viewer), null),
      safe(() => this.d.readiness(viewer), null),
      NextStepModel.findOne({
        userId: oid(viewer.userId),
        week: { $lt: week },
        readinessScore: { $ne: null },
      })
        .sort({ week: -1 })
        .select('readinessScore')
        .lean<{ readinessScore: number | null }>(),
    ]);
    const delta = score !== null && last?.readinessScore != null ? score - last.readinessScore : null;
    try {
      const doc = await NextStepModel.create({
        userId: oid(viewer.userId),
        week,
        roadmapStep,
        opportunity,
        alumnus,
        readinessScore: score,
        readinessDelta: delta,
      });
      return { doc: doc.toObject() as NextStepDoc, created: true };
    } catch (e) {
      // Built at the same moment by the weekly job and the member opening Home: keep the first.
      if ((e as { code?: number }).code !== 11000) throw e;
      const doc = await NextStepModel.findOne({ userId: oid(viewer.userId), week }).lean<NextStepDoc>();
      if (!doc) throw e;
      return { doc, created: false };
    }
  }

  private static hasAny(doc: NextStepDoc) {
    return !!(doc.roadmapStep || doc.opportunity || doc.alumnus || doc.readinessScore !== null);
  }

  /** Job: this week's Next Step for every student of the college, sent once each. */
  async run(job: TenantJob): Promise<{ sent: number; skipped: number }> {
    const week = typeof job.week === 'string' ? job.week : isoWeek(new Date());
    const tenant = await findTenantById(requireTenantId());
    if (!tenant) return { sent: 0, skipped: 0 };
    let sent = 0;
    let skipped = 0;
    for (const s of await this.d.students()) {
      const viewer = await backgroundAuth(s.userId, tenant);
      if (!viewer?.permissions.has('nextstep:view')) {
        skipped++;
        continue;
      }
      const { doc } = await this.ensure(viewer, week);
      // Sent at most once a week per member, whoever built it first (the member or a retry).
      const claim = await NextStepModel.updateOne(
        { _id: doc._id, notifiedAt: null },
        { $set: { notifiedAt: new Date() } },
      );
      if (!claim.modifiedCount || !NextStepService.hasAny(doc)) {
        skipped++;
        continue;
      }
      await this.d.notifications
        .notify(s.userId, 'weekly_next_step', {
          name: s.name.trim().split(/\s+/)[0] ?? '',
          week,
          step: doc.roadmapStep?.title ?? '',
          company: doc.opportunity?.company ?? '',
          alumnus: doc.alumnus?.name.trim().split(/\s+/)[0] ?? '',
        })
        .catch((err: unknown) => this.d.logger.warn({ err }, 'next step notify failed'));
      sent++;
    }
    return { sent, skipped };
  }

  /** This week's Next Step for the viewer (built now if the weekly run has not reached them). */
  async current(viewer: AuthState): Promise<NextStepView | null> {
    const { doc } = await this.ensure(viewer, isoWeek(new Date()));
    return NextStepService.hasAny(doc) ? this.view(doc) : null;
  }

  /** The viewer opened this week's Next Step (or one of its items): recorded once per item. */
  async open(viewer: AuthState, item: string): Promise<void> {
    const week = isoWeek(new Date());
    const r = await NextStepModel.updateOne(
      { userId: oid(viewer.userId), week, opened: { $ne: item } },
      { $addToSet: { opened: item } },
    );
    if (!r.modifiedCount) return;
    await NextStepModel.updateOne(
      { userId: oid(viewer.userId), week, openedAt: null },
      { $set: { openedAt: new Date() } },
    );
    await this.track(viewer.userId, 'next_step_opened', { item });
  }

  async exportFor(userId: string) {
    const rows = await NextStepModel.find({ userId: oid(userId) })
      .select('week roadmapStep opportunity alumnus readinessScore readinessDelta notifiedAt openedAt opened')
      .lean();
    return { nextSteps: rows.map(({ _id, ...r }) => r) };
  }

  async eraseFor(userId: string) {
    await NextStepModel.deleteMany({ userId: oid(userId) });
  }
}
