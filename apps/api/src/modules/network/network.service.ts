import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  ErrorCode,
  NETWORK_CONSENT_PURPOSES,
  NETWORK_INTROS_PER_WEEK,
  NETWORK_RECONCILE_MINUTES,
  NETWORK_INTRO_PENDING_MAX,
  NETWORK_INTRO_REPEAT_DAYS,
  NETWORK_INTRO_TTL_DAYS,
  NETWORK_REPORTS_TO_PAUSE,
  NETWORK_SEARCH_PAGE,
  NETWORK_SKILLS_MAX,
  NETWORK_TERMS_VERSION,
  Role,
  suppress,
  type IntrosView,
  type NetworkAdminView,
  type NetworkCard,
  type NetworkConsentPurpose,
  type NetworkSearchView,
  type NetworkSettingsBody,
  type NetworkSettingsView,
  type NotificationType,
  type introAcceptBody,
  type introBody,
  type introDeclineBody,
  type networkSearchQuery,
  type networkSwitchBody,
} from '@campuslink/shared';
import {
  NETWORK_PUBLIC_FIELDS,
  NetworkIntroModel,
  NetworkIntroOutModel,
  NetworkPrefsModel,
  NetworkProfileModel,
  type NetworkIntroDoc,
  type NetworkIntroOutDoc,
  type NetworkPrefsDoc,
} from './network.model.js';
import { TenantModel } from '../tenants/tenant.model.js';
import { findTenantById, invalidateTenant, type TenantRecord } from '../tenants/tenant.cache.js';
import { networkInTenant, networkScope, type NetworkActor, type Touch } from '../../lib/network-scope.js';
import { requireTenantId, runInTenant } from '../../lib/context.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { randomToken, type FieldCipher } from '../../lib/crypto.js';
import { companyKey } from '../../lib/company.js';
import { plainText } from '../../lib/text.js';
import { consentService } from '../consent/consent.service.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { AuthState } from '../../types.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import type { Logger } from '../../lib/logger.js';
import type { JobQueue } from '../../lib/jobs.js';

const DAY = 24 * 3600_000;
export const NETWORK_RECONCILE_JOB = 'network.reconcile';
const newRef = () => randomToken(16);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const notEnabled = (what = 'The network is not on for you yet') =>
  new AppError(403, ErrorCode.NETWORK_NOT_ENABLED, what);
export const notForMinors = () =>
  new AppError(403, ErrorCode.NOT_FOR_MINORS, 'The network is not available to members under 18');

type Facts = Awaited<ReturnType<ProfilesService['networkFacts']>> extends Map<string, infer V> ? V : never;

export interface NetworkDeps {
  cipher: FieldCipher;
  profiles: ProfilesService;
  notify: (userId: string, type: NotificationType, data: Record<string, string>) => Promise<unknown>;
  emailOf: (userId: string) => Promise<string | null>;
  logger: Logger;
  /** Runs after a member's projection changed (the candidacies follow consent and the member's state). */
  afterRefresh?: (userId: string, state: { employerVisible: boolean; active: boolean }) => Promise<void>;
}

/** A college's participation, read from the Tenant collection per request (N5): never cached. */
export async function participating(
  sw: 'alumniDiscovery' | 'employerAccess' | 'credentials',
): Promise<{ _id: Types.ObjectId; name: string; city: string | null; blocked: string[] }[]> {
  const rows = await TenantModel.find({ kind: 'college', status: 'active', [`network.${sw}`]: true })
    .select('_id branding.displayName branding.city network.blockedEmployers')
    .lean<
      {
        _id: Types.ObjectId;
        branding: { displayName: string; city?: string | null };
        network?: { blockedEmployers?: { employerId: Types.ObjectId }[] };
      }[]
    >();
  return rows.map((r) => ({
    _id: r._id,
    name: r.branding.displayName,
    city: r.branding.city ?? null,
    blocked: (r.network?.blockedEmployers ?? []).map((b) => String(b.employerId)),
  }));
}

const switches = (t: TenantRecord) => ({
  alumniDiscovery: t.network?.alumniDiscovery === true,
  employerAccess: t.network?.employerAccess === true,
  credentials: t.network?.credentials === true,
});

/**
 * The cross-college network for members and their college (prompt 2, G12, ADR 0014 §2 to §8).
 * Projections are written here only, in the member's own college; every cross-tenant read or
 * write goes through a named path in `lib/network-scope.ts`.
 */
export class NetworkService {
  track: Track = noTrack;
  constructor(private readonly d: NetworkDeps) {}

