import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  SYLLABUS_MAX_TOPICS,
  type EnrollmentView,
  type PersonRef,
  type SubjectView,
  type SyllabusInput,
  type SyllabusView,
  type Branch,
  type SubjectStatus,
  type contributorBody,
  type enrollmentBody,
  type subjectBody,
  type subjectUpdateBody,
  type subjectsQuery,
} from '@campuslink/shared';
import {
  SubjectEnrollmentModel,
  SubjectModel,
  SyllabusTopicModel,
  SyllabusUnitModel,
  type EnrollmentDoc,
  type SubjectDoc,
  type SyllabusTopicDoc,
  type SyllabusUnitDoc,
} from './subject.model.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { withTextSearch } from '../../db/search.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { backgroundAuth } from '../users/users.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';
import type { AuthState } from '../../types.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;
const has = (ids: readonly unknown[] | undefined, id: string) => !!ids?.some((x) => String(x) === id);
/** Only students are limited to the subjects they take; faculty, alumni and admins read them all. */
const onlyStudent = (v: AuthState) => v.roles.length > 0 && v.roles.every((r) => r === 'STUDENT');
/** College admins manage every subject; others manage the subjects they own. */
const isAdmin = (v: AuthState) => v.permissions.has('tenant:settings');
const fieldError = (path: string, message: string) => badRequest(message, [{ path, message }]);

export interface SubjectsDeps {
  profiles: ProfilesService;
}

/**
 * Subjects and their syllabus (Subject → Unit → Topic), who takes them (a branch × batch rule
 * plus per-student overrides), faculty owners and granted contributors. Object-level access is
 * decided here and reused by the library, retrieval and chat (`readableFilter`), so a student
 * never reaches a subject they do not take, through any route.
 */
export class SubjectsService {
  /** Material counts per subject (the library registers it). */
  materialCounts: (subjectIds: Types.ObjectId[]) => Promise<Map<string, number>> = async () => new Map();
  /** Whether the college lets students share material for review (AI settings switch). */
  studentUploadsOpen: () => Promise<boolean> = async () => false;
  /** Topics removed from a syllabus (the library detaches their tags). */
  onTopicsRemoved: (subjectId: Types.ObjectId, topicIds: Types.ObjectId[]) => Promise<void> = async () =>
    undefined;

  constructor(private readonly d: SubjectsDeps) {}

  // ── Access ─────────────────────────────
  /** The filter selecting every subject this viewer may read. */
  async readableFilter(viewer: AuthState): Promise<Record<string, unknown>> {
    if (!onlyStudent(viewer))
      return {
        status: { $in: viewer.permissions.has('study:manage') ? ['active', 'archived'] : ['active'] },
      };
    const { branch, gradYear } = await this.d.profiles.own(viewer.userId);
    const overrides = await SubjectEnrollmentModel.find({ userId: viewer.userId })
      .select('subjectId kind')
      .lean<EnrollmentDoc[]>();
    const include = overrides.filter((o) => o.kind === 'include').map((o) => o.subjectId);
    const exclude = overrides.filter((o) => o.kind === 'exclude').map((o) => o.subjectId);
    return {
      status: 'active',
      ...(exclude.length ? { _id: { $nin: exclude } } : {}),
      $or: [
        { _id: { $in: include } },
        { contributorIds: oid(viewer.userId) },
        {
          $and: [
            { $or: [{ branches: { $size: 0 } }, ...(branch ? [{ branches: branch }] : [])] },
            { $or: [{ batches: { $size: 0 } }, ...(gradYear ? [{ batches: gradYear }] : [])] },
          ],
        },
      ],
    };
  }

  /** Ids of every subject this viewer may read (retrieval and chat scope to these). */
  async readableIds(viewer: AuthState): Promise<Types.ObjectId[]> {
    const rows = await SubjectModel.find(await this.readableFilter(viewer))
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>();
    return rows.map((r) => r._id);
  }

  /** One readable subject, or 404 (an unreadable subject is indistinguishable from a missing one). */
  async readable(viewer: AuthState, id: string): Promise<SubjectDoc> {
    // Composed with $and: the student filter may itself constrain _id (excluded subjects).
    const s = await SubjectModel.findOne({
      $and: [await this.readableFilter(viewer), { _id: oid(id) }],
    }).lean<SubjectDoc>();
    if (!s) throw notFound('Subject');
    return s;
  }

