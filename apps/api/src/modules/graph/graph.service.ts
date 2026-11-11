import { Types } from 'mongoose';
import {
  EXPERIENCE_PROMPT_DAYS,
  GRAPH_YEARS_SHOWN,
  SMALL_CELL,
  graphDay,
  graphDue,
  suppress,
  type Branch,
  type CompaniesView,
  type CompanyGraphView,
  type CompanyListItem,
  type CtcBand,
  type OutcomeEvidence,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { notFound } from '../../lib/errors.js';
import { requireTenantId } from '../../lib/context.js';
import { companyKey } from '../../lib/company.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { Logger } from '../../lib/logger.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import { TenantModel } from '../tenants/tenant.model.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import {
  buildCompanyGraphs,
  buildMentorOutcomes,
  evidenceFor,
  type DriveRow,
  type OfferRow,
  type ReferralRow,
  type SessionRow,
} from './compute.js';
import {
  CompanyGraphModel,
  ExperiencePromptModel,
  MentorOutcomeModel,
  type CompanyGraphDoc,
  type MentorOutcomeDoc,
} from './graph.model.js';
import type { ExperiencesService } from './experiences.service.js';

export const GRAPH_JOB = 'graph.nightly';
export const EXPERIENCE_PROMPT_JOB = 'graph.experience_prompt';
const DAY = 86_400_000;
/** Offers verified longer ago than this are not asked about (the first run after deploying). */
const PROMPT_LOOKBACK_DAYS = 30;
const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
/** CTC bands in words (the copilot's index is English; the app words them per language). */
const BAND_TEXT: Record<CtcBand, string> = {
  under_3: 'under ₹3 LPA',
  '3_5': '₹3–5 LPA',
  '5_8': '₹5–8 LPA',
  '8_12': '₹8–12 LPA',
  '12_20': '₹12–20 LPA',
  '20_plus': '₹20 LPA and above',
};
/** A share shown only when the group it is built on has at least SMALL_CELL people. */
const rate = (part: number, whole: number) => (whole >= SMALL_CELL ? Math.round((part / whole) * 100) : null);

/** Every input comes from the module that owns it (modules talk through services). */
export interface GraphDeps {
  logger: Logger;
  jobs: JobQueue;
  notifications: NotificationsService;
  experiences: ExperiencesService;
  /** Verified offers (with when they were verified, for the 7-day prompt). */
  offers: () => Promise<(OfferRow & { verifiedAt: Date | null })[]>;
  drives: () => Promise<DriveRow[]>;
  referrals: () => Promise<ReferralRow[]>;
  alumni: () => Promise<{ userId: string; companyKey: string; company: string }[]>;
  mentors: () => Promise<Set<string>>;
  sessions: () => Promise<SessionRow[]>;
  /** The placement cell's company list (its spelling of names). */
  companies: () => Promise<{ key: string; name: string }[]>;
  branchOf: (ids: string[]) => Promise<Map<string, string | null>>;
  ownBranch: (userId: string) => Promise<string | null>;
}

/**
 * The Placement Graph (prompt 2, G10). Each night, one job per college (the job id carries the
 * India-time day) rebuilds a summary per company from verified offers, drive rounds, referrals
 * with their reported outcomes, alumni profiles (only companies shown to members) and mentoring
 * sessions; and, per mentor, what their mentees and referrals led to (outcome-proven matching). It
 * also schedules the 7-day "share your interview" ask for newly verified offers. Company pages
 * suppress every count under five and show shares only for groups of five or more.
 */
export class GraphService {
  track: Track = noTrack;
  private readonly viewedToday = new Set<string>();
  private viewedDay = '';

  constructor(private readonly d: GraphDeps) {}

  /** Queues today's run per active college once it is due; ids dedupe per college and day. */
  static async enqueueNightly(jobs: JobQueue, now = new Date(), only?: ReadonlySet<string>): Promise<number> {
    if (!graphDue(now)) return 0;
    const day = graphDay(now);
    const tenants = (
      await TenantModel.find({ kind: 'college', status: 'active' }).select('_id').lean()
    ).filter((t) => !only || only.has(String(t._id)));
    for (const t of tenants)
      await jobs.enqueue(
        GRAPH_JOB,
        { tenantId: String(t._id), day },
        { jobId: `graph-${String(t._id)}-${day}` },
      );
    return tenants.length;
  }