  /** The timer: one reconcile per college every NETWORK_RECONCILE_MINUTES (job ids dedupe per window). */
  static async enqueueReconcile(jobs: JobQueue, now = new Date()): Promise<number> {
    const window = Math.floor(now.getTime() / (NETWORK_RECONCILE_MINUTES * 60_000));
    const tenants = await TenantModel.find({ kind: 'college', status: 'active' }).select('_id').lean();
    for (const t of tenants)
      await jobs.enqueue(
        NETWORK_RECONCILE_JOB,
        { tenantId: String(t._id) },
        { jobId: `network-${String(t._id)}-${window}` },
      );
    return tenants.length;
  }

  private async tenant(): Promise<TenantRecord> {
    const t = await findTenantById(requireTenantId());
    if (!t) throw notFound('College');
    return t;
  }
  private actor(viewer: AuthState, meta?: RequestMetaLite): NetworkActor {
    return {
      tenantId: String(requireTenantId()),
      kind: 'college',
      userId: viewer.userId,
      ...(meta ? { meta } : {}),
    };
  }

  // ── Settings and consent ─────────────────────────────

  private async prefs(userId: string): Promise<NetworkPrefsDoc> {
    const p = await NetworkPrefsModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      { $setOnInsert: { userId: new Types.ObjectId(userId) } },
      { upsert: true, returnDocument: 'after' },
    ).lean<NetworkPrefsDoc>();
    if (!p) throw notFound('Settings');
    return p;
  }

  async settings(viewer: AuthState): Promise<NetworkSettingsView> {
    const t = await this.tenant();
    const [p, facts, grants, profile] = await Promise.all([
      this.prefs(viewer.userId),
      this.d.profiles.networkFacts([viewer.userId]),
      consentService.networkGrants([viewer.userId]),
      NetworkProfileModel.findOne({ userId: viewer.userId }).select('discoverable employerVisible').lean(),
    ]);
    const g = grants.get(viewer.userId) ?? {};
    return {
      college: switches(t),
      consents: { network_discovery: !!g.network_discovery, employer_visibility: !!g.employer_visibility },
      settings: {
        nameStyle: p.nameStyle as 'full' | 'first',
        showCompany: p.showCompany,
        showCity: p.showCity,
        showSkills: p.showSkills,
        linkedinUrl: p.linkedinUrl ?? null,
        helpWith: p.helpWith as NetworkSettingsBody['helpWith'],
        acceptingIntros: p.acceptingIntros,
        introsPerWeek: p.introsPerWeek,
        seeking: (p.seeking ?? null) as NetworkSettingsBody['seeking'],
      },
      minor: facts.get(viewer.userId)?.minor ?? false,
      paused: !!p.pausedAt,
      visible: { discovery: !!profile?.discoverable, employers: !!profile?.employerVisible },
      viewedBy: await this.viewedBy(viewer.userId),
    };
  }

  /** Employers that opened this member's résumé or readiness (N16), from the college's audit rows. */
  private viewedBy: (userId: string) => Promise<NetworkSettingsView['viewedBy']> = async () => [];
  setViewedBy(fn: (userId: string) => Promise<NetworkSettingsView['viewedBy']>) {
    this.viewedBy = fn;
  }

  async saveSettings(viewer: AuthState, body: NetworkSettingsBody): Promise<NetworkSettingsView> {
    await NetworkPrefsModel.updateOne(
      { userId: new Types.ObjectId(viewer.userId) },
      { $set: { ...body }, $setOnInsert: { userId: new Types.ObjectId(viewer.userId) } },
      { upsert: true },
    );
    await this.refresh(viewer.userId);
    return this.settings(viewer);
  }

  /** Grant or withdraw a network purpose (N6, N7, N8): the effect is applied in this request (N17). */
  async setConsent(
    viewer: AuthState,
    purpose: NetworkConsentPurpose,
    granted: boolean,
    meta: RequestMetaLite,
  ): Promise<NetworkSettingsView> {
    if (!(purpose in NETWORK_CONSENT_PURPOSES)) throw badRequest('Unknown purpose');
    if (granted) {
      const f = (await this.d.profiles.networkFacts([viewer.userId])).get(viewer.userId);
      if (!f || f.minor) throw notForMinors();
      if (!f.roles.includes(Role.STUDENT) && !f.roles.includes(Role.ALUMNI))
        throw notEnabled('The network is for students and alumni');
    }
    await this.prefs(viewer.userId);
    await consentService.setNetwork(viewer.userId, purpose, granted, meta);
    await this.refresh(viewer.userId);
    return this.settings(viewer);
  }

  // ── Projections ─────────────────────────────

  /** Rebuilds (or deletes) one member's projection from the sources, in their own college. */
  async refresh(userId: string): Promise<void> {
    const t = await this.tenant();
    if (t.kind !== 'college') return;
    const prefs = await NetworkPrefsModel.findOne({
      userId: new Types.ObjectId(userId),
    }).lean<NetworkPrefsDoc>();
    const existing = await NetworkProfileModel.exists({ userId: new Types.ObjectId(userId) });
    if (!prefs && !existing) return;
    const [facts, grants] = await Promise.all([
      this.d.profiles.networkFacts([userId]),
      consentService.networkGrants([userId]),
    ]);
    await this.apply(t, userId, prefs, facts.get(userId), grants.get(userId) ?? {});
  }

  private async apply(
    t: TenantRecord,
    userId: string,
    prefs: NetworkPrefsDoc | null,
    f: Facts | undefined,
    g: Partial<Record<NetworkConsentPurpose, number>>,
  ): Promise<'kept' | 'deleted' | 'none'> {
    const sw = switches(t);
    const kind = f?.roles.includes(Role.ALUMNI)
      ? 'alumni'
      : f?.roles.includes(Role.STUDENT)
        ? 'student'
        : null;
    const active = !!f && f.active && !f.minor && !!kind;
    const discoverable = active && sw.alumniDiscovery && !!g.network_discovery;
    const employerVisible = active && sw.employerAccess && !!g.employer_visibility;
    const uid = new Types.ObjectId(userId);
    if (!prefs || !f || !kind || (!discoverable && !employerVisible)) {
      const r = await NetworkProfileModel.deleteOne({ userId: uid });
      await this.d.afterRefresh?.(userId, { employerVisible: false, active });
      return r.deletedCount ? 'deleted' : 'none';
    }
    const first = prefs.nameStyle === 'full' ? f.name : firstAndInitial(f.name);
    const company = kind === 'alumni' && prefs.showCompany && f.company ? f.company.slice(0, 120) : null;
    const fields = {
      kind,
      name: first,
      branch: f.branch,
      gradYear: f.gradYear,
      company,
      companyKey: company ? companyKey(company) : null,
      roleTitle: kind === 'alumni' && prefs.showCompany && f.jobTitle ? f.jobTitle.slice(0, 120) : null,
      city: prefs.showCity && f.location ? f.location.split(',')[0]?.trim().slice(0, 60) || null : null,
      skills: prefs.showSkills ? f.skills.slice(0, NETWORK_SKILLS_MAX) : [],
      helpWith: kind === 'alumni' ? prefs.helpWith : [],
      acceptingIntros: kind === 'alumni' && prefs.acceptingIntros,
      introsPerWeek: prefs.introsPerWeek,
      seeking: kind === 'student' ? (prefs.seeking ?? null) : null,
      linkedinUrl: prefs.linkedinUrl ?? null,
      discoverable,
      employerVisible,
      consentVersions: {
        network_discovery: g.network_discovery ?? null,
        employer_visibility: g.employer_visibility ?? null,
      },
      refreshedAt: new Date(),
    };
    await NetworkProfileModel.updateOne(
      { userId: uid },
      // A new ref only when the projection is (re)created: a withdrawal unlinks (§4).
      { $set: fields, $setOnInsert: { userId: uid, ref: newRef() } },
      { upsert: true },
    );
    await this.d.afterRefresh?.(userId, { employerVisible, active });
    return 'kept';
  }

  /**
   * The reconcile (N19): every NETWORK_RECONCILE_MINUTES, in each college, every projection is
   * rebuilt from its sources and anything that no longer qualifies is deleted.
   */
  async reconcile(now = new Date()): Promise<{ kept: number; deleted: number; expired: number }> {
    const t = await this.tenant();
    if (t.kind !== 'college') return { kept: 0, deleted: 0, expired: 0 };
    const prefs = await NetworkPrefsModel.find({}).lean<NetworkPrefsDoc[]>();
    const byUser = new Map(prefs.map((p) => [String(p.userId), p]));
    const projected = await NetworkProfileModel.find({}).select('userId').lean();
    const ids = [...new Set([...byUser.keys(), ...projected.map((p) => String(p.userId))])];
    let kept = 0;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const [facts, grants] = await Promise.all([
        this.d.profiles.networkFacts(chunk),
        consentService.networkGrants(chunk),
      ]);
      for (const id of chunk) {
        const r = await this.apply(t, id, byUser.get(id) ?? null, facts.get(id), grants.get(id) ?? {});
        if (r === 'kept') kept++;
        if (r === 'deleted') deleted++;
      }
    }
    const expired = await this.expireIntros(now);
    return { kept, deleted, expired };
  }

  // ── Discovery (P1, P2) ─────────────────────────────

  /** Both colleges and the member opted in, an adult, not paused (N20). */
  private async access(viewer: AuthState) {
    const t = await this.tenant();
    if (!switches(t).alumniDiscovery) throw notEnabled('Your college has not joined the network');
    const me = await NetworkProfileModel.findOne({ userId: new Types.ObjectId(viewer.userId) })
      .select('ref discoverable kind name branch gradYear')
      .lean();
    if (!me?.discoverable) throw notEnabled('Turn on “Be found by other colleges” to use the network');
    const prefs = await NetworkPrefsModel.findOne({ userId: new Types.ObjectId(viewer.userId) })
      .select('pausedAt')
      .lean();
    if (prefs?.pausedAt) throw notEnabled('Your network access is paused until your college reviews it');
    return { t, me };
  }

  private card(
    p: Record<string, unknown>,
    colleges: Map<string, { name: string; city: string | null }>,
  ): NetworkCard {
    const c = colleges.get(String(p.tenantId)) ?? { name: '', city: null };
    return {
      ref: String(p.ref),
      name: String(p.name),
      college: { name: c.name, city: c.city },
      branch: (p.branch as NetworkCard['branch']) ?? null,
      gradYear: (p.gradYear as number | null) ?? null,
      company: (p.company as string | null) ?? null,
      roleTitle: (p.roleTitle as string | null) ?? null,
      city: (p.city as string | null) ?? null,
      skills: (p.skills as string[]) ?? [],
      helpWith: (p.helpWith as NetworkCard['helpWith']) ?? [],
      linkedinUrl: (p.linkedinUrl as string | null) ?? null,
    };
  }

  async search(
    viewer: AuthState,
    q: z.output<typeof networkSearchQuery>,
    meta: RequestMetaLite,
  ): Promise<NetworkSearchView> {
    const { t } = await this.access(viewer);
    const others = (await participating('alumniDiscovery')).filter((c) => String(c._id) !== String(t._id));
    const colleges = new Map(others.map((c) => [String(c._id), { name: c.name, city: c.city }]));
    if (!others.length) return { items: [], nextCursor: null };
    const skip = Number(q.cursor ?? 0);
    const filter: Record<string, unknown> = {
      tenantId: { $in: others.map((c) => c._id) },
      discoverable: true,
      kind: 'alumni',
    };
    if (q.company) filter.companyKey = companyKey(q.company);
    if (q.branch) filter.branch = q.branch;
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      filter.$or = [{ name: rx }, { company: rx }, { roleTitle: rx }, { skills: rx }];
    }
    const rows = await networkScope(
      'network:alumni-search',
      this.actor(viewer, meta),
      () =>
        NetworkProfileModel.find(filter)
          .select(NETWORK_PUBLIC_FIELDS)
          .sort({ refreshedAt: -1, _id: -1 })
          .skip(skip)
          .limit(NETWORK_SEARCH_PAGE + 1)
          .lean<Record<string, unknown>[]>(),
      (rs) => byTenant(rs.slice(0, NETWORK_SEARCH_PAGE)),
    );
    const page = rows.slice(0, NETWORK_SEARCH_PAGE);
    return {
      items: page.map((p) => this.card(p, colleges)),
      nextCursor: rows.length > NETWORK_SEARCH_PAGE ? String(skip + NETWORK_SEARCH_PAGE) : null,
    };
  }

  async cardOf(viewer: AuthState, ref: string, meta: RequestMetaLite): Promise<NetworkCard> {
    const { t } = await this.access(viewer);
    const others = (await participating('alumniDiscovery')).filter((c) => String(c._id) !== String(t._id));
    const colleges = new Map(others.map((c) => [String(c._id), { name: c.name, city: c.city }]));
    const row = await networkScope(
      'network:alumni-card',
      this.actor(viewer, meta),
      () =>
        NetworkProfileModel.findOne({
          tenantId: { $in: others.map((c) => c._id) },
          ref,
          discoverable: true,
          kind: 'alumni',
        })
          .select(NETWORK_PUBLIC_FIELDS)
          .lean<Record<string, unknown>>(),
      (r) => (r ? byTenant([r]) : []),
    );
    if (!row) throw notFound('Alumnus');
    return this.card(row, colleges);
  }

  // ── Intros (P3 to P6) ─────────────────────────────

  async intros(viewer: AuthState): Promise<IntrosView> {
    const uid = new Types.ObjectId(viewer.userId);
    const [received, sent, weekCount] = await Promise.all([
      NetworkIntroModel.find({ toUserId: uid }).sort({ _id: -1 }).limit(50).lean<NetworkIntroDoc[]>(),
      NetworkIntroOutModel.find({ userId: uid }).sort({ _id: -1 }).limit(50).lean<NetworkIntroOutDoc[]>(),
      NetworkIntroOutModel.countDocuments({
        userId: uid,
        createdAt: { $gte: new Date(Date.now() - 7 * DAY) },
      }),
    ]);
    const names = await collegeNames([
      ...received.map((r) => r.fromTenantId),
      ...sent.map((s) => s.toTenantId),
    ]);
    return {
      received: received.map((r) => ({
        id: String(r._id),
        from: {
          name: r.fromName,
          college: names.get(String(r.fromTenantId)) ?? '',
          branch: (r.fromBranch ?? null) as IntrosView['received'][number]['from']['branch'],
          gradYear: r.fromGradYear ?? null,
        },
        helpWith: r.helpWith as IntrosView['received'][number]['helpWith'],
        goal: r.goal as IntrosView['received'][number]['goal'],
        note: r.note ?? '',
        status: r.status as IntrosView['received'][number]['status'],
        declineReason: (r.declineReason ?? null) as IntrosView['received'][number]['declineReason'],
        createdAt: (r as unknown as { createdAt: Date }).createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
      })),
      sent: sent.map((s) => ({
        id: String(s._id),
        to: { name: s.toName, college: names.get(String(s.toTenantId)) ?? '', company: s.toCompany ?? null },
        helpWith: s.helpWith as IntrosView['sent'][number]['helpWith'],
        goal: s.goal as IntrosView['sent'][number]['goal'],
        status: s.status as IntrosView['sent'][number]['status'],
        declineReason: (s.declineReason ?? null) as IntrosView['sent'][number]['declineReason'],
        shared: s.sharedContactEnc
          ? (JSON.parse(this.d.cipher.decrypt(s.sharedContactEnc)) as { linkedin?: string; email?: string })
          : null,
        createdAt: (s as unknown as { createdAt: Date }).createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      })),
      left: Math.max(0, NETWORK_INTROS_PER_WEEK - weekCount),
    };
  }

  async sendIntro(viewer: AuthState, body: z.output<typeof introBody>, meta: RequestMetaLite) {
    const { t, me } = await this.access(viewer);
    if (me.kind !== 'student') throw notEnabled('Students send intros; alumni receive them');
    const uid = new Types.ObjectId(viewer.userId);
    const now = Date.now();
    // Caps (N21), counted in the student's own college.
    const [week, pending] = await Promise.all([
      NetworkIntroOutModel.countDocuments({ userId: uid, createdAt: { $gte: new Date(now - 7 * DAY) } }),
      NetworkIntroOutModel.countDocuments({ userId: uid, status: 'pending' }),
    ]);
    if (week >= NETWORK_INTROS_PER_WEEK)
      throw conflict(`You can send ${NETWORK_INTROS_PER_WEEK} intros a week. Try again next week.`);
    if (pending >= NETWORK_INTRO_PENDING_MAX)
      throw conflict('Wait for an answer to one of your intros before sending another');
    // One pending per pair; 30 days after a decline (N21). Refs are random, so the ref alone names the pair.
    const pair = await NetworkIntroOutModel.findOne({ userId: uid, toRef: body.ref })
      .sort({ _id: -1 })
      .lean<NetworkIntroOutDoc>();
    if (pair?.status === 'pending') throw conflict('You already have an intro waiting with this alumnus');
    if (
      pair?.status === 'declined' &&
      (pair.answeredAt?.getTime() ?? 0) > now - NETWORK_INTRO_REPEAT_DAYS * DAY
    )
      throw conflict(
        `This alumnus declined recently. You can ask again ${NETWORK_INTRO_REPEAT_DAYS} days after.`,
      );
    const others = (await participating('alumniDiscovery')).filter((c) => String(c._id) !== String(t._id));
    const id = new Types.ObjectId();
    const note = plainText(body.note ?? '').slice(0, 300);
    const target = await networkScope(
      'network:intro-send',
      this.actor(viewer, meta),
      async () => {
        const p = await NetworkProfileModel.findOne({
          tenantId: { $in: others.map((c) => c._id) },
          ref: body.ref,
          discoverable: true,
          kind: 'alumni',
        })
          .select('tenantId userId name company acceptingIntros introsPerWeek helpWith ref')
          .lean();
        if (!p) return null;
        if (!p.acceptingIntros) return { refused: 'This alumnus is not taking intros right now' as const };
        if (!(p.helpWith ?? []).includes(body.helpWith))
          return { refused: 'This alumnus does not help with that' as const };
        const received = await NetworkIntroModel.countDocuments({
          tenantId: p.tenantId,
          toUserId: p.userId,
          createdAt: { $gte: new Date(now - 7 * DAY) },
        });
        if (received >= (p.introsPerWeek ?? 2))
          return {
            refused: 'This alumnus has had enough intros this week. Try another or come back later.' as const,
          };
        await NetworkIntroModel.create({
          _id: id,
          tenantId: p.tenantId,
          toUserId: p.userId,
          fromTenantId: t._id,
          fromRef: me.ref,
          fromName: me.name,
          fromBranch: me.branch ?? null,
          fromGradYear: me.gradYear ?? null,
          helpWith: body.helpWith,
          goal: body.goal,
          note,
          status: 'pending',
          expiresAt: new Date(now + NETWORK_INTRO_TTL_DAYS * DAY),
        });
        return {
          tenantId: p.tenantId,
          userId: p.userId,
          name: p.name,
          company: p.company ?? null,
          ref: p.ref,
        };
      },
      (r) => (r && 'tenantId' in r ? [{ tenantId: String(r.tenantId), count: 1 }] : []),
    );
    if (!target) throw notFound('Alumnus');
    if ('refused' in target) throw conflict(target.refused);
    await NetworkIntroOutModel.create({
      _id: id,
      userId: uid,
      toTenantId: target.tenantId,
      toRef: target.ref,
      toName: target.name,
      toCompany: target.company,
      helpWith: body.helpWith,
      goal: body.goal,
      status: 'pending',
      expiresAt: new Date(now + NETWORK_INTRO_TTL_DAYS * DAY),
    });
    // The alumnus hears in their own college: their name, our college, the type; never the note.
    await runInTenant(target.tenantId, () =>
      this.d.notify(String(target.userId), 'network_intro_received', {
        name: me.name,
        college: t.branding.displayName,
        sessionType: body.helpWith,
        introId: String(id),
      }),
    ).catch((err: unknown) => this.d.logger.warn({ err }, 'network intro notification failed'));
    await this.track(viewer.userId, 'network_intro_sent', { helpWith: body.helpWith });
    return { id: String(id) };
  }

  async accept(viewer: AuthState, id: string, body: z.output<typeof introAcceptBody>, meta: RequestMetaLite) {
    const intro = await this.ownPending(viewer, id);
    const prefs = await this.prefs(viewer.userId);
    const shared: { linkedin?: string; email?: string } = {};
    if (body.share.includes('linkedin')) {
      if (!prefs.linkedinUrl) throw badRequest('Add your LinkedIn link in network settings first');
      shared.linkedin = prefs.linkedinUrl;
    }
    if (body.share.includes('email')) {
      const email = await this.d.emailOf(viewer.userId);
      if (!email) throw badRequest('Your account has no email address to share');
      shared.email = email;
    }
    const enc = this.d.cipher.encrypt(JSON.stringify(shared));
    return this.answer(
      viewer,
      intro,
      { status: 'accepted', declineReason: null, sharedContactEnc: enc },
      meta,
    );
  }

  async decline(
    viewer: AuthState,
    id: string,
    body: z.output<typeof introDeclineBody>,
    meta: RequestMetaLite,
  ) {
    const intro = await this.ownPending(viewer, id);
    return this.answer(
      viewer,
      intro,
      { status: 'declined', declineReason: body.reason, sharedContactEnc: null },
      meta,
    );
  }

  private async ownPending(viewer: AuthState, id: string): Promise<NetworkIntroDoc> {
    const intro = await NetworkIntroModel.findOne({
      _id: id,
      toUserId: viewer.userId,
    }).lean<NetworkIntroDoc>();
    if (!intro) throw notFound('Intro');
    if (intro.status !== 'pending') throw conflict('This intro was already answered');
    return intro;
  }

  private async answer(
    viewer: AuthState,
    intro: NetworkIntroDoc,
    set: { status: 'accepted' | 'declined'; declineReason: string | null; sharedContactEnc: string | null },
    meta: RequestMetaLite,
  ) {
    const now = new Date();
    const r = await NetworkIntroModel.updateOne(
      { _id: intro._id, status: 'pending' },
      { $set: { status: set.status, declineReason: set.declineReason, answeredAt: now } },
    );
    if (!r.modifiedCount) throw conflict('This intro was already answered');
    const out = await networkScope(
      'network:intro-reply',
      this.actor(viewer, meta),
      () =>
        NetworkIntroOutModel.findOneAndUpdate(
          { tenantId: intro.fromTenantId, _id: intro._id },
          { $set: { ...set, answeredAt: now } },
          { returnDocument: 'after' },
        )
          .select('userId tenantId')
          .lean(),
      (o) => (o ? [{ tenantId: String(intro.fromTenantId), count: 1 }] : []),
    );
    if (out) {
      const me = await NetworkProfileModel.findOne({ userId: viewer.userId }).select('name').lean();
      await runInTenant(intro.fromTenantId as unknown as Types.ObjectId, () =>
        this.d.notify(String(out.userId), 'network_intro_answered', {
          name: me?.name ?? '',
          decision: set.status,
          introId: String(intro._id),
        }),
      ).catch((err: unknown) => this.d.logger.warn({ err }, 'network answer notification failed'));
    }
    if (set.status === 'accepted') await this.track(viewer.userId, 'network_intro_accepted', {});
    return { status: set.status };
  }

  /** P6: the alumnus reports an intro; the requester's college counts it (two pause, N22). */
  async report(viewer: AuthState, id: string, meta: RequestMetaLite) {
    const intro = await NetworkIntroModel.findOne({
      _id: id,
      toUserId: viewer.userId,
    }).lean<NetworkIntroDoc>();
    if (!intro) throw notFound('Intro');
    if (intro.reportedAt) throw conflict('You already reported this intro');
    await NetworkIntroModel.updateOne(
      { _id: intro._id },
      {
        $set: {
          reportedAt: new Date(),
          ...(intro.status === 'pending'
            ? { status: 'declined', declineReason: 'not_now', answeredAt: new Date() }
            : {}),
        },
      },
    );
    const mine = await NetworkProfileModel.findOne({ userId: viewer.userId }).select('ref').lean();
    const reporter = `${String(requireTenantId())}:${mine?.ref ?? viewer.userId}`;
    await networkInTenant(
      'network:intro-report',
      this.actor(viewer, meta),
      intro.fromTenantId as unknown as Types.ObjectId,
      () => this.recordReport(String(intro._id), reporter),
      { targetType: 'network_intro', targetId: String(intro._id) },
    );
    return { reported: true };
  }

  /** Runs in the requester's college (P6). */
  private async recordReport(introId: string, reporter: string) {
    const out = await NetworkIntroOutModel.findOneAndUpdate(
      { _id: introId },
      { $set: { status: 'declined', declineReason: 'not_now', answeredAt: new Date() } },
    )
      .select('userId status')
      .lean();
    if (!out) return;
    const p = await NetworkPrefsModel.findOneAndUpdate(
      { userId: out.userId },
      { $addToSet: { reportedBy: reporter } },
      { returnDocument: 'after' },
    ).lean<NetworkPrefsDoc>();
    if (p && !p.pausedAt && (p.reportedBy?.length ?? 0) >= NETWORK_REPORTS_TO_PAUSE)
      await NetworkPrefsModel.updateOne(
        { _id: (p as unknown as { _id: Types.ObjectId })._id },
        { $set: { pausedAt: new Date() } },
      );
  }

  /** P5: pending intros past their expiry, both sides. Runs in the reconcile of each college. */
  private async expireIntros(now: Date): Promise<number> {
    const due = await NetworkIntroModel.find({ status: 'pending', expiresAt: { $lt: now } })
      .select('_id fromTenantId')
      .limit(500)
      .lean();
    if (!due.length) {
      await NetworkIntroOutModel.updateMany(
        { status: 'pending', expiresAt: { $lt: now } },
        { $set: { status: 'expired' } },
      );
      return 0;
    }
    await NetworkIntroModel.updateMany(
      { _id: { $in: due.map((d) => d._id) } },
      { $set: { status: 'expired' } },
    );
    const byTenantIds = new Map<string, Types.ObjectId[]>();
    for (const d of due)
      byTenantIds.set(String(d.fromTenantId), [
        ...(byTenantIds.get(String(d.fromTenantId)) ?? []),
        d._id as unknown as Types.ObjectId,
      ]);
    for (const [tenantId, ids] of byTenantIds)
      await networkScope(
        'network:intro-expire',
        { tenantId: String(requireTenantId()), kind: 'job', userId: null },
        () =>
          NetworkIntroOutModel.updateMany(
            { tenantId: new Types.ObjectId(tenantId), _id: { $in: ids }, status: 'pending' },
            { $set: { status: 'expired' } },
          ),
        (r) => [{ tenantId, count: r.modifiedCount }],
      );
    await NetworkIntroOutModel.updateMany(
      { status: 'pending', expiresAt: { $lt: now } },
      { $set: { status: 'expired' } },
    );
    return due.length;
  }

  // ── The college (Admin › Network) ─────────────────────────────

  async setSwitches(actor: AuthState, body: z.output<typeof networkSwitchBody>, meta: RequestMetaLite) {
    const t = await this.tenant();
    const now = switches(t);
    const next = {
      alumniDiscovery: body.alumniDiscovery ?? now.alumniDiscovery,
      employerAccess: body.employerAccess ?? now.employerAccess,
      credentials: body.credentials ?? now.credentials,
    };
    const turningOn = (Object.keys(next) as (keyof typeof next)[]).some((k) => next[k] && !now[k]);
    if (turningOn && !body.acceptTerms) throw badRequest('Accept the network terms to turn this on');
    await TenantModel.updateOne(
      { _id: t._id },
      {
        $set: {
          'network.alumniDiscovery': next.alumniDiscovery,
          'network.employerAccess': next.employerAccess,
          'network.credentials': next.credentials,
          'network.changedBy': new Types.ObjectId(actor.userId),
          'network.changedAt': new Date(),
          ...(turningOn ? { 'network.termsVersion': NETWORK_TERMS_VERSION } : {}),
        },
      },
    );
    invalidateTenant(t.slug);
    // Members who already opted in appear (or disappear) at once, not at the next cycle.
    await this.reconcile();
    await audit.record(
      {
        action: 'network.switched',
        actorId: actor.userId,
        targetType: 'tenant',
        targetId: String(t._id),
        meta: {
          ...next,
          termsVersion: turningOn ? NETWORK_TERMS_VERSION : (t.network?.termsVersion ?? null),
        },
      },
      meta,
    );
    return next;
  }

  async adminView(): Promise<
    Omit<NetworkAdminView, 'postings' | 'blocked'> & { paused: { userId: string; name: string }[] }
  > {
    const t = await this.tenant();
    const [discoverable, employerVisible, paused] = await Promise.all([
      NetworkProfileModel.countDocuments({ discoverable: true }),
      NetworkProfileModel.countDocuments({ employerVisible: true }),
      NetworkPrefsModel.find({ pausedAt: { $ne: null } })
        .select('userId')
        .limit(100)
        .lean(),
    ]);
    const facts = await this.d.profiles.networkFacts(paused.map((p) => p.userId));
    return {
      switches: switches(t),
      termsVersion: t.network?.termsVersion ?? null,
      changedAt: t.network?.changedAt ? new Date(t.network.changedAt).toISOString() : null,
      activity: await audit.countByPrefix('network.', new Date(Date.now() - 30 * DAY), { external: true }),
      members: { discoverable: suppress(discoverable), employerVisible: suppress(employerVisible) },
      paused: paused.map((p) => ({
        userId: String(p.userId),
        name: facts.get(String(p.userId))?.name ?? '',
      })),
    };
  }

  /** The college reviewed a paused member: access comes back, the reports are cleared. */
  async resume(actor: AuthState, userId: string, meta: RequestMetaLite) {
    const r = await NetworkPrefsModel.updateOne(
      { userId: new Types.ObjectId(userId), pausedAt: { $ne: null } },
      { $set: { pausedAt: null, reportedBy: [] } },
    );
    if (!r.modifiedCount) throw notFound('Paused member');
    await audit.record(
      { action: 'network.resumed', actorId: actor.userId, targetType: 'user', targetId: userId },
      meta,
    );
    return { resumed: true };
  }

  // ── Privacy ─────────────────────────────

  async exportFor(userId: string) {
    const uid = new Types.ObjectId(userId);
    const [prefs, profile, received, sent, consents] = await Promise.all([
      NetworkPrefsModel.findOne({ userId: uid }).select('-reportedBy').lean(),
      NetworkProfileModel.findOne({ userId: uid }).lean(),
      NetworkIntroModel.find({ toUserId: uid }).select('fromName helpWith goal note status createdAt').lean(),
      NetworkIntroOutModel.find({ userId: uid })
        .select('toName toCompany helpWith goal status createdAt')
        .lean(),
      consentService.networkHistory(userId),
    ]);
    return { prefs, profile, introsReceived: received, introsSent: sent, consents };
  }

  /** Deletes the member's projection, choices and intros on both sides (the other side keeps "Former member"). */
  async eraseFor(userId: string) {
    const uid = new Types.ObjectId(userId);
    const actor: NetworkActor = { tenantId: String(requireTenantId()), kind: 'job', userId: null };
    const received = await NetworkIntroModel.find({ toUserId: uid }).select('_id fromTenantId').lean();
    const sent = await NetworkIntroOutModel.find({ userId: uid }).select('_id toTenantId').lean();
    for (const r of received)
      await networkScope(
        'network:intro-expire',
        actor,
        () =>
          NetworkIntroOutModel.updateOne(
            { tenantId: r.fromTenantId, _id: r._id },
            {
              $set: { toName: 'Former member', toCompany: null, sharedContactEnc: null, status: 'withdrawn' },
            },
          ),
        () => [{ tenantId: String(r.fromTenantId), count: 1 }],
      );
    for (const s of sent)
      await networkScope(
        'network:intro-expire',
        actor,
        () =>
          NetworkIntroModel.updateOne(
            { tenantId: s.toTenantId, _id: s._id },
            {
              $set: {
                fromName: 'Former member',
                fromBranch: null,
                fromGradYear: null,
                note: '',
                status: 'withdrawn',
              },
            },
          ),
        () => [{ tenantId: String(s.toTenantId), count: 1 }],
      );
    await NetworkIntroModel.deleteMany({ toUserId: uid });
    await NetworkIntroOutModel.deleteMany({ userId: uid });
    await NetworkProfileModel.deleteMany({ userId: uid });
    await NetworkPrefsModel.deleteMany({ userId: uid });
  }
}

function firstAndInitial(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? name;
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return last ? `${first} ${last[0]?.toUpperCase()}.` : first;
}

function byTenant(rows: Record<string, unknown>[]): Touch[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(String(r.tenantId), (m.get(String(r.tenantId)) ?? 0) + 1);
  return [...m].map(([tenantId, count]) => ({ tenantId, count }));
}

export async function collegeNames(ids: unknown[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return new Map();
  const rows = await TenantModel.find({ _id: { $in: unique.map((i) => new Types.ObjectId(i)) } })
    .select('_id branding.displayName')
    .lean<{ _id: Types.ObjectId; branding: { displayName: string } }[]>();
  return new Map(rows.map((r) => [String(r._id), r.branding.displayName]));
}
