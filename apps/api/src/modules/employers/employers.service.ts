import { createHmac, timingSafeEqual } from 'node:crypto';
import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  EMPLOYER_LIMITS,
  EMPLOYER_PRICING_DEFAULT,
  ErrorCode,
  Role,
  poolCount,
  type BillableView,
  type CandidateReadinessView,
  type CandidateView,
  type ClusterView,
  type EmployerApplyBody,
  type EmployerReviewView,
  type EmployerView,
  type NetworkCollegeView,
  type PoolView,
  type PostingView,
  type ResumeLinkView,
  type RevenueStatementView,
  type candidateStageBody,
  type clusterBody,
  type employerDecisionBody,
  type poolQuery,
  type postingBody,
  type postingPublishBody,
  type recruiterBody,
} from '@campuslink/shared';
import {
  BillableEventModel,
  EmployerUsageModel,
  PostingModel,
  PostingOfferModel,
  type PostingDoc,
} from './employer.model.js';
import {
  CANDIDACY_EMPLOYER_FIELDS,
  NetworkCandidacyModel,
  NetworkClusterModel,
  NetworkProfileModel,
} from '../network/network.model.js';
import { collegeNames, participating } from '../network/network.service.js';
import { TenantModel } from '../tenants/tenant.model.js';
import { findTenantById, invalidateTenant, type TenantRecord } from '../tenants/tenant.cache.js';
import { UserModel } from '../auth/user.model.js';
import { networkInTenant, networkScope, type NetworkActor } from '../../lib/network-scope.js';
import { requireTenantId, runInTenant } from '../../lib/context.js';
import { AppError, badRequest, conflict, notFound, tooMany } from '../../lib/errors.js';
import { hashPassword } from '../../lib/passwords.js';
import { randomToken } from '../../lib/crypto.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { AuthState } from '../../types.js';
import { noTrack, type Track } from '../../lib/product-events.js';

type ClusterRow = { _id: Types.ObjectId; name: string; colleges: Types.ObjectId[] };
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const RESUME_LINK_SEC = 5 * 60;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface EmployersDeps {
  /** Sends the set-password link (proof of the work inbox) to a new employer account. */
  sendSetPassword: (tenant: TenantRecord, email: string, meta: RequestMetaLite) => Promise<void>;
  /** TXT records of a domain (node:dns in production; a stub in tests). */
  resolveTxt: (domain: string) => Promise<string[][]>;
  /** HMAC key for résumé links. */
  signingKey: Buffer;
  /** A college's résumé file, read inside that college (P12). */
  readFile: (fileId: string) => Promise<Buffer>;
  /** A member's readiness, computed on read inside their college (P13); null when not available. */
  readinessOf: (userId: string, tenant: TenantRecord) => Promise<CandidateReadinessView | null>;
  pricing?: () => typeof EMPLOYER_PRICING_DEFAULT;
}

const notApproved = () =>
  new AppError(
    403,
    ErrorCode.NETWORK_NOT_ENABLED,
    'Your company is not approved yet. We will email you once it is.',
  );

/**
 * The recruiter portal and the platform's employer registry (prompt 2, G12, ADR 0014 §9 to §11).
 * Employer-side methods run on the employer's host (its tenant context); every read of a college
 * goes through a named network path.
 */
export class EmployersService {
  track: Track = noTrack;
  constructor(private readonly d: EmployersDeps) {}

  private pricing() {
    return this.d.pricing?.() ?? EMPLOYER_PRICING_DEFAULT;
  }

  private async me(): Promise<TenantRecord> {
    const t = await findTenantById(requireTenantId());
    if (!t || t.kind !== 'employer' || !t.employer) throw notFound('Employer');
    return t;
  }
  private async approved(): Promise<TenantRecord> {
    const t = await this.me();
    if (t.employer?.status !== 'approved' || t.status !== 'active') throw notApproved();
    return t;
  }
  private actor(viewer: AuthState, meta?: RequestMetaLite): NetworkActor {
    return {
      tenantId: String(requireTenantId()),
      kind: 'employer',
      userId: viewer.userId,
      ...(meta ? { meta } : {}),
    };
  }