  /** The nightly run for the college in context. Idempotent: it replaces the college's summaries. */
  async run(job: Partial<TenantJob> = {}, now = new Date()): Promise<{ companies: number; mentors: number }> {
    const day = typeof job.day === 'string' ? job.day : graphDay(now);
    const [offers, drives, referrals, alumni, mentors, sessions, companies] = await Promise.all([
      this.d.offers(),
      this.d.drives(),
      this.d.referrals(),
      this.d.alumni(),
      this.d.mentors(),
      this.d.sessions(),
      this.d.companies(),
    ]);
    const graphs = buildCompanyGraphs({
      offers,
      drives,
      referrals,
      alumni,
      mentors,
      sessions,
      names: new Map(companies.map((c) => [c.key, c.name])),
    }).slice(0, 2000);
    for (const g of graphs)
      await CompanyGraphModel.updateOne(
        { companyKey: g.companyKey },
        { $set: { ...g, day, computedAt: now } },
        { upsert: true },
      );
    await CompanyGraphModel.deleteMany({ day: { $ne: day } });

    const menteeIds = [...new Set(sessions.map((s) => s.menteeId))];
    const outcomes = buildMentorOutcomes(
      { offers, drives, referrals, sessions },
      menteeIds.length ? await this.d.branchOf(menteeIds) : new Map(),
    );
    for (const o of outcomes)
      await MentorOutcomeModel.updateOne(
        { mentorId: oid(o.mentorId) },
        { $set: { mentees: o.mentees, referralsConverted: o.referralsConverted, day } },
        { upsert: true },
      );
    await MentorOutcomeModel.deleteMany({ day: { $ne: day } });

    await this.schedulePrompts(offers, now);
    return { companies: graphs.length, mentors: outcomes.length };
  }

  private async queueToday() {
    const tenantId = String(requireTenantId());
    const day = graphDay();
    await this.d.jobs
      .enqueue(GRAPH_JOB, { tenantId, day }, { jobId: `graph-${tenantId}-${day}` })
      .catch((err: unknown) => this.d.logger.warn({ err }, 'graph first run not queued'));
  }

  /** The 7-day ask, once per verified offer (the prompt record is the claim), as a delayed job. */
  private async schedulePrompts(
    offers: { id: string; userId: string | null; companyKey: string; verifiedAt: Date | null }[],
    now: Date,
  ) {
    const since = now.getTime() - PROMPT_LOOKBACK_DAYS * DAY;
    for (const o of offers) {
      if (!o.userId || !o.verifiedAt || o.verifiedAt.getTime() < since) continue;
      const dueAt = new Date(o.verifiedAt.getTime() + EXPERIENCE_PROMPT_DAYS * DAY);
      const res = await ExperiencePromptModel.updateOne(
        { offerId: oid(o.id) },
        { $setOnInsert: { userId: oid(o.userId), companyKey: o.companyKey, dueAt } },
        { upsert: true },
      );
      if (!res.upsertedCount) continue;
      await this.d.jobs.enqueue(
        EXPERIENCE_PROMPT_JOB,
        { tenantId: String(requireTenantId()), offerId: o.id },
        { jobId: `expprompt-${o.id}`, delayMs: Math.max(0, dueAt.getTime() - now.getTime()) },
      );
    }
  }

  /** Job: "Help your juniors: share your interview", unless they already did (sent once). */
  async onPrompt(job: TenantJob): Promise<void> {
    const p = await ExperiencePromptModel.findOneAndUpdate(
      { offerId: oid(String(job.offerId)), sentAt: null },
      { $set: { sentAt: new Date() } },
      { returnDocument: 'after' },
    ).lean<{ userId: Types.ObjectId; companyKey: string }>();
    if (!p) return;
    if (await this.d.experiences.wroteAbout(String(p.userId), p.companyKey)) return;
    const graph = await CompanyGraphModel.findOne({ companyKey: p.companyKey }).select('name').lean();
    await this.d.notifications.notify(p.userId, 'experience_prompt', {
      company: graph?.name ?? p.companyKey,
      companyKey: p.companyKey,
    });
  }

