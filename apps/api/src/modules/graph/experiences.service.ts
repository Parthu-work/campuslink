import { Types } from 'mongoose';
import type { z } from 'zod';
import type {
  Branch,
  ExperienceBasis,
  ExperienceBody,
  ExperienceView,
  MyExperiencesView,
  experienceDecisionBody,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { ErrorCode } from '@campuslink/shared';
import { companyKey } from '../../lib/company.js';
import { plainText } from '../../lib/text.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { ModeratableHandler, Removal } from '../moderation/moderation.service.js';
import { ExperienceModel, ExperiencePromptModel, type ExperienceDoc } from './graph.model.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** What the Experience Bank asks other modules (they talk through services). */
export interface ExperiencesDeps {
  notifications: NotificationsService;
  /** The member's verified offers (company and role only). */
  verifiedOffers: (userId: string) => Promise<{ company: string }[]>;
  /** Companies whose campus drive the member sat. */
  companiesSat: (userId: string) => Promise<{ key: string; name: string }[]>;
  /** Branch, batch and name per member (profiles). */
  cohortOf: (
    ids: string[],
  ) => Promise<Map<string, { name: string; branch: string | null; gradYear: number | null }>>;
  /** Sends picked questions to the mock interview bank's review queue (G3). */
  suggestInterviewQuestions: (
    questions: { track: 'hr' | 'technical'; text: string; company: string }[],
  ) => Promise<number>;
}

/**
 * The Interview Experience Bank (prompt 2, G10): structured write-ups by college-verified authors
 * (a verified offer or a drive at that company, or alumni), reviewed by the placement cell or
 * faculty before anyone else reads them, moderated after that like any content. Questions a
 * reviewer picks go to the mock interview bank (G3) or become practice questions (G4), each only
 * after its own review.
 */
export class ExperiencesService {
  track: Track = noTrack;
  constructor(private readonly d: ExperiencesDeps) {}

  /** Companies the member may write about, and whether any company is allowed (alumni). */
  private async allowed(viewer: AuthState) {
    const [offers, sat] = await Promise.all([
      this.d.verifiedOffers(viewer.userId),
      this.d.companiesSat(viewer.userId),
    ]);
    const companies = new Map<string, { key: string; name: string; basis: ExperienceBasis }>();
    for (const s of sat) companies.set(s.key, { ...s, basis: 'drive' });
    for (const o of offers)
      companies.set(companyKey(o.company), {
        key: companyKey(o.company),
        name: o.company,
        basis: 'verified_offer',
      });
    return { companies, anyCompany: viewer.roles.includes('ALUMNI') };
  }

  private async views(
    viewer: AuthState | null,
    rows: ExperienceDoc[],
    reviewer = false,
  ): Promise<ExperienceView[]> {
    const named = rows.filter((r) => r.named && r.authorId).map((r) => String(r.authorId));
    const people = named.length ? await this.d.cohortOf([...new Set(named)]) : new Map();
    return rows.map((r) => {
      const mine = !!viewer && !!r.authorId && String(r.authorId) === viewer.userId;
      const person = r.named && r.authorId ? people.get(String(r.authorId)) : undefined;
      return {
        id: String(r._id),
        company: { key: r.companyKey, name: r.companyName },
        role: r.role,
        year: r.year,
        rounds: r.rounds.map((x) => ({
          kind: x.kind,
          name: x.name,
          questions: x.questions.map((q) => ({ text: q.text, sent: mine || reviewer ? q.sent : null })),
          notes: x.notes,
        })),
        tips: r.tips,
        difficulty: r.difficulty,
        result: r.result,
        author: {
          name: person ? firstName(person.name) : null,
          branch: r.branch,
          gradYear: r.gradYear,
          basis: r.basis,
        },
        status: r.status === 'removed' ? 'published' : r.status,
        reason: mine || reviewer ? r.reason : null,
        removed: r.status === 'removed',
        mine,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /** Share a write-up. It waits for review; the author is told when it is published or sent back. */
  async create(viewer: AuthState, body: ExperienceBody): Promise<ExperienceView> {
    const key = companyKey(body.company);
    if (!key) throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'Name the company');
    const { companies, anyCompany } = await this.allowed(viewer);
    const known = companies.get(key);
    if (!known && !anyCompany)
      throw new AppError(
        403,
        ErrorCode.FORBIDDEN,
        'You can share an interview with a company you have a verified offer from or sat a campus drive with',
      );
    const me = (await this.d.cohortOf([viewer.userId])).get(viewer.userId);
    const doc = await ExperienceModel.create({
      authorId: oid(viewer.userId),
      companyKey: key,
      companyName: known?.name ?? plainText(body.company),
      role: plainText(body.role),
      year: body.year,
      rounds: body.rounds.map((r) => ({
        kind: r.kind,
        name: plainText(r.name),
        questions: r.questions.map((q) => ({ text: plainText(q), sent: null })),
        notes: plainText(r.notes),
      })),
      tips: plainText(body.tips),
      difficulty: body.difficulty,
      result: body.result,
      named: body.named,
      basis: known?.basis ?? 'alumni',
      branch: (me?.branch ?? null) as Branch | null,
      gradYear: me?.gradYear ?? null,
      status: 'pending',
    });
    await this.track(viewer.userId, 'experience_shared', { basis: doc.basis });
    return (await this.views(viewer, [doc.toObject() as ExperienceDoc]))[0] as ExperienceView;
  }

  async mine(viewer: AuthState): Promise<MyExperiencesView> {
    const [rows, allowed] = await Promise.all([
      ExperienceModel.find({ authorId: oid(viewer.userId) })
        .sort({ _id: -1 })
        .limit(50)
        .lean<ExperienceDoc[]>(),
      this.allowed(viewer),
    ]);
    return {
      items: await this.views(viewer, rows),
      companies: [...allowed.companies.values()]
        .map((c) => ({ key: c.key, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      anyCompany: allowed.anyCompany,
    };
  }

  /** The author may withdraw a write-up that is not yet published. */
  async withdraw(viewer: AuthState, id: string): Promise<void> {
    const r = await ExperienceModel.deleteOne({
      _id: oid(id),
      authorId: oid(viewer.userId),
      status: { $in: ['pending', 'rejected'] },
    });
    if (!r.deletedCount) {
      if (await ExperienceModel.exists({ _id: oid(id), authorId: oid(viewer.userId) }))
        throw conflict('A published write-up stays; ask a moderator to take it down');
      throw notFound('Write-up');
    }
  }

  /** Published write-ups about one company, newest first. */
  async forCompany(viewer: AuthState, key: string): Promise<ExperienceView[]> {
    const rows = await ExperienceModel.find({ companyKey: key, status: 'published' })
      .sort({ _id: -1 })
      .limit(50)
      .lean<ExperienceDoc[]>();
    return this.views(viewer, rows);
  }

  /** Published write-ups per company key (the company list). */
  async publishedCounts(): Promise<Map<string, { n: number; name: string }>> {
    const rows = await ExperienceModel.aggregate<{ _id: string; n: number; name: string }>([
      { $match: { status: 'published' } },
      { $group: { _id: '$companyKey', n: { $sum: 1 }, name: { $first: '$companyName' } } },
    ]);
    return new Map(rows.map((r) => [r._id, { n: r.n, name: r.name }]));
  }

  /** Whether the member already wrote about this company (the 7-day prompt is then not sent). */
  async wroteAbout(userId: string, key: string): Promise<boolean> {
    return !!(await ExperienceModel.exists({ authorId: oid(userId), companyKey: key }));
  }

  // ── Review (placement cell and faculty) ─────────────────────────────

  async queue(viewer: AuthState, status: 'pending' | 'published' | 'rejected'): Promise<ExperienceView[]> {
    const rows = await ExperienceModel.find({ status })
      .sort({ _id: status === 'pending' ? 1 : -1 })
      .limit(100)
      .lean<ExperienceDoc[]>();
    return this.views(viewer, rows, true);
  }

  async pendingCount(): Promise<number> {
    return ExperienceModel.countDocuments({ status: 'pending' });
  }

  async decide(
    viewer: AuthState,
    id: string,
    body: z.output<typeof experienceDecisionBody>,
  ): Promise<ExperienceView> {
    const approve = body.decision === 'approve';
    const doc = await ExperienceModel.findOneAndUpdate(
      { _id: oid(id), status: 'pending' },
      {
        $set: {
          status: approve ? 'published' : 'rejected',
          reason: approve ? null : plainText(body.reason ?? ''),
          reviewedBy: oid(viewer.userId),
          reviewedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    ).lean<ExperienceDoc>();
    if (!doc) {
      if (await ExperienceModel.exists({ _id: oid(id) }))
        throw conflict('This write-up was already reviewed');
      throw notFound('Write-up');
    }
    if (approve && body.bank.length) {
      const picked = body.bank.flatMap(({ round, question }) => {
        const r = doc.rounds[round];
        const q = r?.questions[question];
        return r && q && !q.sent ? [{ round, question, kind: r.kind, text: q.text }] : [];
      });
      if (picked.length) {
        await this.d.suggestInterviewQuestions(
          picked.map((p) => ({
            track: p.kind === 'hr' ? 'hr' : 'technical',
            text: p.text,
            company: doc.companyName,
          })),
        );
        const set: Record<string, string> = {};
        for (const p of picked) set[`rounds.${p.round}.questions.${p.question}.sent`] = 'bank';
        await ExperienceModel.updateOne({ _id: doc._id }, { $set: set });
      }
    }
    if (doc.authorId)
      await this.d.notifications.notify(
        doc.authorId,
        approve ? 'experience_published' : 'experience_returned',
        {
          company: doc.companyName,
          companyKey: doc.companyKey,
          experienceId: String(doc._id),
        },
      );
    const fresh = await ExperienceModel.findById(doc._id).lean<ExperienceDoc>();
    return (await this.views(viewer, [fresh ?? doc], true))[0] as ExperienceView;
  }

  /** A reviewer wrote a practice question from one of a published write-up's questions (G4). */
  async markPractice(id: string, round: number, question: number): Promise<void> {
    const r = await ExperienceModel.updateOne(
      { _id: oid(id), status: 'published', [`rounds.${round}.questions.${question}`]: { $exists: true } },
      { $set: { [`rounds.${round}.questions.${question}.sent`]: 'practice' } },
    );
    if (!r.matchedCount) throw notFound('Question');
  }

  /** Moderation after publishing (reports, removal with a reason the author sees, appeals). */
  readonly handler: ModeratableHandler = {
    load: async (id: string) => {
      const r = await ExperienceModel.findById(id).lean<ExperienceDoc>();
      return r && (r.status === 'published' || r.status === 'removed')
        ? {
            authorId: r.authorId ? String(r.authorId) : '',
            status: r.status,
            snapshot: [
              `${r.companyName} · ${r.role} · ${r.year}`,
              ...r.rounds.flatMap((x) => [x.name, ...x.questions.map((q) => q.text), x.notes]),
              r.tips,
            ]
              .filter(Boolean)
              .join('\n'),
            context: { companyKey: r.companyKey, experienceId: String(r._id) },
          }
        : null;
    },
    setRemoved: async (id: string, removal: Removal | null) => {
      const r = await ExperienceModel.updateOne(
        { _id: oid(id), status: removal ? 'published' : 'removed' },
        { $set: { status: removal ? 'removed' : 'published', removal } },
      );
      return r.modifiedCount > 0;
    },
  };

  // ── Privacy ─────────────────────────────

  async exportFor(userId: string) {
    const [writeUps, prompts] = await Promise.all([
      ExperienceModel.find({ authorId: oid(userId) })
        .select('companyName role year rounds tips difficulty result named status reason createdAt')
        .lean(),
      ExperiencePromptModel.find({ userId: oid(userId) })
        .select('companyKey dueAt sentAt')
        .lean(),
    ]);
    return { interviewExperiences: writeUps, experiencePrompts: prompts };
  }

  /**
   * Unpublished write-ups and prompts are deleted. Published ones stay with the college as a
   * former member's (no author, no name), like answers and posts: juniors still learn from them.
   */
  async eraseFor(userId: string) {
    const u = oid(userId);
    await ExperienceModel.deleteMany({ authorId: u, status: { $in: ['pending', 'rejected'] } });
    await ExperienceModel.updateMany({ authorId: u }, { $set: { authorId: null, named: false } });
    await ExperiencePromptModel.deleteMany({ userId: u });
  }
}
