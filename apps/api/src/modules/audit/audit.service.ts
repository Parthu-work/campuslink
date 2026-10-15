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