  canManage(viewer: AuthState, s: Pick<SubjectDoc, 'ownerIds'>): boolean {
    return viewer.permissions.has('study:manage') && (isAdmin(viewer) || has(s.ownerIds, viewer.userId));
  }

  /** Study insights (aggregates only): admins for every subject, faculty for subjects they own. */
  canAnalyse(viewer: AuthState, s: Pick<SubjectDoc, 'ownerIds'>): boolean {
    return viewer.permissions.has('study:analytics') && (isAdmin(viewer) || has(s.ownerIds, viewer.userId));
  }

  /** One subject whose insights this viewer may see, or 403 (404 when it is not readable at all). */
  async analysable(viewer: AuthState, id: string): Promise<SubjectDoc> {
    const s = await this.readable(viewer, id);
    if (!this.canAnalyse(viewer, s)) throw forbidden();
    return s;
  }

  /** Staff upload to any subject; granted contributors only to theirs (and their uploads are reviewed). */
  canUpload(viewer: AuthState, s: Pick<SubjectDoc, 'contributorIds' | 'status'>): boolean {
    if (s.status !== 'active') return false;
    return (
      viewer.permissions.has('study:upload') ||
      (viewer.permissions.has('study:contribute') && has(s.contributorIds, viewer.userId))
    );
  }

  /** True when this viewer's uploads to `s` publish directly (staff) rather than going to review. */
  publishesDirectly(viewer: AuthState): boolean {
    return viewer.permissions.has('study:upload');
  }

  private async manageable(viewer: AuthState, id: string): Promise<SubjectDoc> {
    const s = await this.readable(viewer, id);
    if (!this.canManage(viewer, s)) throw forbidden();
    return s;
  }

