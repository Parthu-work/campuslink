import { Types } from 'mongoose';
import {
  BUDDY_CHECKLIST,
  BUDDY_MAX_JUNIORS,
  Capability,
  buddyScore,
  inFinalYears,
  isFirstYear,
  suppress,
  type Branch,
  type BuddyBoardView,
  type BuddyChecklistItem,
  type BuddyPairView,
  type BuddyView,
  type PeerMentorStatusView,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import { UserModel } from '../auth/user.model.js';
import { TenantModel } from '../tenants/tenant.model.js';
import type { JobQueue } from '../../lib/jobs.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import {
  BuddyPairModel,
  BuddyVolunteerModel,
  PeerNominationModel,
  type BuddyPairDoc,
} from './peers.model.js';

export const BUDDY_MATCH_JOB = 'peers.buddy_match';
const IST_MS = 5.5 * 3600_000;

export interface PeersDeps {
  notifications: NotificationsService;
  logger: Logger;
  /** Active, verified students (not alumni), with their batch. */
  students: () => Promise<{ userId: string; name: string; branch: string | null; gradYear: number | null }[]>;
  cohortOf: (
    ids: string[],
  ) => Promise<Map<string, { name: string; branch: string | null; gradYear: number | null }>>;
  languagesOf: (ids: string[]) => Promise<Map<string, string[]>>;
  /** The member has a verified offer (B8). */
  hasVerifiedOffer: (userId: string) => Promise<boolean>;
  /** Turns the member's lighter peer mentor settings on or off (mentorship module). */
  setPeerMentor: (userId: string, on: boolean) => Promise<void>;
}

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const WEEK = 7 * 86_400_000;

/**
 * Peer mentors and the Senior Buddy (prompt 2, G7, the `peerMentors` switch).
 *
 * - **Peer mentors**: a final-year with a verified offer, or a student a faculty member nominated,
 *   can mentor juniors. It is the same request flow as alumni mentoring, marked `peer`, with
 *   lighter caps (at most three requests a week, quick chats and short calls only) and juniors
 *   (later batches) only. The `PEER_MENTOR` capability carries `mentorship:mentor`.
 * - **The Senior Buddy**: every first-year is matched in their first week with a senior who
 *   volunteered (same branch first, then a shared language, then the least busy), at most three
 *   first-years each, and the two work through a four-week checklist together.
 */
export class PeersService {
  track: Track = noTrack;

  constructor(private readonly d: PeersDeps) {}

  /** Queues today's buddy matching per active college (job ids dedupe per college and day). */
  static async enqueueDaily(jobs: JobQueue, now = new Date(), only?: ReadonlySet<string>): Promise<number> {
    const day = new Date(now.getTime() + IST_MS).toISOString().slice(0, 10).replaceAll('-', '');
    const tenants = (
      await TenantModel.find({ kind: 'college', status: 'active' }).select('_id').lean()
    ).filter((t) => !only || only.has(String(t._id)));
    for (const t of tenants)
      await jobs.enqueue(
        BUDDY_MATCH_JOB,
        { tenantId: String(t._id) },
        { jobId: `buddy-${String(t._id)}-${day}` },
      );
    return tenants.length;
  }

  // ── Peer mentors ─────────────────────────────

  private async peerReason(viewer: AuthState): Promise<'offer' | 'nominated' | null> {
    if (!viewer.roles.includes('STUDENT') || viewer.roles.includes('ALUMNI') || !viewer.verified) return null;
    const cohort = (await this.d.cohortOf([viewer.userId])).get(viewer.userId);
    if (inFinalYears(cohort?.gradYear) && (await this.d.hasVerifiedOffer(viewer.userId))) return 'offer';
    return (await PeerNominationModel.exists({ userId: oid(viewer.userId) })) ? 'nominated' : null;
  }

  private canVolunteer(viewer: AuthState, gradYear: number | null) {
    return (
      viewer.roles.includes('STUDENT') &&
      !viewer.roles.includes('ALUMNI') &&
      viewer.verified &&
      !!gradYear &&
      !isFirstYear(gradYear)
    );
  }

