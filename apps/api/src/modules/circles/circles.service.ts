import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  CIRCLES_PER_MEMBER,
  type CircleView,
  type circleBody,
  type circleDecisionBody,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import type { CircleScope } from '../../lib/circle-scope.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import { CircleMemberModel, CircleModel, type CircleDoc } from './circle.model.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
/** Open proposals a member may have waiting at once. */
const PROPOSALS_OPEN_MAX = 3;

/**
 * Circles (prompt 2, G7): communities per batch, branch, club or interest. Staff create them;
 * students and alumni propose them and staff approve. Their posts, questions and events live in
 * the feed, Q&A and events (with the circle's id) and are visible to members only; moderation is
 * the existing framework's. A batch circle is for its batch and a branch circle for its branch.
 */
export class CirclesService implements CircleScope {
  track: Track = noTrack;

  constructor(private readonly d: { profiles: ProfilesService }) {}

  /** The circles a member belongs to (active ones): the visibility key for posts, questions and events. */
  async memberCircleIds(userId: string): Promise<Types.ObjectId[]> {
    const rows = await CircleMemberModel.find({ userId: oid(userId) })
      .select('circleId')
      .limit(CIRCLES_PER_MEMBER * 2)
      .lean<{ circleId: Types.ObjectId }[]>();
    if (!rows.length) return [];
    const active = await CircleModel.find({ _id: { $in: rows.map((r) => r.circleId) }, status: 'active' })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>();
    return active.map((c) => c._id);
  }

  /** A filter on documents with a `circleId`: outside any circle, or in one of the viewer's. */
  async condition(viewer: AuthState): Promise<Record<string, unknown>> {
    const mine = await this.memberCircleIds(viewer.userId);
    return { $or: [{ circleId: null }, ...(mine.length ? [{ circleId: { $in: mine } }] : [])] };
  }

  /** Whether the viewer may read a circle's content: a member of the active circle, or staff who manage circles. */
  async canSee(viewer: AuthState, circleId: Types.ObjectId | string | null | undefined): Promise<boolean> {
    if (!circleId) return true;
    if (viewer.permissions.has('circles:manage')) return true;
    return this.isMember(viewer.userId, circleId);
  }