  // ── Views ─────────────────────────────
  private async present(viewer: AuthState, rows: SubjectDoc[], mine: Set<string>): Promise<SubjectView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r._id);
    const count = async (model: typeof SyllabusUnitModel | typeof SyllabusTopicModel) =>
      new Map(
        (
          await model.aggregate<{ _id: Types.ObjectId; n: number }>([
            { $match: { subjectId: { $in: ids } } },
            { $group: { _id: '$subjectId', n: { $sum: 1 } } },
          ])
        ).map((r) => [String(r._id), r.n]),
      );
    const [units, topics, materials, people, open] = await Promise.all([
      count(SyllabusUnitModel),
      count(SyllabusTopicModel),
      this.materialCounts(ids),
      this.d.profiles.refsFor(rows.flatMap((r) => r.ownerIds ?? [])),
      this.studentUploadsOpen(),
    ]);
    return rows.map((s) => {
      const id = String(s._id);
      return {
        id,
        name: s.name,
        code: s.code,
        branches: (s.branches ?? []) as Branch[],
        batches: s.batches ?? [],
        semester: s.semester ?? null,
        regulation: s.regulation ?? '',
        description: s.description ?? '',
        status: s.status as SubjectStatus,
        owners: (s.ownerIds ?? []).map((o) => people.get(String(o)) as PersonRef),
        contributorCount: s.contributorIds?.length ?? 0,
        unitCount: units.get(id) ?? 0,
        topicCount: topics.get(id) ?? 0,
        materialCount: materials.get(id) ?? 0,
        can: {
          manage: this.canManage(viewer, s),
          analyse: this.canAnalyse(viewer, s),
          upload:
            this.canUpload(viewer, s) ||
            (open && s.status === 'active' && viewer.permissions.has('study:read')),
        },
        mine: mine.has(id),
        updatedAt: s.updatedAt.toISOString(),
      };
    });
  }

  private async mineSet(viewer: AuthState, rows: SubjectDoc[]): Promise<Set<string>> {
    if (onlyStudent(viewer)) return new Set(rows.map((r) => String(r._id)));
    return new Set(
      rows
        .filter((r) => has(r.ownerIds, viewer.userId) || has(r.contributorIds, viewer.userId))
        .map((r) => String(r._id)),
    );
  }

  async list(viewer: AuthState, q: z.output<typeof subjectsQuery>): Promise<SubjectView[]> {
    if (q.status === 'archived' && !viewer.permissions.has('study:manage')) return [];
    const parts: Record<string, unknown>[] = [await this.readableFilter(viewer), { status: q.status }];
    if (q.scope === 'mine' && !onlyStudent(viewer))
      parts.push({ $or: [{ ownerIds: oid(viewer.userId) }, { contributorIds: oid(viewer.userId) }] });
    let query = SubjectModel.find({ $and: parts });
    if (q.q) query = withTextSearch(query, q.q);
    const rows = await query.sort({ semester: 1, name: 1 }).limit(200).lean<SubjectDoc[]>();
    return this.present(viewer, rows, await this.mineSet(viewer, rows));
  }

  async get(viewer: AuthState, id: string): Promise<SubjectView> {
    const s = await this.readable(viewer, id);
    const [view] = await this.present(viewer, [s], await this.mineSet(viewer, [s]));
    if (!view) throw notFound('Subject');
    return view;
  }

  // ── Writes ─────────────────────────────
  /** Owners must be faculty, placement or admin members of this college. */
  private async checkOwners(ids: string[], tenant: TenantRecord) {
    for (const id of ids) {
      const a = await backgroundAuth(id, tenant);
      if (!a?.verified || !a.permissions.has('study:manage'))
        throw fieldError('ownerIds', 'Owners must be faculty or staff of this college');
    }
  }

  async create(
    viewer: AuthState,
    tenant: TenantRecord,
    body: z.output<typeof subjectBody>,
    meta: RequestMetaLite,
  ): Promise<SubjectView> {
    const owners = [
      ...new Set(body.ownerIds.length ? body.ownerIds : isAdmin(viewer) ? [] : [viewer.userId]),
    ];
    await this.checkOwners(owners, tenant);
    let s;
    try {
      s = await SubjectModel.create({
        ...body,
        branches: [...new Set(body.branches)],
        batches: [...new Set(body.batches)].sort(),
        ownerIds: owners.map(oid),
        createdBy: oid(viewer.userId),
      });
    } catch (e) {
      if (isDuplicate(e)) throw conflict('A subject with this code already exists for this regulation');
      throw e;
    }
    await audit.record(
      {
        action: 'study.subject_created',
        actorId: viewer.userId,
        targetType: 'subject',
        targetId: String(s._id),
        meta: { code: s.code },
      },
      meta,
    );
    return this.get(viewer, String(s._id));
  }

  async update(
    viewer: AuthState,
    tenant: TenantRecord,
    id: string,
    body: z.output<typeof subjectUpdateBody>,
    meta: RequestMetaLite,
  ): Promise<SubjectView> {
    const before = await this.manageable(viewer, id);
    const set: Record<string, unknown> = { ...body };
    if (body.ownerIds) {
      const owners = [...new Set(body.ownerIds)];
      await this.checkOwners(
        owners.filter((o) => !has(before.ownerIds, o)),
        tenant,
      );
      set.ownerIds = owners.map(oid);
    }
    if (body.branches) set.branches = [...new Set(body.branches)];
    if (body.batches) set.batches = [...new Set(body.batches)].sort();
    try {
      await SubjectModel.updateOne({ _id: before._id }, { $set: set });
    } catch (e) {
      if (isDuplicate(e)) throw conflict('A subject with this code already exists for this regulation');
      throw e;
    }
    if (body.status && body.status !== before.status)
      await audit.record(
        {
          action: body.status === 'archived' ? 'study.subject_archived' : 'study.subject_restored',
          actorId: viewer.userId,
          targetType: 'subject',
          targetId: id,
        },
        meta,
      );
    return this.get(viewer, id);
  }

  // ── Syllabus ─────────────────────────────
  async syllabus(viewer: AuthState, id: string): Promise<SyllabusView> {
    const s = await this.readable(viewer, id);
    return this.tree(s._id);
  }

  private async tree(subjectId: Types.ObjectId): Promise<SyllabusView> {
    const [units, topics] = await Promise.all([
      SyllabusUnitModel.find({ subjectId }).sort({ order: 1 }).lean<SyllabusUnitDoc[]>(),
      SyllabusTopicModel.find({ subjectId }).sort({ order: 1 }).lean<SyllabusTopicDoc[]>(),
    ]);
    return {
      subjectId: String(subjectId),
      units: units.map((u) => ({
        id: String(u._id),
        title: u.title,
        topics: topics
          .filter((t) => String(t.unitId) === String(u._id))
          .map((t) => ({ id: String(t._id), title: t.title, keywords: t.keywords ?? [] })),
      })),
    };
  }

  /**
   * Replaces the tree. Units and topics that carry an id keep it (so material tags survive a
   * re-order or rename); ones left out are deleted and their tags detached.
   */
  async saveSyllabus(viewer: AuthState, id: string, body: SyllabusInput): Promise<SyllabusView> {
    const s = await this.manageable(viewer, id);
    const total = body.units.reduce((n, u) => n + u.topics.length, 0);
    if (total > SYLLABUS_MAX_TOPICS * 10) throw badRequest('A syllabus can have at most 400 topics');
    const [units, topics] = await Promise.all([
      SyllabusUnitModel.find({ subjectId: s._id }).select('_id').lean<{ _id: Types.ObjectId }[]>(),
      SyllabusTopicModel.find({ subjectId: s._id }).select('_id').lean<{ _id: Types.ObjectId }[]>(),
    ]);
    const unitIds = new Set(units.map((u) => String(u._id)));
    const topicIds = new Set(topics.map((t) => String(t._id)));
    const seen = new Set<string>();
    for (const u of body.units) {
      if (u.id && (!unitIds.has(u.id) || seen.has(u.id))) throw badRequest('Unknown or repeated unit');
      if (u.id) seen.add(u.id);
      for (const t of u.topics) {
        if (t.id && (!topicIds.has(t.id) || seen.has(t.id))) throw badRequest('Unknown or repeated topic');
        if (t.id) seen.add(t.id);
      }
    }
    const keptUnits: Types.ObjectId[] = [];
    const keptTopics: Types.ObjectId[] = [];
    for (const [i, u] of body.units.entries()) {
      let unitId: Types.ObjectId;
      if (u.id) {
        unitId = oid(u.id);
        await SyllabusUnitModel.updateOne(
          { _id: unitId, subjectId: s._id },
          { $set: { title: u.title, order: i } },
        );
      } else {
        unitId = (await SyllabusUnitModel.create({ subjectId: s._id, title: u.title, order: i }))._id;
      }
      keptUnits.push(unitId);
      for (const [j, t] of u.topics.entries()) {
        const fields = { unitId, title: t.title, order: j, keywords: [...new Set(t.keywords)] };
        if (t.id) {
          await SyllabusTopicModel.updateOne({ _id: oid(t.id), subjectId: s._id }, { $set: fields });
          keptTopics.push(oid(t.id));
        } else {
          keptTopics.push((await SyllabusTopicModel.create({ subjectId: s._id, ...fields }))._id);
        }
      }
    }
    const goneTopics = topics.map((t) => t._id).filter((t) => !keptTopics.some((k) => k.equals(t)));
    await SyllabusTopicModel.deleteMany({ subjectId: s._id, _id: { $nin: keptTopics } });
    await SyllabusUnitModel.deleteMany({ subjectId: s._id, _id: { $nin: keptUnits } });
    if (goneTopics.length) await this.onTopicsRemoved(s._id, goneTopics);
    await SubjectModel.updateOne({ _id: s._id }, { $set: { updatedAt: new Date() } });
    return this.tree(s._id);
  }

  /** Every subject's name and code (Admin › AI assistant coverage; callers check permission). */
  async briefs(): Promise<{ id: string; name: string; code: string; status: SubjectStatus }[]> {
    const rows = await SubjectModel.find({})
      .sort({ name: 1 })
      .select('name code status')
      .lean<Pick<SubjectDoc, '_id' | 'name' | 'code' | 'status'>[]>();
    return rows.map((r) => ({
      id: String(r._id),
      name: r.name,
      code: r.code,
      status: r.status as SubjectStatus,
    }));
  }

  async hasUnit(subjectId: Types.ObjectId, unitId: string): Promise<boolean> {
    return !!(await SyllabusUnitModel.exists({ subjectId, _id: oid(unitId) }));
  }

  /** Topic ids that belong to a subject (to validate material tags). */
  async topicsOf(
    subjectId: Types.ObjectId,
  ): Promise<{ id: string; unitId: string; title: string; keywords: string[] }[]> {
    const rows = await SyllabusTopicModel.find({ subjectId }).lean<SyllabusTopicDoc[]>();
    return rows.map((t) => ({
      id: String(t._id),
      unitId: String(t.unitId),
      title: t.title,
      keywords: t.keywords ?? [],
    }));
  }

  // ── Who takes it ─────────────────────────────
  async enrollments(viewer: AuthState, id: string): Promise<EnrollmentView[]> {
    const s = await this.manageable(viewer, id);
    const rows = await SubjectEnrollmentModel.find({ subjectId: s._id })
      .sort({ _id: -1 })
      .limit(500)
      .lean<EnrollmentDoc[]>();
    const people = await this.d.profiles.refsFor(rows.map((r) => r.userId));
    return rows.map((r) => ({
      user: people.get(String(r.userId)) as PersonRef,
      kind: r.kind as EnrollmentView['kind'],
    }));
  }

  async setEnrollment(
    viewer: AuthState,
    tenant: TenantRecord,
    id: string,
    body: z.output<typeof enrollmentBody>,
    meta: RequestMetaLite,
  ) {
    const s = await this.manageable(viewer, id);
    const who = await backgroundAuth(body.userId, tenant);
    if (!who?.roles.includes('STUDENT')) throw fieldError('userId', 'Choose a student of this college');
    await SubjectEnrollmentModel.updateOne(
      { subjectId: s._id, userId: oid(body.userId) },
      { $set: { kind: body.kind, by: oid(viewer.userId) } },
      { upsert: true },
    );
    await audit.record(
      {
        action: 'study.enrollment_changed',
        actorId: viewer.userId,
        targetType: 'subject',
        targetId: id,
        meta: { kind: body.kind, userId: body.userId },
      },
      meta,
    );
    return this.enrollments(viewer, id);
  }

  async removeEnrollment(viewer: AuthState, id: string, userId: string, meta: RequestMetaLite) {
    const s = await this.manageable(viewer, id);
    const r = await SubjectEnrollmentModel.deleteOne({ subjectId: s._id, userId: oid(userId) });
    if (r.deletedCount)
      await audit.record(
        {
          action: 'study.enrollment_changed',
          actorId: viewer.userId,
          targetType: 'subject',
          targetId: id,
          meta: { kind: 'removed', userId },
        },
        meta,
      );
    return this.enrollments(viewer, id);
  }

  /** Admins grant alumni (or certified contributors) the right to contribute to one subject. */
  async setContributor(
    viewer: AuthState,
    tenant: TenantRecord,
    id: string,
    body: z.output<typeof contributorBody>,
    meta: RequestMetaLite,
  ): Promise<SubjectView> {
    if (!isAdmin(viewer)) throw forbidden();
    const s = await this.readable(viewer, id);
    if (body.grant) {
      const who = await backgroundAuth(body.userId, tenant);
      if (!who?.verified || !who.permissions.has('study:contribute') || who.permissions.has('study:upload'))
        throw fieldError('userId', 'Choose an alumnus or a certified contributor');
    }
    await SubjectModel.updateOne(
      { _id: s._id },
      body.grant
        ? { $addToSet: { contributorIds: oid(body.userId) } }
        : { $pull: { contributorIds: oid(body.userId) } },
    );
    await audit.record(
      {
        action: body.grant ? 'study.contributor_granted' : 'study.contributor_revoked',
        actorId: viewer.userId,
        targetType: 'subject',
        targetId: id,
        meta: { userId: body.userId },
      },
      meta,
    );
    return this.get(viewer, id);
  }

  async contributors(viewer: AuthState, id: string): Promise<PersonRef[]> {
    const s = await this.manageable(viewer, id);
    const people = await this.d.profiles.refsFor(s.contributorIds ?? []);
    return (s.contributorIds ?? []).map((c) => people.get(String(c)) as PersonRef);
  }

  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    const u = oid(userId);
    const [roles, overrides] = await Promise.all([
      SubjectModel.find({ $or: [{ ownerIds: u }, { contributorIds: u }, { createdBy: u }] })
        .select('name code ownerIds contributorIds createdBy')
        .lean<SubjectDoc[]>(),
      SubjectEnrollmentModel.find({ userId: u }).lean<EnrollmentDoc[]>(),
    ]);
    return {
      subjects: roles.map((s) => ({
        subject: `${s.code} ${s.name}`,
        owner: has(s.ownerIds, userId),
        contributor: has(s.contributorIds, userId),
        created: String(s.createdBy) === userId,
      })),
      enrollmentOverrides: overrides.map((o) => ({ subjectId: String(o.subjectId), kind: o.kind })),
    };
  }

  /** Subjects belong to the college: the member is removed from owners and contributors. */
  async eraseFor(userId: string) {
    const u = oid(userId);
    await SubjectModel.updateMany({ ownerIds: u }, { $pull: { ownerIds: u } });
    await SubjectModel.updateMany({ contributorIds: u }, { $pull: { contributorIds: u } });
    await SubjectEnrollmentModel.deleteMany({ userId: u });
  }
}