  async status(viewer: AuthState): Promise<PeerMentorStatusView> {
    const [reason, cohort, volunteer, juniors] = await Promise.all([
      this.peerReason(viewer),
      this.d.cohortOf([viewer.userId]),
      BuddyVolunteerModel.findOne({ userId: oid(viewer.userId) }).lean(),
      BuddyPairModel.countDocuments({ seniorId: oid(viewer.userId), active: true }),
    ]);
    return {
      eligible: !!reason,
      reason,
      active: viewer.capabilities.includes(Capability.PEER_MENTOR),
      buddy: {
        volunteering: !!volunteer?.on,
        juniors,
        max: BUDDY_MAX_JUNIORS,
        canVolunteer: this.canVolunteer(viewer, cohort.get(viewer.userId)?.gradYear ?? null),
      },
    };
  }

  /** Become (or stop being) a peer mentor. Taking it on needs an offer or a nomination. */
  async setPeer(viewer: AuthState, on: boolean): Promise<PeerMentorStatusView> {
    if (on) {
      if (!(await this.peerReason(viewer)))
        throw conflict(
          'Peer mentoring is for final-years with a verified offer, or students faculty nominate',
        );
      await UserModel.updateOne(
        { _id: oid(viewer.userId) },
        { $addToSet: { capabilities: Capability.PEER_MENTOR } },
      );
      await this.d.setPeerMentor(viewer.userId, true);
      viewer.capabilities = [...new Set([...viewer.capabilities, Capability.PEER_MENTOR])];
    } else {
      await UserModel.updateOne(
        { _id: oid(viewer.userId) },
        { $pull: { capabilities: Capability.PEER_MENTOR } },
      );
      await this.d.setPeerMentor(viewer.userId, false);
      viewer.capabilities = viewer.capabilities.filter((c) => c !== Capability.PEER_MENTOR);
    }
    return this.status(viewer);
  }

  /** Faculty nominate a student who has no verified offer yet (or withdraw the nomination). */
  async nominate(actor: AuthState, userId: string, on: boolean) {
    const target = await UserModel.findById(oid(userId))
      .select('roles status')
      .lean<{ roles: string[]; status: string }>();
    if (!target || target.status !== 'active') throw notFound('Student');
    if (!target.roles.includes('STUDENT') || target.roles.includes('ALUMNI'))
      throw badRequest('Only students are nominated as peer mentors');
    if (on) {
      await PeerNominationModel.updateOne(
        { userId: oid(userId) },
        { $setOnInsert: { nominatedBy: oid(actor.userId) } },
        { upsert: true },
      );
      await this.d.notifications
        .notify(userId, 'peer_mentor_nominated', {})
        .catch((err: unknown) => this.d.logger.warn({ err }, 'nomination notify failed'));
    } else {
      await PeerNominationModel.deleteOne({ userId: oid(userId) });
      // Without the nomination and without an offer, peer mentoring ends.
      const cohort = (await this.d.cohortOf([userId])).get(userId);
      const offer = inFinalYears(cohort?.gradYear) && (await this.d.hasVerifiedOffer(userId));
      if (!offer) {
        await UserModel.updateOne({ _id: oid(userId) }, { $pull: { capabilities: Capability.PEER_MENTOR } });
        await this.d.setPeerMentor(userId, false);
      }
    }
    return { userId, nominated: on };
  }

  async nominations() {
    const rows = await PeerNominationModel.find().sort({ _id: -1 }).limit(500).lean();
    const ids = rows.map((r) => String(r.userId));
    const [cohort, peers] = await Promise.all([
      this.d.cohortOf(ids),
      UserModel.find({ _id: { $in: ids.map(oid) }, capabilities: Capability.PEER_MENTOR })
        .select('_id')
        .lean(),
    ]);
    const active = new Set(peers.map((p) => String(p._id)));
    return rows.map((r) => {
      const c = cohort.get(String(r.userId));
      return {
        userId: String(r.userId),
        name: c?.name ?? '',
        branch: (c?.branch ?? null) as Branch | null,
        gradYear: c?.gradYear ?? null,
        active: active.has(String(r.userId)),
        nominatedAt: r.createdAt.toISOString(),
      };
    });
  }

  // ── The Senior Buddy ─────────────────────────────

