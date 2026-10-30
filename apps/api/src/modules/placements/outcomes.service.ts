import { randomUUID } from 'node:crypto';
import { Types, type Model } from 'mongoose';
import type { z } from 'zod';
import {
  EXAM_LEVEL,
  EXAMS,
  type Exam,
  type ExamLevel,
  type examBody,
  type higherStudyBody,
  type OutcomeImportResult,
  type OutcomeKind,
  type OutcomeView,
  type ventureBody,
} from '@campuslink/shared';
import {
  ExamQualificationModel,
  HigherStudyModel,
  VentureModel,
  type ExamDoc,
  type HigherStudyDoc,
  type VentureDoc,
} from './outcomes.model.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { WhitelistService } from '../imports/whitelist.service.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { AuthState } from '../../types.js';
import { findHeader, readSheet, ROLL_HEADERS } from './sheet.js';

const PAGE = 30;
/** A member records at most this many of each kind (a guard against noise, not a quota anyone hits). */
const MAX_PER_KIND = 20;

type AnyDoc = (HigherStudyDoc | ExamDoc | VentureDoc) & { _id: Types.ObjectId; createdAt: Date };
type Fields = Record<string, unknown>;
type Body = z.output<typeof higherStudyBody> | z.output<typeof examBody> | z.output<typeof ventureBody>;

/** How each kind is stored, imported, matched on re-import and named in a notification. */
interface KindSpec {
  model: Model<never>;
  /** Columns a college sheet may use, by our field (normalised header names). */
  headers: Record<string, readonly string[]>;
  /** A sheet row (by our field) to stored fields, or why not. */
  fromRow: (row: Record<string, string>) => Fields | string;
  /** The same outcome for the same member (a re-import updates instead of adding). */
  sameAs: (f: Fields) => Fields;
  title: (d: Fields) => string;
}