  /** Counts one use against a limit (N26). */
  private async bump(
    kind: 'pool' | 'candidates' | 'resume' | 'readiness',
    limit: number,
    period: 'hour' | 'day',
  ) {
    const now = new Date();
    const window = period === 'hour' ? now.toISOString().slice(0, 13) : now.toISOString().slice(0, 10);
    const row = await EmployerUsageModel.findOneAndUpdate(
      { kind, window },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now.getTime() + 2 * DAY) } },
      { upsert: true, returnDocument: 'after' },
    ).lean();
    if ((row?.count ?? 0) > limit)
      throw tooMany(`Limit reached: ${limit} a${period === 'hour' ? 'n hour' : ' day'}`);
  }

  // ── Applying (platform host, public) ─────────────────────────────

  async apply(body: EmployerApplyBody, meta: RequestMetaLite) {
    if (await TenantModel.exists({ slug: body.slug })) throw conflict('That address is taken');
    if (
      await TenantModel.exists({
        kind: 'employer',
        'employer.domain': body.domain,
        'employer.status': { $ne: 'rejected' },
      })
    )
      throw conflict('An employer with this domain has already applied');
    const short = body.companyName.slice(0, 24);
    const tenant = await TenantModel.create({
      slug: body.slug,
      kind: 'employer',
      branding: {
        displayName: body.companyName,
        shortName: short,
        primary: '#3b5bdb',
        secondary: '#1e293b',
        accent: '#0ea5e9',
        monogram:
          short
            .split(/\s+/)
            .map((w) => w[0] ?? '')
            .join('')
            .slice(0, 3)
            .toUpperCase() || 'E',
      },
      employer: {
        legalName: body.legalName,
        domain: body.domain,
        gstin: body.gstin,
        status: 'applied',
        dnsToken: randomToken(16),
      },
    });
    const record = tenant.toObject() as unknown as TenantRecord;
    await runInTenant(tenant._id, async () => {
      const user = await UserModel.create({
        email: body.email,
        name: body.name,
        // Unusable until the set-password link (sent to the work address) is used: that proves the inbox.
        passwordHash: await hashPassword(randomToken(32)),
        roles: [Role.EMPLOYER_ADMIN],
        verified: true,
        ageCheckedAt: new Date(),
      });
      await audit.record(
        {
          action: 'employer.applied',
          actorId: String(user._id),
          targetType: 'tenant',
          targetId: String(tenant._id),
          meta: { domain: body.domain },
        },
        meta,
      );
      await this.d.sendSetPassword(record, body.email, meta);
    });
    return { slug: tenant.slug };
  }

  // ── The employer's own account ─────────────────────────────

  private async recruiters() {
    const users = await UserModel.find({
      roles: { $in: [Role.EMPLOYER_ADMIN, Role.RECRUITER] },
      status: 'active',
    })
      .select('name email roles emailVerifiedAt')
      .sort({ _id: 1 })
      .lean();
    return users;
  }

  private view(t: TenantRecord, users: Awaited<ReturnType<EmployersService['recruiters']>>): EmployerView {
    const e = t.employer!; // eslint-disable-line @typescript-eslint/no-non-null-assertion -- me() checked it
    const price = this.pricing();
    return {
      id: String(t._id),
      name: t.branding.displayName,
      legalName: e.legalName,
      domain: e.domain,
      gstin: e.gstin,
      status: e.status,
      emailVerified: users.some((u) => u.roles.includes(Role.EMPLOYER_ADMIN) && !!u.emailVerifiedAt),
      dnsToken: `campuslink-verify=${e.dnsToken}`,
      domainVerifiedAt: e.domainVerifiedAt ? new Date(e.domainVerifiedAt).toISOString() : null,
      recruiters: users.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email ?? '',
        admin: u.roles.includes(Role.EMPLOYER_ADMIN),
      })),
      limits: EMPLOYER_LIMITS,
      pricing: { perPosting: price.perPosting, perDrive: price.perDrive, perHire: price.perHire },
    };
  }

  async account(): Promise<EmployerView> {
    const t = await this.me();
    return this.view(t, await this.recruiters());
  }

  /** Domain control: the DNS TXT record (N23). Verified once the inbox and the domain both are. */
  async verifyDomain(viewer: AuthState, meta: RequestMetaLite): Promise<EmployerView> {
    const t = await this.me();
    const e = t.employer!; // eslint-disable-line @typescript-eslint/no-non-null-assertion -- me() checked it
    const want = `campuslink-verify=${e.dnsToken}`;
    const records = await this.d.resolveTxt(e.domain).catch(() => [] as string[][]);
    if (!records.some((r) => r.join('') === want))
      throw badRequest(`Add a TXT record "${want}" to ${e.domain}, wait a few minutes and try again`);
    const users = await this.recruiters();
    const inbox = users.some((u) => u.roles.includes(Role.EMPLOYER_ADMIN) && !!u.emailVerifiedAt);
    await TenantModel.updateOne(
      { _id: t._id },
      {
        $set: {
          'employer.domainVerifiedAt': new Date(),
          ...(inbox && e.status === 'applied' ? { 'employer.status': 'verified' } : {}),
        },
      },
    );
    invalidateTenant(t.slug);
    await audit.record(
      { action: 'employer.domain_verified', actorId: viewer.userId, meta: { domain: e.domain } },
      meta,
    );
    return this.account();
  }

  async addRecruiter(viewer: AuthState, body: z.output<typeof recruiterBody>, meta: RequestMetaLite) {
    const t = await this.me();
    const e = t.employer!; // eslint-disable-line @typescript-eslint/no-non-null-assertion -- me() checked it
    if (!e.domainVerifiedAt) throw badRequest('Verify the company’s domain first');
    if (body.email.split('@')[1] !== e.domain) throw badRequest(`Recruiters use an address at ${e.domain}`);
    if ((await this.recruiters()).length >= EMPLOYER_LIMITS.seats)
      throw conflict(`An employer has at most ${EMPLOYER_LIMITS.seats} recruiter seats`);
    if (await UserModel.exists({ email: body.email }))
      throw conflict('That person already has an account here');
    const user = await UserModel.create({
      email: body.email,
      name: body.name,
      passwordHash: await hashPassword(randomToken(32)),
      roles: [Role.RECRUITER],
      verified: true,
      ageCheckedAt: new Date(),
    });
    await this.d.sendSetPassword(t, body.email, meta);
    await audit.record(
      {
        action: 'employer.recruiter_added',
        actorId: viewer.userId,
        targetType: 'user',
        targetId: String(user._id),
      },
      meta,
    );
    return this.account();
  }

  async removeRecruiter(viewer: AuthState, userId: string, meta: RequestMetaLite) {
    if (userId === viewer.userId) throw badRequest('You cannot remove yourself');
    const r = await UserModel.updateOne(
      { _id: userId, roles: Role.RECRUITER, status: 'active' },
      { $set: { status: 'suspended' }, $inc: { tokenVersion: 1 } },
    );
    if (!r.modifiedCount) throw notFound('Recruiter');
    await audit.record(
      { action: 'employer.recruiter_removed', actorId: viewer.userId, targetType: 'user', targetId: userId },
      meta,
    );
    return this.account();
  }

  // ── Colleges and clusters ─────────────────────────────

  /** Colleges that take employers and have not blocked this one (public facts: names and cities). */
  private async openColleges(): Promise<{ _id: Types.ObjectId; name: string; city: string | null }[]> {
    const me = String(requireTenantId());
    return (await participating('employerAccess')).filter((c) => !c.blocked.includes(me));
  }

  async colleges(): Promise<{ colleges: NetworkCollegeView[]; clusters: ClusterView[] }> {
    await this.me();
    const open = await this.openColleges();
    const byId = new Map(open.map((c) => [String(c._id), { id: String(c._id), name: c.name, city: c.city }]));
    const clusters = await NetworkClusterModel.find({}).sort({ name: 1 }).lean<ClusterRow[]>();
    return {
      colleges: [...byId.values()],
      clusters: clusters.map((c) => ({
        id: String(c._id),
        name: c.name,
        colleges: c.colleges.map((id) => byId.get(String(id))).filter((x): x is NetworkCollegeView => !!x),
      })),
    };
  }

  // ── Postings ─────────────────────────────

  private async postingView(p: PostingDoc, counts = new Map<string, number>()): Promise<PostingView> {
    const names = await collegeNames(p.colleges.map((c) => c.tenantId));
    return {
      id: String(p._id),
      title: p.title,
      role: p.role,
      type: p.type as PostingView['type'],
      location: p.location,
      ctcRange: p.ctcRange ?? '',
      description: p.description,
      branches: p.branches as PostingView['branches'],
      gradYears: p.gradYears,
      closesAt: p.closesAt.toISOString(),
      status: p.status as PostingView['status'],
      colleges: p.colleges.map((c) => ({
        id: String(c.tenantId),
        name: names.get(String(c.tenantId)) ?? '',
        decision: c.decision as PostingView['colleges'][number]['decision'],
        candidates: counts.get(String(c.tenantId)) ?? 0,
      })),
      createdAt: (p as unknown as { createdAt: Date }).createdAt.toISOString(),
    };
  }

  async postings(): Promise<PostingView[]> {
    await this.me();
    const rows = await PostingModel.find({}).sort({ _id: -1 }).limit(100).lean<PostingDoc[]>();
    return Promise.all(rows.map((r) => this.postingView(r)));
  }

  private async own(id: string): Promise<PostingDoc> {
    const p = await PostingModel.findById(id).lean<PostingDoc>();
    if (!p) throw notFound('Posting');
    return p;
  }

  async createPosting(viewer: AuthState, body: z.output<typeof postingBody>) {
    await this.me();
    if (Date.parse(body.closesAt) < Date.now()) throw badRequest('The closing date has passed');
    const p = await PostingModel.create({
      ref: randomToken(16),
      ...body,
      closesAt: new Date(body.closesAt),
      createdBy: new Types.ObjectId(viewer.userId),
    });
    return this.postingView(p.toObject() as unknown as PostingDoc);
  }

  async updatePosting(
    viewer: AuthState,
    id: string,
    body: z.output<typeof postingBody>,
    meta: RequestMetaLite,
  ) {
    const p = await this.own(id);
    if (p.status === 'closed') throw conflict('This posting is closed');
    await PostingModel.updateOne({ _id: p._id }, { $set: { ...body, closesAt: new Date(body.closesAt) } });
    if (p.status === 'published') {
      // An edit goes back to every college for approval (P10).
      const ids = p.colleges.map((c) => c.tenantId);
      await networkScope(
        'network:posting-withdraw',
        this.actor(viewer, meta),
        () =>
          PostingOfferModel.updateMany(
            {
              tenantId: { $in: ids },
              employerTenantId: requireTenantId(),
              postingRef: p.ref,
              decision: { $in: ['pending', 'approved'] },
            },
            { $set: { ...body, closesAt: new Date(body.closesAt), decision: 'pending', decidedAt: null } },
          ),
        () => ids.map((t) => ({ tenantId: String(t), count: 1 })),
      );
      await PostingModel.updateOne(
        { _id: p._id },
        { $set: { 'colleges.$[c].decision': 'pending', 'colleges.$[c].decidedAt': null } },
        { arrayFilters: [{ 'c.decision': 'approved' }] },
      );
    }
    return this.postingView(await this.own(id));
  }

  /** P8: offers the posting to chosen colleges or one cluster; each college decides (N31). */
  async publish(
    viewer: AuthState,
    id: string,
    body: z.output<typeof postingPublishBody>,
    meta: RequestMetaLite,
  ) {
    const t = await this.approved();
    const p = await this.own(id);
    if (p.status === 'closed') throw conflict('This posting is closed');
    if (p.closesAt.getTime() < Date.now()) throw badRequest('The closing date has passed');
    let wanted: string[];
    if ('clusterId' in body) {
      const c = await NetworkClusterModel.findById(body.clusterId).lean<ClusterRow>();
      if (!c) throw notFound('Cluster');
      wanted = c.colleges.map(String);
    } else wanted = body.colleges;
    const open = new Map((await this.openColleges()).map((c) => [String(c._id), c]));
    const targets = [...new Set(wanted)].filter((c) => open.has(c));
    if (!targets.length) throw badRequest('None of these colleges takes postings from you');
    const already = new Set(p.colleges.map((c) => String(c.tenantId)));
    const fresh = targets.filter((c) => !already.has(c));
    if (already.size + fresh.length > EMPLOYER_LIMITS.collegesPerPosting)
      throw badRequest(`A posting goes to at most ${EMPLOYER_LIMITS.collegesPerPosting} colleges`);
    if (p.status === 'draft') {
      const now = new Date();
      const [open_, month] = await Promise.all([
        PostingModel.countDocuments({ status: 'published', closesAt: { $gt: now } }),
        PostingModel.countDocuments({
          publishedAt: { $gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) },
        }),
      ]);
      if (open_ >= EMPLOYER_LIMITS.openPostings)
        throw conflict(`At most ${EMPLOYER_LIMITS.openPostings} postings can be open at once`);
      if (month >= EMPLOYER_LIMITS.postingsPerMonth)
        throw conflict(`At most ${EMPLOYER_LIMITS.postingsPerMonth} new postings a month`);
    }
    const offeredAt = new Date();
    await networkScope(
      'network:posting-offer',
      this.actor(viewer, meta),
      async () => {
        for (const c of fresh)
          await PostingOfferModel.updateOne(
            { tenantId: new Types.ObjectId(c), employerTenantId: t._id, postingRef: p.ref },
            {
              // The filter's tenantId, employer and ref are stamped by the upsert (never set in an update).
              $setOnInsert: {
                employerName: t.branding.displayName,
                title: p.title,
                role: p.role,
                type: p.type,
                location: p.location,
                ctcRange: p.ctcRange ?? '',
                description: p.description,
                branches: p.branches,
                gradYears: p.gradYears,
                closesAt: p.closesAt,
                decision: 'pending',
                offeredAt,
              },
            },
            { upsert: true },
          );
        return fresh.length;
      },
      () => fresh.map((c) => ({ tenantId: c, count: 1 })),
    );
    await PostingModel.updateOne(
      { _id: p._id },
      {
        $set: { status: 'published', ...(p.publishedAt ? {} : { publishedAt: offeredAt }) },
        $push: {
          colleges: { $each: fresh.map((c) => ({ tenantId: new Types.ObjectId(c), decision: 'pending' })) },
        },
      },
    );
    if (p.status === 'draft')
      await this.track(viewer.userId, 'posting_published', { postingId: String(p._id) });
    return this.postingView(await this.own(id));
  }

  /** P10: closes the posting; pending offers are withdrawn (drives already made stay the colleges'). */
  async close(viewer: AuthState, id: string, meta: RequestMetaLite) {
    const p = await this.own(id);
    if (p.status === 'closed') return this.postingView(p);
    const ids = p.colleges.map((c) => c.tenantId);
    if (ids.length)
      await networkScope(
        'network:posting-withdraw',
        this.actor(viewer, meta),
        () =>
          PostingOfferModel.updateMany(
            {
              tenantId: { $in: ids },
              employerTenantId: requireTenantId(),
              postingRef: p.ref,
              decision: 'pending',
            },
            { $set: { decision: 'withdrawn' } },
          ),
        () => ids.map((t) => ({ tenantId: String(t), count: 1 })),
      );
    await PostingModel.updateOne({ _id: p._id }, { $set: { status: 'closed' } });
    return this.postingView(await this.own(id));
  }

  // ── The pool and candidates ─────────────────────────────

  /** P7: counts only, suppressed and rounded (N29). */
  async pool(viewer: AuthState, q: z.output<typeof poolQuery>, meta: RequestMetaLite): Promise<PoolView> {
    await this.approved();
    await this.bump('pool', EMPLOYER_LIMITS.poolQueriesPerHour, 'hour');
    let open = await this.openColleges();
    if (q.colleges) {
      const wanted = new Set(q.colleges.split(','));
      open = open.filter((c) => wanted.has(String(c._id)));
    }
    if (!open.length) return { total: 0, byCollege: [] };
    const match: Record<string, unknown> = {
      tenantId: { $in: open.map((c) => c._id) },
      employerVisible: true,
    };
    if (q.branch) match.branch = q.branch;
    if (q.gradYear) match.gradYear = q.gradYear;
    if (q.seeking) match.seeking = q.seeking;
    if (q.skills.length) match.skills = { $all: q.skills.map((s) => new RegExp(`^${escapeRegex(s)}$`, 'i')) };
    const rows = await networkScope(
      'network:pool-size',
      this.actor(viewer, meta),
      () =>
        NetworkProfileModel.aggregate<{ _id: Types.ObjectId; n: number }>([
          { $match: match },
          { $group: { _id: '$tenantId', n: { $sum: 1 } } },
        ]),
      (rs) => rs.map((r) => ({ tenantId: String(r._id), count: r.n })),
    );
    const byId = new Map(rows.map((r) => [String(r._id), r.n]));
    const total = rows.reduce((n, r) => n + r.n, 0);
    return {
      total: poolCount(total),
      byCollege: open.map((c) => ({
        id: String(c._id),
        name: c.name,
        count: poolCount(byId.get(String(c._id)) ?? 0),
      })),
    };
  }

  /** The colleges where this posting is approved and that still take this employer. */
  private async liveColleges(p: PostingDoc) {
    const open = new Set((await this.openColleges()).map((c) => String(c._id)));
    return p.colleges
      .filter((c) => c.decision === 'approved' && open.has(String(c.tenantId)))
      .map((c) => c.tenantId);
  }

  /** P11: candidates who shared with this posting (N10, N14): no contact field exists. */
  async candidates(
    viewer: AuthState,
    id: string,
    meta: RequestMetaLite,
  ): Promise<{ items: CandidateView[]; withdrawn: number }> {
    await this.approved();
    await this.bump('candidates', EMPLOYER_LIMITS.candidateReadsPerHour, 'hour');
    const p = await this.own(id);
    const colleges = await this.liveColleges(p);
    if (!colleges.length) return { items: [], withdrawn: 0 };
    const me = requireTenantId();
    const rows = await networkScope(
      'network:candidates',
      this.actor(viewer, meta),
      async () => ({
        live: await NetworkCandidacyModel.find({
          tenantId: { $in: colleges },
          employerTenantId: me,
          postingRef: p.ref,
          stage: { $ne: 'withdrawn' },
        })
          .select(CANDIDACY_EMPLOYER_FIELDS)
          .sort({ sharedAt: -1 })
          .limit(500)
          .lean<Record<string, unknown>[]>(),
        withdrawn: await NetworkCandidacyModel.countDocuments({
          tenantId: { $in: colleges },
          employerTenantId: me,
          postingRef: p.ref,
          stage: 'withdrawn',
        }),
      }),
      (r) => {
        const m = new Map<string, number>();
        for (const c of r.live) m.set(String(c.tenantId), (m.get(String(c.tenantId)) ?? 0) + 1);
        return [...m].map(([tenantId, count]) => ({ tenantId, count }));
      },
    );
    const names = await collegeNames(colleges);
    return {
      items: rows.live.map((c) => ({
        ref: String(c.ref),
        name: String(c.name),
        college: names.get(String(c.tenantId)) ?? '',
        branch: (c.branch as CandidateView['branch']) ?? null,
        gradYear: (c.gradYear as number | null) ?? null,
        stage: c.stage as CandidateView['stage'],
        hasResume: !!c.resumeFileId,
        sharedAt: new Date(c.sharedAt as Date).toISOString(),
      })),
      withdrawn: rows.withdrawn,
    };
  }

  /** One live candidacy shared with this employer, through P11's rules. */
  private async candidacy(viewer: AuthState, ref: string, meta: RequestMetaLite) {
    const open = (await this.openColleges()).map((c) => c._id);
    const me = requireTenantId();
    const c = await networkScope(
      'network:candidates',
      this.actor(viewer, meta),
      () =>
        NetworkCandidacyModel.findOne({
          tenantId: { $in: open },
          employerTenantId: me,
          ref,
          stage: { $ne: 'withdrawn' },
        })
          .select(`${CANDIDACY_EMPLOYER_FIELDS} userId`)
          .lean<{
            tenantId: Types.ObjectId;
            userId: Types.ObjectId;
            resumeFileId: Types.ObjectId | null;
            postingRef: string;
            ref: string;
          }>(),
      (r) => (r ? [{ tenantId: String(r.tenantId), count: 1 }] : []),
    );
    if (!c) throw notFound('Candidate');
    // The posting must still be approved by that college.
    const p = await PostingModel.findOne({ ref: c.postingRef }).lean<PostingDoc>();
    if (!p || !p.colleges.some((x) => String(x.tenantId) === String(c.tenantId) && x.decision === 'approved'))
      throw notFound('Candidate');
    return c;
  }

  private mac(payload: string) {
    return createHmac('sha256', this.d.signingKey).update(payload).digest('base64url');
  }

  /** P12: a five-minute link, bound to the employer, the recruiter and the candidacy. */
  async resumeLink(viewer: AuthState, ref: string, meta: RequestMetaLite): Promise<ResumeLinkView> {
    await this.approved();
    const c = await this.candidacy(viewer, ref, meta);
    if (!c.resumeFileId) throw notFound('Résumé');
    await this.bump('resume', EMPLOYER_LIMITS.resumeLinksPerDay, 'day');
    const exp = Math.floor(Date.now() / 1000) + RESUME_LINK_SEC;
    const payload = Buffer.from(
      JSON.stringify({ t: String(requireTenantId()), u: viewer.userId, c: ref, e: exp }),
    ).toString('base64url');
    return {
      url: `/api/v1/employer/resume/${payload}.${this.mac(payload)}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  /** The link is checked again on every request: candidacy, consent and approval (§7). */
  async resumeFile(viewer: AuthState, token: string, meta: RequestMetaLite): Promise<Buffer> {
    await this.approved();
    const [payload = '', mac = ''] = token.split('.');
    const want = Buffer.from(this.mac(payload));
    const got = Buffer.from(mac);
    if (!payload || want.length !== got.length || !timingSafeEqual(want, got)) throw notFound('Résumé');
    let claim: { t?: string; u?: string; c?: string; e?: number };
    try {
      claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof claim;
    } catch {
      throw notFound('Résumé');
    }
    if (
      claim.t !== String(requireTenantId()) ||
      claim.u !== viewer.userId ||
      !claim.c ||
      !claim.e ||
      claim.e < Date.now() / 1000
    )
      throw notFound('Résumé');
    const c = await this.candidacy(viewer, claim.c, meta);
    if (!c.resumeFileId) throw notFound('Résumé');
    const fileId = String(c.resumeFileId);
    const data = await networkInTenant(
      'network:candidate-resume',
      this.actor(viewer, meta),
      c.tenantId,
      async () => {
        // Consent is read again in the member's own college.
        const ok = await NetworkProfileModel.exists({ userId: c.userId, employerVisible: true });
        return ok ? this.d.readFile(fileId) : null;
      },
      { targetType: 'network_candidacy', targetId: c.ref },
    );
    if (!data) throw notFound('Résumé');
    return data;
  }

  /** P13: readiness, computed on read by the college's own service; never stored (N30). */
  async readiness(viewer: AuthState, ref: string, meta: RequestMetaLite): Promise<CandidateReadinessView> {
    await this.approved();
    const c = await this.candidacy(viewer, ref, meta);
    await this.bump('readiness', EMPLOYER_LIMITS.readinessReadsPerDay, 'day');
    const college = await findTenantById(c.tenantId);
    if (!college) throw notFound('Candidate');
    const view = await networkInTenant(
      'network:candidate-readiness',
      this.actor(viewer, meta),
      c.tenantId,
      async () => {
        const ok = await NetworkProfileModel.exists({ userId: c.userId, employerVisible: true });
        return ok ? this.d.readinessOf(String(c.userId), college) : null;
      },
      { targetType: 'network_candidacy', targetId: c.ref },
    );
    if (!view) throw notFound('Readiness');
    return view;
  }

  /** P14: the employer proposes; the college publishes round results through its drive tools. */
  async setStage(
    viewer: AuthState,
    ref: string,
    body: z.output<typeof candidateStageBody>,
    meta: RequestMetaLite,
  ) {
    await this.approved();
    const c = await this.candidacy(viewer, ref, meta);
    const r = await networkScope(
      'network:shortlist',
      this.actor(viewer, meta),
      () =>
        NetworkCandidacyModel.updateOne(
          { tenantId: c.tenantId, ref, stage: { $in: ['shared', 'shortlisted', 'not_selected'] } },
          { $set: { stage: body.stage } },
        ),
      () => [{ tenantId: String(c.tenantId), count: 1, targetType: 'network_candidacy', targetId: ref }],
    );
    if (!r.modifiedCount) throw conflict('The college has already published a result for this candidate');
    return { stage: body.stage };
  }

  async billing(): Promise<BillableView[]> {
    await this.me();
    const rows = await BillableEventModel.find({}).sort({ at: -1 }).limit(200).lean();
    const names = await collegeNames(rows.map((r) => r.collegeTenantId).filter(Boolean));
    return rows.map((r) => ({
      kind: r.kind as BillableView['kind'],
      amount: r.amount,
      college: r.collegeTenantId ? (names.get(String(r.collegeTenantId)) ?? null) : null,
      at: r.at.toISOString(),
    }));
  }

  // ── The platform ─────────────────────────────

  async list(status?: string): Promise<EmployerReviewView[]> {
    const rows = await TenantModel.find({
      kind: 'employer',
      ...(status ? { 'employer.status': status } : {}),
    })
      .sort({ _id: -1 })
      .limit(200)
      .lean<(TenantRecord & { createdAt: Date })[]>();
    return Promise.all(rows.map((t) => this.reviewView(t, null)));
  }

  private async reviewView(
    t: TenantRecord & { createdAt?: Date },
    applicant: EmployerReviewView['applicant'],
  ): Promise<EmployerReviewView> {
    const since = new Date(Date.now() - 90 * DAY);
    const blocks = await TenantModel.countDocuments({
      kind: 'college',
      'network.blockedEmployers': { $elemMatch: { employerId: t._id, at: { $gte: since } } },
    });
    return {
      ...this.view(t, []),
      // Past "applied", the inbox was proved (the status moves on only then).
      emailVerified: t.employer?.status !== 'applied',
      applicant,
      blocks,
      createdAt: (t.createdAt ?? new Date()).toISOString(),
    };
  }

  /** P16: one employer's application, with its first recruiter's name and work email. */
  async review(actor: AuthState, id: string, meta: RequestMetaLite): Promise<EmployerReviewView> {
    const t = await TenantModel.findOne({ _id: id, kind: 'employer' }).lean<
      TenantRecord & { createdAt: Date }
    >();
    if (!t) throw notFound('Employer');
    const admin = await networkScope(
      'network:employer-review',
      { tenantId: String(requireTenantId()), kind: 'platform', userId: actor.userId, meta },
      () =>
        UserModel.findOne({ tenantId: t._id, roles: Role.EMPLOYER_ADMIN })
          .sort({ _id: 1 })
          .select('name email emailVerifiedAt')
          .lean(),
      (u) => (u ? [{ tenantId: String(t._id), count: 1 }] : []),
    );
    const view = await this.reviewView(t, admin ? { name: admin.name, email: admin.email ?? '' } : null);
    return { ...view, emailVerified: !!admin?.emailVerifiedAt };
  }

  async decide(
    actor: AuthState,
    id: string,
    body: z.output<typeof employerDecisionBody>,
    meta: RequestMetaLite,
  ) {
    const t = await TenantModel.findOne({ _id: id, kind: 'employer' }).lean<TenantRecord>();
    if (!t?.employer) throw notFound('Employer');
    const status = t.employer.status;
    const set: Record<string, unknown> = { 'employer.reviewNote': body.note };
    if (body.decision === 'approve') {
      // Nothing is approved before the inbox and the domain are proved (N25).
      if (status !== 'verified') throw conflict('The employer has not verified its email and domain yet');
      Object.assign(set, {
        'employer.status': 'approved',
        'employer.approvedBy': new Types.ObjectId(actor.userId),
        'employer.approvedAt': new Date(),
        'employer.gstinCheckedAt': new Date(),
      });
    } else if (body.decision === 'reject') {
      if (status === 'approved') throw conflict('Suspend an approved employer instead');
      set['employer.status'] = 'rejected';
    } else if (body.decision === 'suspend') {
      Object.assign(set, { 'employer.status': 'suspended', 'employer.suspendedAt': new Date() });
    } else {
      if (status !== 'suspended') throw conflict('Only a suspended employer can be reinstated');
      Object.assign(set, { 'employer.status': 'approved', 'employer.suspendedAt': null });
    }
    await TenantModel.updateOne({ _id: t._id }, { $set: set });
    invalidateTenant(t.slug);
    await audit.record(
      {
        action: `employer.${body.decision}`,
        actorId: actor.userId,
        targetType: 'tenant',
        targetId: String(t._id),
      },
      meta,
    );
    await audit.recordInTenant(t._id, {
      action: `employer.${body.decision}`,
      targetType: 'tenant',
      targetId: String(t._id),
    });
    return { status: (set['employer.status'] as string | undefined) ?? status };
  }

  async clusters(): Promise<ClusterView[]> {
    const rows = await NetworkClusterModel.find({}).sort({ name: 1 }).lean<ClusterRow[]>();
    const names = await collegeNames(rows.flatMap((r) => r.colleges));
    return rows.map((c) => ({
      id: String(c._id),
      name: c.name,
      colleges: c.colleges.map((id) => ({ id: String(id), name: names.get(String(id)) ?? '', city: null })),
    }));
  }

  async saveCluster(
    actor: AuthState,
    body: z.output<typeof clusterBody>,
    meta: RequestMetaLite,
    id?: string,
  ) {
    const ids = [...new Set(body.colleges)].map((c) => new Types.ObjectId(c));
    if ((await TenantModel.countDocuments({ _id: { $in: ids }, kind: 'college' })) !== ids.length)
      throw badRequest('A cluster holds colleges only');
    if (id) {
      const r = await NetworkClusterModel.updateOne(
        { _id: id },
        { $set: { name: body.name, colleges: ids } },
      );
      if (!r.matchedCount) throw notFound('Cluster');
    } else await NetworkClusterModel.create({ name: body.name, colleges: ids });
    await audit.record(
      { action: 'network.cluster_saved', actorId: actor.userId, meta: { colleges: ids.length } },
      meta,
    );
    return this.clusters();
  }

  async deleteCluster(actor: AuthState, id: string, meta: RequestMetaLite) {
    const r = await NetworkClusterModel.deleteOne({ _id: id });
    if (!r.deletedCount) throw notFound('Cluster');
    await audit.record({ action: 'network.cluster_deleted', actorId: actor.userId, targetId: id }, meta);
    return this.clusters();
  }

  /** P17: each college's share of last month's billable events (counts and amounts, no member data). */
  async revenue(actor: AuthState, month: string, meta: RequestMetaLite): Promise<RevenueStatementView> {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) throw badRequest('Give the month as YYYY-MM');
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const rows = await networkScope(
      'network:revenue-statement',
      { tenantId: String(requireTenantId()), kind: 'platform', userId: actor.userId, meta },
      () =>
        BillableEventModel.aggregate<{
          _id: { college: Types.ObjectId | null; kind: string };
          n: number;
          amount: number;
          share: number;
        }>([
          { $match: { at: { $gte: from, $lt: to }, collegeTenantId: { $ne: null } } },
          {
            $group: {
              _id: { college: '$collegeTenantId', kind: '$kind' },
              n: { $sum: 1 },
              amount: { $sum: '$amount' },
              share: {
                $sum: { $floor: { $divide: [{ $multiply: ['$amount', '$revenueShareBps'] }, 10_000] } },
              },
            },
          },
        ]),
      (rs) => [...new Set(rs.map((r) => String(r._id.college)))].map((tenantId) => ({ tenantId, count: 1 })),
    );
    const names = await collegeNames(rows.map((r) => r._id.college));
    const by = new Map<string, RevenueStatementView['colleges'][number]>();
    for (const r of rows) {
      const id = String(r._id.college);
      const row = by.get(id) ?? {
        id,
        name: names.get(id) ?? '',
        postings: 0,
        drives: 0,
        hires: 0,
        amount: 0,
        share: 0,
      };
      if (r._id.kind === 'posting') row.postings += r.n;
      if (r._id.kind === 'drive') row.drives += r.n;
      if (r._id.kind === 'hire') row.hires += r.n;
      row.amount += r.amount;
      row.share += r.share;
      by.set(id, row);
    }
    return { month, colleges: [...by.values()] };
  }

  // ── Privacy (an employer's own recruiters) ─────────────────────────────

  async exportFor(userId: string) {
    const postings = await PostingModel.find({ createdBy: new Types.ObjectId(userId) })
      .select('title role status createdAt')
      .lean();
    return { postingsCreated: postings };
  }
  async eraseFor(): Promise<void> {
    // Postings belong to the employer, not the recruiter: nothing personal is stored on them.
  }
}

/** The billing price of an event, with the colleges' share in force (§11). */
export function billable(
  kind: 'posting' | 'drive' | 'hire',
  key: string,
  postingRef: string,
  collegeTenantId: Types.ObjectId | null,
  employerTenantId: Types.ObjectId,
  pricing = EMPLOYER_PRICING_DEFAULT,
) {
  const amount =
    kind === 'posting' ? pricing.perPosting : kind === 'drive' ? pricing.perDrive : pricing.perHire;
  return {
    filter: { tenantId: employerTenantId, key },
    update: {
      $setOnInsert: {
        kind,
        postingRef,
        collegeTenantId,
        amount,
        revenueShareBps: pricing.revenueShareBps,
        at: new Date(),
      },
    },
  };
}
