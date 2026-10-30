import { Types } from 'mongoose';
import type { AcademicFacts, AcademicRecordView } from '@campuslink/shared';
import { AcademicRecordModel, type AcademicRecordDoc } from './placements.model.js';
import type { WhitelistService } from '../imports/whitelist.service.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { AuthState } from '../../types.js';

export interface AcademicRow {
  rollNumber: string;
  cgpa: number | null;
  activeBacklogs: number | null;
  historyBacklogs: number | null;
  tenthPct: number | null;
  twelfthPct: number | null;
  diplomaPct: number | null;
}

const view = (r: AcademicRecordDoc): AcademicRecordView => ({
  cgpa: r.cgpa ?? null,
  activeBacklogs: r.activeBacklogs ?? null,
  historyBacklogs: r.historyBacklogs ?? null,
  tenthPct: r.tenthPct ?? null,
  twelfthPct: r.twelfthPct ?? null,
  diplomaPct: r.diplomaPct ?? null,
  source: r.source as AcademicRecordView['source'],
  verified: !!r.verifiedAt,
  updatedAt: r.updatedAt.toISOString(),
});
const facts = (r: AcademicRecordDoc): AcademicFacts => ({
  cgpa: r.cgpa ?? null,
  activeBacklogs: r.activeBacklogs ?? null,
  historyBacklogs: r.historyBacklogs ?? null,
  tenthPct: r.tenthPct ?? null,
  twelfthPct: r.twelfthPct ?? null,
  diplomaPct: r.diplomaPct ?? null,
  source: r.source as AcademicFacts['source'],
  verified: !!r.verifiedAt,
});

/**
 * Academic records for placement eligibility (B7). The college imports them (import type
 * `academics`, keyed by roll number) or a student reports their own, which the placement cell
 * verifies before it counts.
 */
export class AcademicsService {
  constructor(private readonly d: { whitelist: WhitelistService }) {}

  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    const roll = (await this.d.whitelist.recordsOf([userId])).get(userId)?.rollNumber;
    return roll ? AcademicRecordModel.findOne({ rollNumber: roll }).lean() : null;
  }

  /** A self-reported record goes; the college's own (imported) record stays, unlinked. */
  async eraseFor(userId: string) {
    const u = new Types.ObjectId(userId);
    await AcademicRecordModel.deleteMany({ userId: u, source: 'self' });
    await AcademicRecordModel.updateMany({ userId: u }, { $set: { userId: null } });
  }

  /** Records for eligibility, by member id (through their roll number). */
  async factsFor(userIds: string[]): Promise<Map<string, AcademicFacts>> {
    const rolls = await this.d.whitelist.recordsOf(userIds);
    const byRoll = new Map(
      (
        await AcademicRecordModel.find({
          rollNumber: { $in: [...rolls.values()].map((r) => r.rollNumber) },
        }).lean<AcademicRecordDoc[]>()
      ).map((r) => [r.rollNumber, r]),
    );
    const out = new Map<string, AcademicFacts>();
    for (const [userId, r] of rolls) {
      const rec = byRoll.get(r.rollNumber);
      if (rec) out.set(userId, facts(rec));
    }
    return out;
  }

  /** Full records (export columns), by member id. */
  async recordsFor(userIds: string[]): Promise<Map<string, AcademicRecordDoc>> {
    const rolls = await this.d.whitelist.recordsOf(userIds);
    const byRoll = new Map(
      (
        await AcademicRecordModel.find({
          rollNumber: { $in: [...rolls.values()].map((r) => r.rollNumber) },
        }).lean<AcademicRecordDoc[]>()
      ).map((r) => [r.rollNumber, r]),
    );
    return new Map(
      [...rolls].flatMap(([userId, r]) => {
        const rec = byRoll.get(r.rollNumber);
        return rec ? [[userId, rec] as const] : [];
      }),
    );
  }

  async mine(viewer: AuthState): Promise<AcademicRecordView | null> {
    const r = (await this.recordsFor([viewer.userId])).get(viewer.userId);
    return r ? view(r) : null;
  }

  /** A student reports their own figures; they count once the placement cell verifies them. */
  async selfReport(viewer: AuthState, body: Omit<AcademicRow, 'rollNumber'>, meta: RequestMetaLite) {
    const roll = (await this.d.whitelist.recordsOf([viewer.userId])).get(viewer.userId)?.rollNumber;
    if (!roll) throw badRequest('Confirm your college record (roll number) first');
    const existing = await AcademicRecordModel.findOne({ rollNumber: roll }).lean();
    if (existing && existing.source !== 'self')
      throw conflict('Your college already has your academic record. Ask the placement cell to correct it.');
    const doc = await AcademicRecordModel.findOneAndUpdate(
      { rollNumber: roll },
      {
        $set: {
          ...body,
          userId: new Types.ObjectId(viewer.userId),
          source: 'self',
          verifiedBy: null,
          verifiedAt: null,
        },
      },
      { upsert: true, returnDocument: 'after' },
    ).lean<AcademicRecordDoc>();
    await audit.record(
      {
        action: 'placements.academics_reported',
        actorId: viewer.userId,
        targetType: 'user',
        targetId: viewer.userId,
      },
      meta,
    );
    return view(doc as AcademicRecordDoc);
  }

  /** Self-reported records waiting for the placement cell. */
  async pending() {
    const rows = await AcademicRecordModel.find({ source: 'self', verifiedAt: null })
      .sort({ _id: 1 })
      .limit(200)
      .lean<AcademicRecordDoc[]>();
    return rows.map((r) => ({ id: String(r._id), rollNumber: r.rollNumber, ...view(r) }));
  }

  async verify(actorId: string, id: string, decision: 'verify' | 'reject', meta: RequestMetaLite) {
    const r = await AcademicRecordModel.findOne({ _id: id, source: 'self' }).lean();
    if (!r) throw notFound('Academic record');
    if (decision === 'verify')
      await AcademicRecordModel.updateOne(
        { _id: id },
        { $set: { verifiedBy: new Types.ObjectId(actorId), verifiedAt: new Date() } },
      );
    else await AcademicRecordModel.deleteOne({ _id: id });
    await audit.record(
      {
        action: decision === 'verify' ? 'placements.academics_verified' : 'placements.academics_rejected',
        actorId,
        targetType: 'academic_record',
        targetId: id,
      },
      meta,
    );
    return { decided: decision };
  }

  /**
   * The imports wizard's `academics` type: one row per roll number, trusted (imported). Returns
   * what changed so the import can report it; a self-reported record is replaced by the college's.
   */
  async importRow(row: AcademicRow): Promise<'created' | 'updated' | 'unchanged'> {
    const { rollNumber, ...fields } = row;
    const before = await AcademicRecordModel.findOne({ rollNumber }).lean();
    const same =
      before &&
      before.source !== 'self' &&
      (Object.keys(fields) as (keyof typeof fields)[]).every((k) => (before[k] ?? null) === fields[k]);
    if (same) return 'unchanged';
    await AcademicRecordModel.updateOne(
      { rollNumber },
      { $set: { ...fields, source: 'import', verifiedAt: new Date(), verifiedBy: null } },
      { upsert: true },
    );
    return before ? 'updated' : 'created';
  }
}