  // ── Company pages ─────────────────────────────

  async companies(_viewer: AuthState, q?: string): Promise<CompaniesView> {
    const [rows, written] = await Promise.all([
      CompanyGraphModel.find()
        .sort({ offers: -1, alumni: -1, name: 1 })
        .limit(1000)
        .lean<CompanyGraphDoc[]>(),
      this.d.experiences.publishedCounts(),
    ]);
    const items: CompanyListItem[] = rows.map((g) => ({
      key: g.companyKey,
      name: g.name,
      offers: suppress(g.offers),
      batches: g.batches
        .filter((b) => b.offers > 0)
        .map((b) => b.gradYear)
        .slice(0, GRAPH_YEARS_SHOWN),
      alumni: suppress(g.alumni),
      mentors: suppress(g.mentors),
      experiences: written.get(g.companyKey)?.n ?? 0,
    }));
    // A college opening company pages before its first nightly run gets today's run queued now
    // (the job id is per college and day, so this asks at most once a day).
    if (!rows.length) await this.queueToday();
    const known = new Set(items.map((i) => i.key));
    for (const [key, w] of written)
      if (!known.has(key))
        items.push({ key, name: w.name, offers: 0, batches: [], alumni: 0, mentors: 0, experiences: w.n });
    const needle = q ? companyKey(q) : '';
    return {
      items: needle
        ? items.filter((i) => i.key.includes(needle) || i.name.toLowerCase().includes(q?.toLowerCase() ?? ''))
        : items,
      computedAt: rows[0]?.computedAt.toISOString() ?? null,
    };
  }

  async company(viewer: AuthState, key: string): Promise<CompanyGraphView> {
    const [g, experiences, own] = await Promise.all([
      CompanyGraphModel.findOne({ companyKey: key }).lean<CompanyGraphDoc>(),
      this.d.experiences.forCompany(viewer, key),
      this.d.ownBranch(viewer.userId).catch(() => null),
    ]);
    if (!g && !experiences.length) throw notFound('Company');
    await this.viewed(viewer, key);
    const mineInBranch = own && g ? g.branches.find((b) => b.branch === own) : undefined;
    return {
      key,
      name: g?.name ?? experiences[0]?.company.name ?? key,
      computedAt: g?.computedAt.toISOString() ?? null,
      offers: suppress(g?.offers ?? 0),
      batches: (g?.batches ?? []).slice(0, GRAPH_YEARS_SHOWN).map((b) => ({
        gradYear: b.gradYear,
        offers: suppress(b.offers),
        band: b.offers >= SMALL_CELL ? b.band : null,
      })),
      branches: (g?.branches ?? []).map((b) => ({ branch: b.branch, offers: suppress(b.offers) })),
      yourBranch: own && g ? { branch: own as Branch, offers: suppress(mineInBranch?.offers ?? 0) } : null,
      drives: suppress(g?.drives ?? 0),
      rounds: (g?.rounds ?? []).map((r) => ({
        kind: r.kind,
        appeared: suppress(r.appeared),
        passRate: rate(r.cleared, r.appeared),
      })),
      alumni: suppress(g?.alumni ?? 0),
      mentors: suppress(g?.mentors ?? 0),
      sessions: suppress(g?.sessions ?? 0),
      referrals: {
        referred: suppress(g?.referrals.referred ?? 0),
        converted: suppress(g?.referrals.converted ?? 0),
        rate: rate(g?.referrals.converted ?? 0, g?.referrals.reported ?? 0),
      },
      experiences,
    };
  }

  /** Prompt 2, G11: the companies with a page, to recognise one named in a copilot question. */
  async companyNames(): Promise<{ key: string; name: string }[]> {
    const rows = await CompanyGraphModel.find()
      .select('companyKey name')
      .limit(2000)
      .lean<{ companyKey: string; name: string }[]>();
    return rows.map((r) => ({ key: r.companyKey, name: r.name }));
  }

