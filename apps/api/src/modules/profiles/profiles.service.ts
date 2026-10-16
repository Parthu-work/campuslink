import { Types } from 'mongoose';
import {
  PROFILE_FIELDS,
  type Audience,
  type ProfileBody,
  type ProfileField,
  type PublicProfile,
  type PersonRef,
  type AuthorRef,
  type Role,
} from '@campuslink/shared';
import type { z } from 'zod';
import type { directoryQuery } from '@campuslink/shared';
import { ProfileModel, type Profile } from './profile.model.js';
import { UserModel } from '../auth/user.model.js';
import type { FieldCipher } from '../../lib/crypto.js';
import type { FilesService } from '../files/files.service.js';
import { withTextSearch } from '../../db/search.js';
import { notFound } from '../../lib/errors.js';
import { companyKey } from '../../lib/company.js';
import type { AuthState } from '../../types.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';

const SENIOR_ROLES: Role[] = ['ALUMNI', 'FACULTY', 'TPO', 'COLLEGE_ADMIN'];
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type ProfileDoc = Profile & { _id: Types.ObjectId; userId: Types.ObjectId };

/** Can `viewer` see a field with this audience on someone else's profile? */
export function canSee(audience: Audience, viewerRoles: Role[], isSelf: boolean): boolean {
  if (isSelf) return true;
  if (audience === 'members') return true;
  if (audience === 'alumni_staff') return viewerRoles.some((r) => SENIOR_ROLES.includes(r));
  return false;
}

export class ProfilesService {
  constructor(
    private readonly cipher: FieldCipher,
    private readonly files: FilesService,
  ) {}

  /** Creates the profile if missing and syncs denormalised fields from the user record. */
  async sync(
    userId: string | Types.ObjectId,
    seed: { branch?: string | null; gradYear?: number | null } = {},
  ): Promise<void> {
    const u = await UserModel.findById(userId).select('name roles verified status').lean();
    if (!u) return;
    const set: Record<string, unknown> = {
      name: u.name,
      roles: u.roles,
      verified: !!u.verified && u.status === 'active',
    };
    if (seed.branch !== undefined) set.branch = seed.branch;
    if (seed.gradYear !== undefined) set.gradYear = seed.gradYear;
    await ProfileModel.updateOne({ userId: u._id }, { $set: set }, { upsert: true });
  }

  private async load(userId: string): Promise<ProfileDoc> {
    let p = await ProfileModel.findOne({ userId }).lean<ProfileDoc>();
    if (!p) {
      await this.sync(userId);
      p = await ProfileModel.findOne({ userId }).lean<ProfileDoc>();
    }
    if (!p) throw notFound('Profile');
    return p;
  }

  private present(p: ProfileDoc, viewer: AuthState, email: string | null): PublicProfile {
    const isSelf = String(p.userId) === viewer.userId;
    const vis = (p.visibility ?? {}) as Record<ProfileField, Audience>;
    const values: Record<ProfileField, unknown> = {
      headline: p.headline || undefined,
      company: p.company || undefined,
      jobTitle: p.jobTitle || undefined,
      location: p.location || undefined,
      bio: p.bio || undefined,
      skills: p.skills?.length ? p.skills : undefined,
      topics: p.topics?.length ? p.topics : undefined,
      languages: p.languages?.length ? p.languages : undefined,
      links: p.links?.length ? p.links : undefined,
      email: email ?? undefined,
      phone: p.phoneEnc ? this.cipher.decrypt(p.phoneEnc) : undefined,
      branch: p.branch ?? undefined,
      gradYear: p.gradYear ?? undefined,
    };
    const fields: PublicProfile['fields'] = {};
    for (const f of PROFILE_FIELDS) {
      if (values[f] === undefined) continue;
      if (canSee(vis[f] ?? 'members', viewer.roles, isSelf))
        (fields as Record<string, unknown>)[f] = values[f];
    }
    return {
      userId: String(p.userId),
      name: p.name,
      roles: p.roles,
      verified: p.verified,
      avatarFileId: p.avatarFileId ? String(p.avatarFileId) : null,
      companyVerified: p.companyVerified?.domain
        ? { company: p.companyVerified.company ?? '', domain: p.companyVerified.domain }
        : null,
      fields,
    };
  }

  async mine(viewer: AuthState) {
    const p = await this.load(viewer.userId);
    const u = await UserModel.findById(viewer.userId).select('email').lean();
    return { profile: this.present(p, viewer, u?.email ?? null), visibility: p.visibility };
  }