  async volunteer(viewer: AuthState, on: boolean): Promise<PeerMentorStatusView> {
    const cohort = (await this.d.cohortOf([viewer.userId])).get(viewer.userId);
    if (on && !this.canVolunteer(viewer, cohort?.gradYear ?? null))
      throw conflict('Senior buddies are verified students past their first year');
    await BuddyVolunteerModel.updateOne({ userId: oid(viewer.userId) }, { $set: { on } }, { upsert: true });
    // Stepping down hands the first-years back to matching (the next run finds them a buddy).
    if (!on)
      await BuddyPairModel.updateMany(
        { seniorId: oid(viewer.userId), active: true },
        { $set: { active: false, endedAt: new Date() } },
      );
    return this.status(viewer);
  }

  private pairView(
    p: BuddyPairDoc,
    role: 'junior' | 'senior',
    people: Map<string, { name: string; branch: string | null; gradYear: number | null }>,
  ): BuddyPairView {
    const otherId = String(role === 'junior' ? p.seniorId : p.juniorId);
    const other = people.get(otherId);
    return {
      id: String(p._id),
      role,
      other: {
        userId: otherId,
        name: other?.name ?? '',
        branch: (other?.branch ?? null) as Branch | null,
        gradYear: other?.gradYear ?? null,
      },
      matchedAt: p.createdAt.toISOString(),
      week: Math.min(5, 1 + Math.floor((Date.now() - p.createdAt.getTime()) / WEEK)),
      checklist: BUDDY_CHECKLIST.map((item) => ({
        item,
        doneAt: p.checklist.find((c) => c.item === item)?.doneAt?.toISOString() ?? null,
      })),
    };
  }

  async buddy(viewer: AuthState): Promise<BuddyView> {
    const me = oid(viewer.userId);
    const [mine, juniors] = await Promise.all([
      BuddyPairModel.findOne({ juniorId: me, active: true }).lean<BuddyPairDoc>(),
      BuddyPairModel.find({ seniorId: me, active: true }).sort({ _id: 1 }).lean<BuddyPairDoc[]>(),
    ]);
    const ids = [...(mine ? [String(mine.seniorId)] : []), ...juniors.map((j) => String(j.juniorId))];
    const people = ids.length ? await this.d.cohortOf(ids) : new Map();
    return {
      mine: mine ? this.pairView(mine, 'junior', people) : null,
      juniors: juniors.map((j) => this.pairView(j, 'senior', people)),
    };
  }

  /** Either side of a pair ticks a checklist item. */
  async check(
    viewer: AuthState,
    pairId: string,
    item: BuddyChecklistItem,
    done: boolean,
  ): Promise<BuddyView> {
    const me = oid(viewer.userId);
    const r = await BuddyPairModel.updateOne(
      { _id: oid(pairId), active: true, $or: [{ juniorId: me }, { seniorId: me }], 'checklist.item': item },
      { $set: { 'checklist.$.doneAt': done ? new Date() : null, 'checklist.$.doneBy': done ? me : null } },
    );
    if (!r.matchedCount) throw notFound('Buddy');
    return this.buddy(viewer);
  }