  /** Prompt 2, G11: which of these companies have a page (the copilot re-checks its sources). */
  async hasCompanies(keys: string[]): Promise<Set<string>> {
    const rows = await CompanyGraphModel.find({ companyKey: { $in: keys } })
      .select('companyKey')
      .lean<{ companyKey: string }[]>();
    return new Set(rows.map((r) => r.companyKey));
  }

  /**
   * Prompt 2, G11: each company page as text for the Career Copilot's index, with exactly the
   * page's rules (counts through `suppress()`, shares and bands only from five, never a member).
   */
  async copilotTexts(): Promise<{ key: string; name: string; text: string }[]> {
    const rows = await CompanyGraphModel.find().sort({ offers: -1 }).limit(1000).lean<CompanyGraphDoc[]>();
    const n = (x: number) => String(suppress(x));
    return rows.map((g) => ({
      key: g.companyKey,
      name: g.name,
      text: [
        `Company: ${g.name}. Students placed there (verified job offers, all batches on record): ${n(g.offers)}.`,
        ...g.batches
          .slice(0, GRAPH_YEARS_SHOWN)
          .map(
            (b) =>
              `Batch ${b.gradYear}: ${n(b.offers)} placed${b.offers >= SMALL_CELL && b.band ? `, median CTC band ${BAND_TEXT[b.band]}` : ''}.`,
          ),
        g.branches.length
          ? `By branch: ${g.branches.map((b) => `${b.branch} ${n(b.offers)}`).join(', ')}.`
          : '',
        `Campus drives with results: ${n(g.drives)}.`,
        ...g.rounds.map((r) => {
          const pr = rate(r.cleared, r.appeared);
          return `Round ${r.kind.replace('_', ' ')}: ${n(r.appeared)} sat it${pr === null ? '' : `, ${pr}% cleared`}.`;
        }),
        `Alumni working there: ${n(g.alumni)}; of them taking mentoring requests: ${n(g.mentors)}; mentoring sessions with them: ${n(g.sessions)}.`,
        g.referrals.referred
          ? `Referrals by alumni there: ${n(g.referrals.referred)}; led to an interview or offer, as students reported: ${n(g.referrals.converted)}.`
          : '',
        '“<5” means fewer than five.',
      ]
        .filter(Boolean)
        .join('\n'),
    }));
  }

  /** `company_page_viewed` once per member, company and day (per process). */
  private async viewed(viewer: AuthState, key: string) {
    const day = graphDay();
    if (this.viewedDay !== day) {
      this.viewedDay = day;
      this.viewedToday.clear();
    }
    const k = `${String(requireTenantId())}:${viewer.userId}:${key}`;
    if (this.viewedToday.has(k)) return;
    this.viewedToday.add(k);
    await this.track(viewer.userId, 'company_page_viewed');
  }

  // ── Outcome-proven matching ─────────────────────────────

  /** Evidence per mentor for this viewer, from last night's mentor outcomes. */
  async evidence(
    mentee: { branch: string | null; targetCompanies: string[] },
    mentorIds: Types.ObjectId[],
  ): Promise<Map<string, OutcomeEvidence>> {
    if (!mentorIds.length) return new Map();
    const rows = await MentorOutcomeModel.find({ mentorId: { $in: mentorIds } }).lean<MentorOutcomeDoc[]>();
    const viewer = {
      branch: mentee.branch,
      targets: new Set(mentee.targetCompanies.map(companyKey).filter(Boolean)),
    };
    return new Map(rows.map((r) => [String(r.mentorId), evidenceFor(r, viewer)]));
  }

  // ── Privacy ─────────────────────────────

  /** A mentor's outcome summary is about them; the company summaries name nobody. */
  async exportFor(userId: string) {
    const row = await MentorOutcomeModel.findOne({ mentorId: oid(userId) })
      .select('mentees referralsConverted day')
      .lean();
    return { mentorOutcomes: row };
  }

  async eraseFor(userId: string) {
    await MentorOutcomeModel.deleteMany({ mentorId: oid(userId) });
  }
}
