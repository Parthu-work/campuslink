import { Types } from 'mongoose';
import type { AiUsageKind } from '@campuslink/shared';
import { AiUsageModel, type AiUsageDoc } from './ai-usage.model.js';
import { requireTenantId } from '../../lib/context.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
/** Usage days are UTC dates, so a month's budget is the same for every server. */
export const usageDay = (d = new Date()) => d.toISOString().slice(0, 10);
/** The first UTC day of the month (`YYYY-MM-01`). */
export const monthStart = (d = new Date()) => `${d.toISOString().slice(0, 7)}-01`;
/** UTC midnight on the 1st of the next month, when the month's budget starts again. */
export const nextMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
/** How long the month's total is reused before it is counted again (other servers' answers). */
const MONTH_CACHE_MS = 15_000;

export interface UsageTotals {
  day: string;
  kind: AiUsageKind;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageEntry {
  kind: AiUsageKind;
  /** `provider:model`. */
  model: string;
  /** The member it was for; null for background work (embeddings, transcripts). */
  userId: string | null;
  inputTokens: number;
  outputTokens?: number;
}

/**
 * Counts tokens per college, member, day, kind and model: the monthly budget, the per-member daily
 * limit and the admin dashboard read these. Counters only: no text is ever stored here, and the
 * dashboard sees college totals, never a member's own usage.
 */
export class AiUsageService {
  /** The month's token total per college, kept briefly so budget checks stay cheap. */
  private readonly month = new Map<string, { month: string; at: number; tokens: number }>();

  async record(e: UsageEntry) {
    const tokens = (n: number | undefined) => (Number.isFinite(n) && (n ?? 0) > 0 ? Math.round(n ?? 0) : 0);
    await AiUsageModel.updateOne(
      {
        day: usageDay(),
        userId: e.userId ? oid(e.userId) : null,
        kind: e.kind,
        model: e.model.slice(0, 160),
      },
      { $inc: { requests: 1, inputTokens: tokens(e.inputTokens), outputTokens: tokens(e.outputTokens) } },
      { upsert: true },
    );
    const cached = this.month.get(String(requireTenantId()));
    if (cached) cached.tokens += tokens(e.inputTokens) + tokens(e.outputTokens);
  }

  /** Tokens the college used this calendar month (UTC), for the monthly budget. */
  async monthTokens(now = new Date()): Promise<number> {
    const key = String(requireTenantId());
    const month = monthStart(now);
    const hit = this.month.get(key);
    if (hit && hit.month === month && now.getTime() - hit.at < MONTH_CACHE_MS) return hit.tokens;
    const [row] = await AiUsageModel.aggregate<{ tokens: number }>([
      { $match: { day: { $gte: month } } },
      { $group: { _id: null, tokens: { $sum: { $add: ['$inputTokens', '$outputTokens'] } } } },
    ]);
    const tokens = row?.tokens ?? 0;
    if (this.month.size > 5000) this.month.clear();
    this.month.set(key, { month, at: now.getTime(), tokens });
    return tokens;
  }

  /** Model requests of one kind a member made today (the per-member daily limit). */
  async requestsToday(userId: string, kind: AiUsageKind): Promise<number> {
    const [row] = await AiUsageModel.aggregate<{ n: number }>([
      { $match: { day: usageDay(), userId: oid(userId), kind } },
      { $group: { _id: null, n: { $sum: '$requests' } } },
    ]);
    return row?.n ?? 0;
  }

  /** College totals per day, kind and model since a UTC day (never per member). */
  async totalsSince(day: string): Promise<UsageTotals[]> {
    return AiUsageModel.aggregate<UsageTotals>([
      { $match: { day: { $gte: day } } },
      {
        $group: {
          _id: { day: '$day', kind: '$kind', model: '$model' },
          requests: { $sum: '$requests' },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
        },
      },
      {
        $project: {
          _id: 0,
          day: '$_id.day',
          kind: '$_id.kind',
          model: '$_id.model',
          requests: 1,
          inputTokens: 1,
          outputTokens: 1,
        },
      },
      { $sort: { day: 1 } },
    ]);
  }

  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    const rows = await AiUsageModel.find({ userId: oid(userId) })
      .select('day kind requests inputTokens outputTokens')
      .sort({ day: 1 })
      .lean<AiUsageDoc[]>();
    return rows.map((r) => ({
      day: r.day,
      kind: r.kind,
      requests: r.requests,
      tokens: (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
    }));
  }

  /** The member's counters fold into the college's anonymous ones, so the month's budget stays true. */
  async eraseFor(userId: string) {
    const rows = await AiUsageModel.find({ userId: oid(userId) }).lean<AiUsageDoc[]>();
    for (const r of rows) {
      await AiUsageModel.updateOne(
        { day: r.day, userId: null, kind: r.kind, model: r.model },
        {
          $inc: {
            requests: r.requests ?? 0,
            inputTokens: r.inputTokens ?? 0,
            outputTokens: r.outputTokens ?? 0,
          },
        },
        { upsert: true },
      );
      await AiUsageModel.deleteOne({ _id: r._id });
    }
  }
}