  /**
   * Job (daily per college): first-years without a buddy get one from the volunteers. Same branch
   * first, then a shared language, then the senior with the fewest first-years; at most
   * BUDDY_MAX_JUNIORS each. Safe to run twice: one live buddy per first-year is a unique index.
   */
  async matchFirstYears(now = new Date()): Promise<{ matched: number; waiting: number }> {
    const students = await this.d.students();
    const byId = new Map(students.map((s) => [s.userId, s]));
    const firstYears = students.filter((s) => isFirstYear(s.gradYear, now));
    const paired = new Set(
      (
        await BuddyPairModel.find({ juniorId: { $in: firstYears.map((f) => oid(f.userId)) }, active: true })
          .select('juniorId')
          .lean<{ juniorId: Types.ObjectId }[]>()
      ).map((p) => String(p.juniorId)),
    );
    const waiting = firstYears.filter((f) => !paired.has(f.userId));
    if (!waiting.length) return { matched: 0, waiting: 0 };
    const volunteers = (
      await BuddyVolunteerModel.find({ on: true }).select('userId').lean<{ userId: Types.ObjectId }[]>()
    )
      .map((v) => String(v.userId))
      .filter((id) => {
        const s = byId.get(id);
        return !!s && !!s.gradYear && !isFirstYear(s.gradYear, now);
      });
    if (!volunteers.length) return { matched: 0, waiting: waiting.length };
    const loads = new Map<string, number>(volunteers.map((v) => [v, 0]));
    for (const row of await BuddyPairModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { seniorId: { $in: volunteers.map(oid) }, active: true } },
      { $group: { _id: '$seniorId', n: { $sum: 1 } } },
    ]))
      loads.set(String(row._id), row.n);
    const languages = await this.d.languagesOf([...waiting.map((w) => w.userId), ...volunteers]);
    let matched = 0;
    for (const junior of waiting) {
      const j = { branch: junior.branch, languages: languages.get(junior.userId) ?? [] };
      const best = volunteers
        .filter((v) => (loads.get(v) ?? 0) < BUDDY_MAX_JUNIORS)
        .map((v) => ({
          v,
          score: buddyScore(j, {
            branch: byId.get(v)?.branch ?? null,
            languages: languages.get(v) ?? [],
            juniors: loads.get(v) ?? 0,
          }),
        }))
        .sort((a, b) => b.score - a.score || a.v.localeCompare(b.v))[0];
      if (!best) break;
      try {
        await BuddyPairModel.create({ juniorId: oid(junior.userId), seniorId: oid(best.v) });
      } catch (e) {
        if ((e as { code?: number }).code === 11000) continue; // matched by a run at the same time
        throw e;
      }
      loads.set(best.v, (loads.get(best.v) ?? 0) + 1);
      matched++;
      const senior = byId.get(best.v);
      await this.track(junior.userId, 'buddy_matched', { side: 'junior' });
      await Promise.all([
        this.d.notifications.notify(junior.userId, 'buddy_matched', {
          name: senior?.name.trim().split(/\s+/)[0] ?? '',
          role: 'junior',
        }),
        this.d.notifications.notify(best.v, 'buddy_matched', {
          name: junior.name.trim().split(/\s+/)[0] ?? '',
          role: 'senior',
        }),
      ]).catch((err: unknown) => this.d.logger.warn({ err }, 'buddy notify failed'));
    }
    return { matched, waiting: waiting.length - matched };
  }

  /** Staff: how matching is going this year (counts, suppressed). */
  async board(now = new Date()): Promise<BuddyBoardView> {
    const firstYears = (await this.d.students()).filter((s) => isFirstYear(s.gradYear, now));
    const matched = await BuddyPairModel.countDocuments({
      juniorId: { $in: firstYears.map((f) => oid(f.userId)) },
      active: true,
    });
    return {
      firstYears: suppress(firstYears.length),
      matched: suppress(matched),
      waiting: suppress(firstYears.length - matched),
      volunteers: await BuddyVolunteerModel.countDocuments({ on: true }),
    };
  }

  // ── Privacy ─────────────────────────────

  async exportFor(userId: string) {
    const me = oid(userId);
    const [nomination, volunteer, pairs] = await Promise.all([
      PeerNominationModel.findOne({ userId: me }).select('createdAt').lean(),
      BuddyVolunteerModel.findOne({ userId: me }).select('on updatedAt').lean(),
      BuddyPairModel.find({ $or: [{ juniorId: me }, { seniorId: me }] }).lean<BuddyPairDoc[]>(),
    ]);
    return {
      peerNomination: nomination ? { nominatedAt: nomination.createdAt } : null,
      buddyVolunteer: volunteer ? { on: volunteer.on } : null,
      buddyPairs: pairs.map((p) => ({
        role: String(p.juniorId) === userId ? 'first-year' : 'senior buddy',
        matchedAt: p.createdAt,
        endedAt: p.endedAt,
        checklist: p.checklist.map((c) => ({ item: c.item, doneAt: c.doneAt })),
      })),
    };
  }

  /** Erasure: their nomination, volunteering and pairs go; a first-year left without a buddy is matched again. */
  async eraseFor(userId: string) {
    const me = oid(userId);
    await PeerNominationModel.deleteMany({ userId: me });
    await PeerNominationModel.updateMany({ nominatedBy: me }, { $set: { nominatedBy: null } });
    await BuddyVolunteerModel.deleteMany({ userId: me });
    await BuddyPairModel.deleteMany({ $or: [{ juniorId: me }, { seniorId: me }] });
  }
}
