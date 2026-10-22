import { Types } from 'mongoose';
import type { AiUsageKind } from '@campuslink/shared';
import { AiUsageModel, type AiUsageDoc } from './ai-usage.model.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
/** Usage days are UTC dates, so a month's budget is the same for every server. */
export const usageDay = (d = new Date()) => d.toISOString().slice(0, 10);

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
 * Counts tokens per college, member, day, kind and model (step 3 records embeddings; the chatbot,
 * budgets and the admin dashboard build on it). Counters only: no text is ever stored here.
 */
export class AiUsageService {
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
  }

  /** Tokens used since a UTC day (inclusive), for budgets. */
  async tokensSince(day: string, userId?: string): Promise<number> {
    const rows = await AiUsageModel.find({
      day: { $gte: day },
      ...(userId ? { userId: oid(userId) } : {}),
    })
      .select('inputTokens outputTokens')
      .lean<Pick<AiUsageDoc, 'inputTokens' | 'outputTokens'>[]>();
    return rows.reduce((n, r) => n + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0);
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