  async names(ids: (Types.ObjectId | string)[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await CircleModel.find({ _id: { $in: [...new Set(ids.map(String))].map(oid) } })
      .select('name')
      .lean<{ _id: Types.ObjectId; name: string }[]>();
    return new Map(rows.map((r) => [String(r._id), r.name]));
  }

  async isMember(userId: string, circleId: Types.ObjectId | string): Promise<boolean> {
    const c = await CircleModel.exists({ _id: oid(circleId), status: 'active' });
    if (!c) return false;
    return !!(await CircleMemberModel.exists({ circleId: oid(circleId), userId: oid(userId) }));
  }

  /** Before posting, asking or creating an event in a circle: members only. */
  async assertCanPost(
    viewer: AuthState,
    circleId: string | null | undefined,
  ): Promise<Types.ObjectId | null> {
    if (!circleId) return null;
    if (!(await this.isMember(viewer.userId, circleId))) throw notFound('Circle');
    return oid(circleId);
  }

  private async views(viewer: AuthState, rows: CircleDoc[]): Promise<CircleView[]> {
    const joined = new Set(
      (
        await CircleMemberModel.find({
          userId: oid(viewer.userId),
          circleId: { $in: rows.map((r) => r._id) },
        })
          .select('circleId')
          .lean<{ circleId: Types.ObjectId }[]>()
      ).map((m) => String(m.circleId)),
    );
    const creators = rows.map((r) => r.createdBy).filter((x): x is Types.ObjectId => !!x);
    const people = creators.length
      ? await this.d.profiles.cohortOf(creators)
      : new Map<string, { name: string }>();
    const staff = viewer.permissions.has('circles:manage');
    return rows.map((c) => ({
      id: String(c._id),
      name: c.name,
      kind: c.kind,
      description: c.description,
      branch: c.branch,
      gradYear: c.gradYear,
      status: c.status,
      members: c.members,
      joined: joined.has(String(c._id)),
      manage: staff || (!!c.createdBy && String(c.createdBy) === viewer.userId),
      createdBy: c.createdBy
        ? { id: String(c.createdBy), name: people.get(String(c.createdBy))?.name ?? '' }
        : null,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  /** Who may join: batch circles their batch, branch circles their branch, clubs and interests anyone. */
  private async mayJoin(viewer: AuthState, c: Pick<CircleDoc, 'kind' | 'branch' | 'gradYear'>) {
    if (c.kind !== 'batch' && c.kind !== 'branch') return true;
    if (viewer.permissions.has('circles:manage')) return true;
    const own = await this.d.profiles.own(viewer.userId);
    return c.kind === 'batch' ? own.gradYear === c.gradYear : own.branch === c.branch;
  }

  async list(viewer: AuthState, scope: 'mine' | 'discover' | 'pending'): Promise<CircleView[]> {
    if (scope === 'mine') {
      const ids = await this.memberCircleIds(viewer.userId);
      const rows = await CircleModel.find({ _id: { $in: ids } })
        .sort({ name: 1 })
        .lean<CircleDoc[]>();
      return this.views(viewer, rows);
    }
    if (scope === 'pending') {
      const filter = viewer.permissions.has('circles:manage')
        ? { status: 'pending' }
        : { status: 'pending', createdBy: oid(viewer.userId) };
      return this.views(
        viewer,
        await CircleModel.find(filter).sort({ _id: 1 }).limit(200).lean<CircleDoc[]>(),
      );
    }
    const own = await this.d.profiles.own(viewer.userId);
    const staff = viewer.permissions.has('circles:manage');
    const rows = await CircleModel.find({
      status: 'active',
      ...(staff
        ? {}
        : {
            $or: [
              { kind: { $in: ['club', 'interest'] } },
              ...(own.gradYear ? [{ kind: 'batch', gradYear: own.gradYear }] : []),
              ...(own.branch ? [{ kind: 'branch', branch: own.branch }] : []),
            ],
          }),
    })
      .sort({ members: -1, name: 1 })
      .limit(200)
      .lean<CircleDoc[]>();
    return (await this.views(viewer, rows)).filter((c) => staff || !c.joined);
  }

  async get(viewer: AuthState, id: string): Promise<CircleView> {
    const c = await CircleModel.findById(oid(id)).lean<CircleDoc>();
    const staff = viewer.permissions.has('circles:manage');
    const mine = !!c?.createdBy && String(c.createdBy) === viewer.userId;
    if (!c || (c.status !== 'active' && !staff && !mine)) throw notFound('Circle');
    if (
      c.status === 'active' &&
      !staff &&
      !(await this.mayJoin(viewer, c)) &&
      !(await this.isMember(viewer.userId, c._id))
    )
      throw notFound('Circle');
    const [view] = await this.views(viewer, [c]);
    return view as CircleView;
  }

  /** Staff create active circles; anyone else proposes one, which waits for a staff decision. */
  async create(viewer: AuthState, body: z.output<typeof circleBody>): Promise<CircleView> {
    const staff = viewer.permissions.has('circles:manage');
    if (!staff) {
      const open = await CircleModel.countDocuments({ createdBy: oid(viewer.userId), status: 'pending' });
      if (open >= PROPOSALS_OPEN_MAX)
        throw conflict('You have circles waiting for approval. Wait for a decision before proposing more.');
    }
    const c = await CircleModel.create({
      ...body,
      branch: body.kind === 'batch' || body.kind === 'branch' ? body.branch : null,
      gradYear: body.kind === 'batch' ? body.gradYear : null,
      status: staff ? 'active' : 'pending',
      createdBy: oid(viewer.userId),
      decidedBy: staff ? oid(viewer.userId) : null,
    });
    if (staff) await this.addMember(c._id, viewer.userId, 'lead');
    return this.get(viewer, String(c._id));
  }

  async decide(actor: AuthState, id: string, body: z.output<typeof circleDecisionBody>): Promise<CircleView> {
    const from = body.decision === 'archive' ? 'active' : 'pending';
    const to = body.decision === 'approve' ? 'active' : body.decision === 'reject' ? 'rejected' : 'archived';
    const c = await CircleModel.findOneAndUpdate(
      { _id: oid(id), status: from },
      { $set: { status: to, decidedBy: oid(actor.userId) } },
      { returnDocument: 'after' },
    ).lean<CircleDoc>();
    if (!c) {
      if (await CircleModel.exists({ _id: oid(id) })) throw conflict('Already decided');
      throw notFound('Circle');
    }
    // The member who proposed it leads it.
    if (to === 'active' && c.createdBy) await this.addMember(c._id, String(c.createdBy), 'lead');
    const fresh = (await CircleModel.findById(c._id).lean<CircleDoc>()) ?? c;
    const [view] = await this.views(actor, [fresh]);
    return view as CircleView;
  }

  private async addMember(
    circleId: Types.ObjectId,
    userId: string,
    role: 'member' | 'lead',
  ): Promise<boolean> {
    try {
      await CircleMemberModel.create({ circleId, userId: oid(userId), role });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return false;
      throw e;
    }
    await CircleModel.updateOne({ _id: circleId }, { $inc: { members: 1 } });
    return true;
  }

  async join(viewer: AuthState, id: string): Promise<CircleView> {
    const c = await CircleModel.findOne({ _id: oid(id), status: 'active' }).lean<CircleDoc>();
    if (!c) throw notFound('Circle');
    if (!(await this.mayJoin(viewer, c)))
      throw badRequest(c.kind === 'batch' ? 'This circle is for its batch' : 'This circle is for its branch');
    const count = await CircleMemberModel.countDocuments({ userId: oid(viewer.userId) });
    if (count >= CIRCLES_PER_MEMBER) throw conflict(`You can be in up to ${CIRCLES_PER_MEMBER} circles`);
    if (await this.addMember(c._id, viewer.userId, 'member'))
      await this.track(viewer.userId, 'circle_joined', { kind: c.kind });
    return this.get(viewer, id);
  }

  async leave(viewer: AuthState, id: string): Promise<CircleView> {
    const r = await CircleMemberModel.deleteOne({ circleId: oid(id), userId: oid(viewer.userId) });
    if (r.deletedCount) await CircleModel.updateOne({ _id: oid(id) }, { $inc: { members: -1 } });
    return this.get(viewer, id);
  }

  async exportFor(userId: string) {
    const memberships = await CircleMemberModel.find({ userId: oid(userId) }).lean();
    const circles = await CircleModel.find({ _id: { $in: memberships.map((m) => m.circleId) } })
      .select('name kind')
      .lean<{ _id: Types.ObjectId; name: string; kind: string }[]>();
    const names = new Map(circles.map((c) => [String(c._id), c]));
    return {
      circles: memberships.map((m) => ({
        circle: names.get(String(m.circleId))?.name ?? '',
        kind: names.get(String(m.circleId))?.kind ?? '',
        role: m.role,
        joinedAt: m.createdAt,
      })),
      circlesProposed: await CircleModel.find({ createdBy: oid(userId) })
        .select('name kind status createdAt')
        .lean(),
    };
  }

  /** Erasure: memberships go (counts follow); circles they created stay with the college, unattributed. */
  async eraseFor(userId: string) {
    const memberships = await CircleMemberModel.find({ userId: oid(userId) })
      .select('circleId')
      .lean();
    for (const m of memberships) await CircleModel.updateOne({ _id: m.circleId }, { $inc: { members: -1 } });
    await CircleMemberModel.deleteMany({ userId: oid(userId) });
    await CircleModel.updateMany({ createdBy: oid(userId) }, { $set: { createdBy: null } });
    await CircleModel.updateMany({ decidedBy: oid(userId) }, { $set: { decidedBy: null } });
  }
}