const yearOf = (v: string | undefined) => {
  const n = Number((v ?? '').trim());
  return Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : null;
};
const examOf = (v: string | undefined): Exam | null => {
  const k = (v ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (k === 'STATE_PSC' || k === 'PSC' || k === 'APPSC' || k === 'TSPSC') return 'STATE_PSC';
  return (EXAMS as readonly string[]).includes(k) ? (k as Exam) : null;
};
const levelOf = (exam: Exam, given?: ExamLevel): ExamLevel =>
  exam === 'OTHER' ? (given ?? 'national') : EXAM_LEVEL[exam];
const truthy = (v: string | undefined) => /^(yes|y|true|1|registered)$/i.test((v ?? '').trim());

const KINDS: Record<OutcomeKind, KindSpec> = {
  higher_study: {
    model: HigherStudyModel as unknown as Model<never>,
    headers: {
      institution: ['institution', 'university', 'college', 'institute'],
      program: ['program', 'programme', 'course', 'degree'],
      country: ['country'],
      admitYear: ['admit year', 'admission year', 'year', 'year of admission'],
      qualifyingExam: ['qualifying exam', 'exam', 'entrance exam'],
    },
    fromRow: (r) => {
      const admitYear = yearOf(r.admitYear);
      if (!r.institution?.trim() || !r.program?.trim()) return 'Institution and programme are needed';
      if (!admitYear) return 'Admission year not readable';
      return {
        institution: r.institution.trim().slice(0, 160),
        program: r.program.trim().slice(0, 120),
        country: (r.country ?? '').trim().slice(0, 60) || 'India',
        admitYear,
        qualifyingExam: r.qualifyingExam?.trim() ? examOf(r.qualifyingExam) : null,
      };
    },
    sameAs: (f) => ({ institution: f.institution, program: f.program }),
    title: (d) => `${String(d.program)}, ${String(d.institution)}`,
  },
  exam: {
    model: ExamQualificationModel as unknown as Model<never>,
    headers: {
      exam: ['exam', 'examination', 'test'],
      year: ['year', 'exam year'],
      scoreBand: ['score band', 'score', 'rank', 'air', 'percentile'],
    },
    fromRow: (r) => {
      const exam = examOf(r.exam);
      const year = yearOf(r.year);
      if (!exam || exam === 'OTHER')
        return 'Exam not recognised (GATE, CAT, GRE, GMAT, IELTS, TOEFL, UPSC, STATE_PSC, NET)';
      if (!year) return 'Year not readable';
      return {
        exam,
        examName: '',
        year,
        scoreBand: (r.scoreBand ?? '').trim().slice(0, 60),
        level: levelOf(exam),
      };
    },
    sameAs: (f) => ({ exam: f.exam, year: f.year }),
    title: (d) => `${d.exam === 'OTHER' ? String(d.examName) : String(d.exam)} ${String(d.year)}`,
  },
  venture: {
    model: VentureModel as unknown as Model<never>,
    headers: {
      name: ['venture', 'name', 'startup', 'company', 'venture name'],
      registered: ['registered', 'is registered'],
      year: ['year', 'founded', 'year founded'],
    },
    fromRow: (r) => {
      const year = yearOf(r.year);
      if (!r.name?.trim()) return 'Venture name is needed';
      if (!year) return 'Year not readable';
      return { name: r.name.trim().slice(0, 120), registered: truthy(r.registered), year };
    },
    sameAs: (f) => ({ name: f.name }),
    title: (d) => String(d.name),
  },
};

export interface OutcomesDeps {
  profiles: ProfilesService;
  whitelist: WhitelistService;
  notifications: NotificationsService;
}

/**
 * Higher studies, exams and ventures (B8): reported by students and alumni and verified by the
 * placement cell, or imported from the college's sheets (verified). Reports count verified ones.
 */
export class OutcomesService {
  constructor(private readonly d: OutcomesDeps) {}

  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    const u = new Types.ObjectId(userId);
    const [higherStudies, exams, ventures] = await Promise.all([
      HigherStudyModel.find({ userId: u }).select('-tenantId -anonKey -verifiedBy').lean(),
      ExamQualificationModel.find({ userId: u }).select('-tenantId -anonKey -verifiedBy').lean(),
      VentureModel.find({ userId: u }).select('-tenantId -anonKey -verifiedBy').lean(),
    ]);
    return { higherStudies, exams, ventures };
  }

  /**
   * Verified outcomes stay in the college's record without the member (one random key keeps them
   * countable once); unverified ones are deleted.
   */
  async eraseFor(userId: string) {
    const u = new Types.ObjectId(userId);
    const anonKey = randomUUID();
    for (const k of Object.values(KINDS)) {
      await k.model.deleteMany({ userId: u, status: { $ne: 'verified' } } as never);
      await k.model.updateMany({ userId: u } as never, { $set: { userId: null, anonKey } } as never);
    }
  }

  private view(kind: OutcomeKind, d: AnyDoc, member?: OutcomeView['member']): OutcomeView {
    const base = {
      id: String(d._id),
      status: d.status as OutcomeView['status'],
      source: d.source as OutcomeView['source'],
      reason: d.reason ?? null,
      createdAt: d.createdAt.toISOString(),
      ...(member ? { member } : {}),
    };
    if (kind === 'higher_study') {
      const h = d as HigherStudyDoc;
      return {
        ...base,
        kind,
        institution: h.institution,
        program: h.program,
        country: h.country ?? 'India',
        admitYear: h.admitYear,
        qualifyingExam: (h.qualifyingExam ?? null) as Exam | null,
      };
    }
    if (kind === 'exam') {
      const e = d as ExamDoc;
      return {
        ...base,
        kind,
        exam: e.exam as Exam,
        examName: e.examName ?? '',
        year: e.year,
        scoreBand: e.scoreBand ?? '',
        level: e.level as ExamLevel,
      };
    }
    const v = d as VentureDoc;
    return { ...base, kind, name: v.name, registered: v.registered, year: v.year };
  }

  async mine(viewer: AuthState): Promise<OutcomeView[]> {
    const u = new Types.ObjectId(viewer.userId);
    const out: OutcomeView[] = [];
    for (const [kind, k] of Object.entries(KINDS) as [OutcomeKind, KindSpec][]) {
      const rows = (await k.model
        .find({ userId: u } as never)
        .sort({ _id: -1 })
        .limit(MAX_PER_KIND)
        .lean()) as unknown as AnyDoc[];
      out.push(...rows.map((r) => this.view(kind, r)));
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private fieldsOf(kind: OutcomeKind, body: Body): Fields {
    if (kind === 'exam') {
      const b = body as z.output<typeof examBody>;
      return {
        exam: b.exam,
        examName: b.exam === 'OTHER' ? b.examName : '',
        year: b.year,
        scoreBand: b.scoreBand,
        level: levelOf(b.exam, b.level),
      };
    }
    return { ...body };
  }

  /** A member reports one of their own outcomes; it counts once the placement cell verifies it. */
  async report(viewer: AuthState, kind: OutcomeKind, body: Body, meta: RequestMetaLite) {
    const k = KINDS[kind];
    const u = new Types.ObjectId(viewer.userId);
    if ((await k.model.countDocuments({ userId: u } as never)) >= MAX_PER_KIND)
      throw conflict('You have recorded the most this list holds');
    const own = await this.d.profiles.own(viewer.userId);
    const doc = (await k.model.create({
      ...this.fieldsOf(kind, body),
      userId: u,
      source: 'self',
      status: 'reported',
      branch: own.branch,
      gradYear: own.gradYear,
    } as never)) as unknown as { toObject(): AnyDoc };
    const saved = doc.toObject();
    await audit.record(
      {
        action: 'placements.outcome_reported',
        actorId: viewer.userId,
        targetType: kind,
        targetId: String(saved._id),
      },
      meta,
    );
    return this.view(kind, saved);
  }

  /** The member takes back an outcome the cell has not verified. */
  async remove(viewer: AuthState, kind: OutcomeKind, id: string) {
    const r = await KINDS[kind].model.deleteOne({
      _id: id,
      userId: new Types.ObjectId(viewer.userId),
      status: { $ne: 'verified' },
    } as never);
    if (!r.deletedCount) throw notFound('Outcome');
    return { removed: true };
  }

  private async members(rows: AnyDoc[]) {
    const ids = rows.flatMap((r) => (r.userId ? [String(r.userId)] : []));
    const [cohort, rolls] = await Promise.all([
      this.d.profiles.cohortOf(ids),
      this.d.whitelist.recordsOf(ids),
    ]);
    return (r: AnyDoc): NonNullable<OutcomeView['member']> => {
      const u = r.userId ? String(r.userId) : '';
      return {
        userId: u || null,
        name: cohort.get(u)?.name ?? '',
        rollNumber: rolls.get(u)?.rollNumber ?? null,
        branch: r.branch ?? null,
        gradYear: r.gradYear ?? null,
      };
    };
  }

  async queue(kind: OutcomeKind, status: string, cursor?: string) {
    const rows = (await KINDS[kind].model
      .find({ status, ...(cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {}) } as never)
      .sort({ _id: -1 })
      .limit(PAGE + 1)
      .lean()) as unknown as AnyDoc[];
    const page = rows.slice(0, PAGE);
    const member = await this.members(page);
    return {
      items: page.map((r) => this.view(kind, r, member(r))),
      nextCursor: rows.length > PAGE ? String(page.at(-1)?._id) : null,
    };
  }

  async decide(
    actorId: string,
    kind: OutcomeKind,
    id: string,
    decision: 'verify' | 'reject',
    reason: string | undefined,
    meta: RequestMetaLite,
  ) {
    const k = KINDS[kind];
    const doc = (await k.model
      .findOneAndUpdate(
        { _id: id, status: 'reported' } as never,
        {
          $set:
            decision === 'verify'
              ? {
                  status: 'verified',
                  verifiedBy: new Types.ObjectId(actorId),
                  verifiedAt: new Date(),
                  reason: null,
                }
              : { status: 'rejected', reason: reason ?? null },
        } as never,
        { returnDocument: 'after' },
      )
      .lean()) as unknown as AnyDoc | null;
    if (!doc) {
      if (await k.model.exists({ _id: id } as never)) throw conflict('This was already decided');
      throw notFound('Outcome');
    }
    await audit.record(
      {
        action: decision === 'verify' ? 'placements.outcome_verified' : 'placements.outcome_rejected',
        actorId,
        targetType: kind,
        targetId: id,
      },
      meta,
    );
    if (doc.userId)
      await this.d.notifications.notify(
        String(doc.userId),
        decision === 'verify' ? 'outcome_verified' : 'outcome_rejected',
        { title: k.title(doc as unknown as Fields).slice(0, 80) },
      );
    const member = await this.members([doc]);
    return this.view(kind, doc, member(doc));
  }

  /**
   * The college's own sheet (keyed by roll number): rows become verified outcomes of members on
   * the list. A row matching an outcome the member already has updates it. Rolls that are not a
   * member yet are listed back, never guessed.
   */
  async importSheet(
    actor: AuthState,
    kind: OutcomeKind,
    file: Express.Multer.File | undefined,
    meta: RequestMetaLite,
  ): Promise<OutcomeImportResult> {
    const k = KINDS[kind];
    const table = await readSheet(file);
    const rollCol = findHeader(table.headers, ROLL_HEADERS);
    if (!rollCol) throw badRequest('The file needs a roll number column');
    const cols = Object.fromEntries(
      Object.entries(k.headers).map(([field, names]) => [field, findHeader(table.headers, names)]),
    );
    const errors: { row: number; message: string }[] = [];
    const wanted: { row: number; roll: string; fields: Fields }[] = [];
    table.rows.forEach((raw, i) => {
      const roll = (raw[rollCol] ?? '').trim().toUpperCase();
      if (!roll) return void errors.push({ row: i + 2, message: 'Missing roll number' });
      const byField = Object.fromEntries(
        Object.entries(cols).map(([field, col]) => [field, col ? (raw[col] ?? '') : '']),
      );
      const fields = k.fromRow(byField);
      if (typeof fields === 'string') errors.push({ row: i + 2, message: fields });
      else wanted.push({ row: i + 2, roll, fields });
    });
    const members = await this.d.whitelist.membersByRoll(wanted.map((w) => w.roll));
    const cohort = await this.d.profiles.cohortOf([...members.values()]);
    const unknown: string[] = [];
    let created = 0;
    let updated = 0;
    for (const w of wanted) {
      const userId = members.get(w.roll);
      if (!userId) {
        unknown.push(w.roll);
        continue;
      }
      const c = cohort.get(userId);
      const set = {
        ...w.fields,
        status: 'verified',
        source: 'import',
        verifiedBy: new Types.ObjectId(actor.userId),
        verifiedAt: new Date(),
        reason: null,
        branch: c?.branch ?? null,
        gradYear: c?.gradYear ?? null,
      };
      const r = await k.model.updateOne(
        { userId: new Types.ObjectId(userId), ...k.sameAs(w.fields) } as never,
        { $set: set } as never,
        { upsert: true },
      );
      if (r.upsertedCount) created++;
      else updated++;
    }
    await audit.record(
      {
        action: 'placements.outcomes_imported',
        actorId: actor.userId,
        targetType: kind,
        meta: { created, updated, unknown: unknown.length, errors: errors.length },
      },
      meta,
    );
    return { created, updated, unknown: [...new Set(unknown)].slice(0, 200), errors: errors.slice(0, 100) };
  }

  async pendingCount() {
    const counts = await Promise.all(
      Object.values(KINDS).map((k) => k.model.countDocuments({ status: 'reported' } as never)),
    );
    return counts.reduce((a, b) => a + b, 0);
  }

  // ── Reports (B8) ─────────────────────────────
  /**
   * Verified outcomes for reports (aggregated there through `suppress()`): by batch, or for exams
   * by the calendar year they were qualified.
   */
  async verified(
    kind: OutcomeKind,
    by: { gradYear: number[] } | { year: number[] },
  ): Promise<
    (Fields & { subject: string; userId: string | null; branch: string | null; gradYear: number | null })[]
  > {
    const rows = (await KINDS[kind].model
      .find({
        status: 'verified',
        ...('year' in by ? { year: { $in: by.year } } : { gradYear: { $in: by.gradYear } }),
      } as never)
      .limit(50_000)
      .lean()) as unknown as (AnyDoc & { anonKey?: string | null })[];
    return rows.map((r) => ({
      ...(r as unknown as Fields),
      subject: r.userId ? String(r.userId) : (r.anonKey ?? String(r._id)),
      userId: r.userId ? String(r.userId) : null,
      branch: r.branch ?? null,
      gradYear: r.gradYear ?? null,
    }));
  }
}
