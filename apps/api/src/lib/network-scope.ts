import { Types } from 'mongoose';
import { NETWORK_PATHS, type NetworkPath } from '@campuslink/shared';
import { runInTenant, withScopedPlatform, TenantContextError } from './context.js';
import { audit, type RequestMetaLite } from '../modules/audit/audit.service.js';

/**
 * The only way member data crosses a college (prompt 2, G12, ADR 0014 §5 and §6).
 *
 * - `networkScope(reason, actor, fn, touched)`: a platform scope that may touch only the models
 *   listed for its reason (the tenant plugin throws on any other), followed by audit rows in the
 *   actor's tenant and in every tenant whose data it returned or changed.
 * - `networkInTenant(reason, actor, tenantId, fn, target)`: runs another college's own service in
 *   that college's context (readiness, a résumé, a report), audited the same way.
 *
 * Reasons come only from the closed list NETWORK_PATHS; the audit write is awaited, so a failed
 * audit fails the request (N15).
 */

/** The tenant-owned models each scoped path may touch (N13). */
export const NETWORK_PATH_MODELS: Readonly<Record<ScopedPath, readonly string[]>> = {
  'network:alumni-search': ['NetworkProfile'],
  'network:alumni-card': ['NetworkProfile'],
  'network:intro-send': ['NetworkProfile', 'NetworkIntro'],
  'network:intro-reply': ['NetworkIntroOut', 'NetworkIntro'],
  'network:intro-expire': ['NetworkIntro', 'NetworkIntroOut'],
  'network:pool-size': ['NetworkProfile'],
  'network:posting-offer': ['PostingOffer'],
  'network:posting-decision': ['Posting', 'BillableEvent'],
  'network:posting-withdraw': ['PostingOffer'],
  'network:candidates': ['NetworkCandidacy'],
  'network:shortlist': ['NetworkCandidacy'],
  'network:hire-billing': ['BillableEvent'],
  'network:employer-review': ['User'],
  'network:revenue-statement': ['BillableEvent'],
};
/** Paths that run another college's own service in its own context. */
export const IN_TENANT_PATHS = [
  'network:intro-report',
  'network:candidate-resume',
  'network:candidate-readiness',
] as const;
type InTenantPath = (typeof IN_TENANT_PATHS)[number];
type ScopedPath = Exclude<NetworkPath, InTenantPath>;

export interface NetworkActor {
  tenantId: string;
  kind: 'college' | 'employer' | 'platform' | 'job';
  userId: string | null;
  meta?: RequestMetaLite;
}
/** A tenant whose data a path returned or changed, for its audit row. */
export interface Touch {
  tenantId: string;
  count: number;
  targetType?: string;
  targetId?: string;
}

const isScoped = (r: string): r is ScopedPath => r in NETWORK_PATH_MODELS;
const action = (reason: NetworkPath) => `network.${reason.slice('network:'.length)}`;

async function auditBoth(reason: NetworkPath, actor: NetworkActor, touches: Touch[]): Promise<void> {
  const total = touches.reduce((n, t) => n + t.count, 0);
  if (actor.kind !== 'job')
    await audit.recordInTenant(
      actor.tenantId,
      // The actor's side never names a member of another college: counts and colleges only.
      {
        action: action(reason),
        actorId: actor.userId,
        meta: { count: total, tenants: touches.length },
      },
      actor.meta ?? {},
    );
  for (const t of touches) {
    if (t.tenantId === actor.tenantId && actor.kind !== 'job') continue;
    await audit.recordInTenant(t.tenantId, {
      action: action(reason),
      actorId: null,
      ...(t.targetType ? { targetType: t.targetType } : {}),
      ...(t.targetId ? { targetId: t.targetId } : {}),
      meta: { by: actor.tenantId, byKind: actor.kind, count: t.count },
    });
  }
}

export async function networkScope<T>(
  reason: NetworkPath,
  actor: NetworkActor,
  fn: () => Promise<T>,
  touched: (result: T) => Touch[],
): Promise<T> {
  if (!(NETWORK_PATHS as readonly string[]).includes(reason) || !isScoped(reason))
    throw new TenantContextError(`Unknown network path: ${reason}`);
  const result = await withScopedPlatform(reason, NETWORK_PATH_MODELS[reason], fn);
  await auditBoth(reason, actor, touched(result as T));
  return result as T;
}

export async function networkInTenant<T>(
  reason: NetworkPath,
  actor: NetworkActor,
  tenantId: string | Types.ObjectId,
  fn: () => Promise<T>,
  target: { targetType: string; targetId: string } | null = null,
): Promise<T> {
  if (!(IN_TENANT_PATHS as readonly string[]).includes(reason))
    throw new TenantContextError(`Unknown in-tenant network path: ${reason}`);
  const result = await runInTenant(new Types.ObjectId(String(tenantId)), fn);
  await auditBoth(reason, actor, [{ tenantId: String(tenantId), count: 1, ...(target ?? {}) }]);
  return result as T;
}
