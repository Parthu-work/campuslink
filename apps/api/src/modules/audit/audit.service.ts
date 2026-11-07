import { Types } from 'mongoose';
import { AuditModel } from './audit.model.js';
import { runInTenant } from '../../lib/context.js';

export interface AuditInput {
  action: string;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, string | number | boolean | null | string[]>;
}
export interface RequestMetaLite {
  requestId?: string | null;
  ipPrefix?: string | null;
}

/** Append-only audit trail; writes into the current tenant context. */
export const audit = {
  async record(input: AuditInput, req: RequestMetaLite = {}): Promise<void> {
    await AuditModel.create({
      action: input.action,
      actorId: input.actorId ? new Types.ObjectId(input.actorId) : null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      meta: input.meta ?? {},
      requestId: req.requestId ?? null,
      ipPrefix: req.ipPrefix ?? null,
    });
  },
  /** Mirror a platform action into the affected college's own log (transparency for the college). */
  async recordInTenant(
    tenantId: Types.ObjectId | string,
    input: AuditInput,
    req: RequestMetaLite = {},
  ): Promise<void> {
    await runInTenant(tenantId, () => audit.record(input, req));
  },
  /**
   * Prompt 2, G12: how often each network path touched this college since `since` (Admin › Network,
   * "who looked"). `external`: only rows written for another tenant's request (they carry `meta.by`).
   */
  async countByPrefix(prefix: string, since: Date, opts: { external?: boolean } = {}) {
    const rows = await AuditModel.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          action: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` },
          createdAt: { $gte: since },
          ...(opts.external ? { 'meta.by': { $exists: true } } : {}),
        },
      },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    return rows.map((r) => ({ reason: r._id, count: r.count }));
  },
  /** Prompt 2, G12: audit rows about given targets (a member's candidacies: who opened them). */
  async aboutTargets(actions: string[], targetType: string, targetIds: string[], limit = 50) {
    if (!targetIds.length) return [];
    return AuditModel.find({ action: { $in: actions }, targetType, targetId: { $in: targetIds } })
      .sort({ _id: -1 })
      .limit(limit)
      .select('action targetId meta createdAt')
      .lean<{ action: string; targetId: string; meta: Record<string, unknown>; createdAt: Date }[]>();
  },
  async list(opts: { cursor?: string; limit: number; action?: string }) {
    const filter: Record<string, unknown> = {};
    if (opts.cursor) filter._id = { $lt: new Types.ObjectId(opts.cursor) };
    if (opts.action) filter.action = opts.action;
    const rows = await AuditModel.find(filter)
      .sort({ _id: -1 })
      .limit(opts.limit + 1)
      .lean();
    const page = rows.slice(0, opts.limit);
    return { items: page, nextCursor: rows.length > opts.limit ? String(page.at(-1)?._id) : null };
  },
};