  async updateMine(viewer: AuthState, body: ProfileBody) {
    await this.load(viewer.userId);
    const { visibility, phone, ...rest } = body;
    const set: Record<string, unknown> = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined),
    );
    if (phone !== undefined) set.phoneEnc = phone ? this.cipher.encrypt(phone) : null;
    if (typeof rest.company === 'string') set.companyKey = companyKey(rest.company);
    for (const [f, a] of Object.entries(visibility ?? {})) set[`visibility.${f}`] = a;
    await ProfileModel.updateOne({ userId: viewer.userId }, { $set: set });
    return this.mine(viewer);
  }

  /** Someone else's profile: only verified, active members are visible, field by field. */
  async view(viewer: AuthState, userId: string) {
    const p = await ProfileModel.findOne({
      userId,
      ...(userId === viewer.userId ? {} : { verified: true }),
    }).lean<ProfileDoc>();
    if (!p) throw notFound('Profile');
    const u = await UserModel.findById(userId).select('email').lean();
    return this.present(p, viewer, u?.email ?? null);
  }

  async directory(viewer: AuthState, q: z.output<typeof directoryQuery>) {
    const filter: Record<string, unknown> = { verified: true };
    if (q.role) filter.roles = q.role;
    if (q.branch) filter.branch = q.branch;
    if (q.batchFrom || q.batchTo)
      filter.gradYear = {
        ...(q.batchFrom ? { $gte: q.batchFrom } : {}),
        ...(q.batchTo ? { $lte: q.batchTo } : {}),
      };
    if (q.cursor) filter._id = { $lt: new Types.ObjectId(q.cursor) };
    let query = ProfileModel.find(filter)
      .sort({ _id: -1 })
      .limit(q.limit + 1);
    if (q.q) {
      query =
        q.q.length >= 3
          ? withTextSearch(query, q.q)
          : query.where({ name: new RegExp(`^${escapeRegex(q.q)}`, 'i') });
    }
    const rows = await query.lean<ProfileDoc[]>();
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((p) => this.present(p, viewer, null)),
      nextCursor: rows.length > q.limit ? String(page.at(-1)?._id) : null,
    };
  }

  /** Command-palette search: people only for now (jobs, roadmaps and posts join in later phases). */
  async search(viewer: AuthState, text: string) {
    let rows = await withTextSearch(ProfileModel.find({ verified: true }), text)
      .limit(8)
      .lean<ProfileDoc[]>();
    if (!rows.length)
      rows = await ProfileModel.find({ verified: true, name: new RegExp(escapeRegex(text), 'i') })
        .limit(8)
        .lean<ProfileDoc[]>();
    return { people: rows.map((p) => this.present(p, viewer, null)) };
  }

  async setAvatar(viewer: AuthState, data: Buffer, meta: RequestMetaLite) {
    const p = await this.load(viewer.userId);
    const file = await this.files.storeImage(viewer.userId, 'avatar', data);
    await ProfileModel.updateOne(
      { userId: viewer.userId },
      { $set: { avatarFileId: new Types.ObjectId(file.id) } },
    );
    if (p.avatarFileId) await this.files.remove(p.avatarFileId);
    await audit.record(
      {
        action: 'profile.avatar_changed',
        actorId: viewer.userId,
        targetType: 'user',
        targetId: viewer.userId,
      },
      meta,
    );
    return { avatarFileId: file.id };
  }

  /** Names and avatars for lists (requests, bookings, conversations). Missing users read as "Former member". */
  async refsFor(userIds: (string | Types.ObjectId)[]): Promise<Map<string, PersonRef>> {
    const ids = [...new Set(userIds.map(String))];
    const rows = await ProfileModel.find({ userId: { $in: ids } })
      .select('userId name avatarFileId')
      .lean<ProfileDoc[]>();
    const map = new Map<string, PersonRef>();
    for (const id of ids) map.set(id, { userId: id, name: 'Former member', avatarFileId: null });
    for (const p of rows)
      map.set(String(p.userId), {
        userId: String(p.userId),
        name: p.name,
        avatarFileId: p.avatarFileId ? String(p.avatarFileId) : null,
      });
    return map;
  }

  /** Author cards for content (headline, branch and batch only when visible to this viewer). */
  async authorsFor(viewer: AuthState, userIds: (string | Types.ObjectId)[]): Promise<Map<string, AuthorRef>> {
    const ids = [...new Set(userIds.map(String))];
    const rows = await ProfileModel.find({ userId: { $in: ids } }).lean<ProfileDoc[]>();
    const map = new Map<string, AuthorRef>();
    for (const id of ids)
      map.set(id, {
        userId: id,
        name: 'Former member',
        avatarFileId: null,
        roles: [],
        headline: '',
        branch: null,
        gradYear: null,
      });
    for (const p of rows) {
      const v = this.present(p, viewer, null);
      map.set(v.userId, {
        userId: v.userId,
        name: v.name,
        avatarFileId: v.avatarFileId,
        roles: v.roles,
        headline: v.fields.headline ?? '',
        branch: (v.fields.branch ?? null) as AuthorRef['branch'],
        gradYear: v.fields.gradYear ?? null,
      });
    }
    return map;
  }

  /** Facts used for feed ranking and suggestions (own profile, never shown to others). */
  async rankingFacts(userIds: (string | Types.ObjectId)[]) {
    const rows = await ProfileModel.find({ userId: { $in: userIds } })
      .select('userId roles branch')
      .lean<ProfileDoc[]>();
    return new Map(
      rows.map((p) => [String(p.userId), { alumni: p.roles.includes('ALUMNI'), branch: p.branch ?? null }]),
    );
  }

  /** Verified alumni of a branch (follow suggestions). */
  async alumniOfBranch(branch: string | null, exclude: string[], limit: number) {
    const rows = await ProfileModel.find({
      verified: true,
      roles: 'ALUMNI',
      userId: { $nin: exclude },
      ...(branch ? { branch } : {}),
    })
      .sort({ _id: -1 })
      .limit(limit)
      .select('userId')
      .lean<ProfileDoc[]>();
    return rows.map((r) => String(r.userId));
  }

  /** What `viewer` may see of each verified, active member in `userIds` (visibility applied). */
  async viewsFor(viewer: AuthState, userIds: (string | Types.ObjectId)[]): Promise<PublicProfile[]> {
    if (!userIds.length) return [];
    const rows = await ProfileModel.find({ userId: { $in: userIds }, verified: true })
      .sort({ _id: -1 })
      .lean<ProfileDoc[]>();
    return rows.map((p) => this.present(p, viewer, null));
  }

  /** The viewer's own profile values (for matching): never shown to anyone else. */
  async own(
    userId: string,
  ): Promise<{ branch: string | null; skills: string[]; languages: string[]; topics: string[] }> {
    const p = await this.load(userId);
    return {
      branch: p.branch ?? null,
      skills: p.skills ?? [],
      languages: p.languages ?? [],
      topics: p.topics ?? [],
    };
  }

  /**
   * Verified alumni per company key whose company field `viewer` may see (the "alumni at this
   * company" badge never reveals a company someone hid). The viewer is never counted.
   */
  async alumniAtCompanies(viewer: AuthState, keys: string[]): Promise<Map<string, string[]>> {
    const wanted = [...new Set(keys.filter(Boolean))];
    const map = new Map<string, string[]>();
    if (!wanted.length) return map;
    const rows = await ProfileModel.find({ companyKey: { $in: wanted }, verified: true, roles: 'ALUMNI' })
      .select('userId companyKey visibility')
      .limit(5000)
      .lean<ProfileDoc[]>();
    for (const p of rows) {
      if (String(p.userId) === viewer.userId) continue;
      const vis = (p.visibility ?? {}) as Record<ProfileField, Audience>;
      if (!canSee(vis.company ?? 'members', viewer.roles, false)) continue;
      const k = p.companyKey ?? '';
      map.set(k, [...(map.get(k) ?? []), String(p.userId)]);
    }
    return map;
  }

  /** Cards for alumni who offer referrals (only fields visible to the viewer). */
  async referrerCards(viewer: AuthState, userIds: string[]) {
    const rows = await ProfileModel.find({ userId: { $in: userIds }, verified: true }).lean<ProfileDoc[]>();
    return new Map(
      rows.map((p) => {
        const v = this.present(p, viewer, null);
        return [
          String(p.userId),
          {
            userId: v.userId,
            name: v.name,
            avatarFileId: v.avatarFileId,
            headline: (v.fields.headline as string | undefined) ?? '',
            jobTitle: (v.fields.jobTitle as string | undefined) ?? '',
            gradYear: (v.fields.gradYear as number | undefined) ?? null,
            branch: (v.fields.branch as AuthorRef['branch'] | undefined) ?? null,
            companyVerified: !!v.companyVerified,
          },
        ];
      }),
    );
  }

  /** The member's own company (for referral settings). */
  async ownCompany(userId: string) {
    const p = await this.load(userId);
    return { company: p.company ?? '', companyKey: p.companyKey ?? '' };
  }

  async isActiveMember(userId: string): Promise<boolean> {
    return !!(await ProfileModel.exists({ userId, verified: true }));
  }

  async setCompanyVerified(userId: string, company: string, domain: string) {
    await this.sync(userId);
    await ProfileModel.updateOne(
      { userId },
      {
        $set: {
          companyVerified: { company, domain, verifiedAt: new Date() },
          company,
          companyKey: companyKey(company),
        },
      },
    );
  }
}
