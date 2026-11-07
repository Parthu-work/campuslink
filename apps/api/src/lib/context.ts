import { AsyncLocalStorage } from 'node:async_hooks';
import { Types } from 'mongoose';

/**
 * Request-scoped context. Every database operation on a tenant-owned model reads the tenant
 * from here (see db/tenant-plugin.ts). Code never passes tenantId around by hand.
 */
export interface RequestContext {
  tenantId?: Types.ObjectId;
  /** Set only by withPlatformScope: lifts tenant filtering for a named, audited reason. */
  platformReason?: string;
  /**
   * Set only by `networkScope` (prompt 2, G12, ADR 0014 §6): the tenant-owned models this platform
   * scope may touch. Any other tenant model throws in the tenant plugin.
   */
  allowModels?: readonly string[];
}

const als = new AsyncLocalStorage<RequestContext>();

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantContextError';
  }
}

export const getContext = (): RequestContext | undefined => als.getStore();

/**
 * Runs `fn` with a tenant context and awaits its result INSIDE the context. Mongoose queries are
 * lazy thenables; returning one un-awaited would execute it after the context has ended.
 */
export function runInTenant<T>(tenantId: Types.ObjectId | string, fn: () => T): Promise<Awaited<T>> {
  return als.run(
    { tenantId: new Types.ObjectId(String(tenantId)) },
    async (): Promise<Awaited<T>> => await fn(),
  );
}

/**
 * The ONLY way to touch tenant-owned collections across tenants. Reasons are short constants
 * (e.g. 'platform:tenant-stats') so they can be grepped and reviewed.
 */
export function withPlatformScope<T>(reason: string, fn: () => T): Promise<Awaited<T>> {
  if (!/^[a-z]+:[a-z-]+$/.test(reason))
    throw new TenantContextError(`Invalid platform scope reason: ${reason}`);
  return als.run({ platformReason: reason }, async (): Promise<Awaited<T>> => await fn());
}

/**
 * A platform scope limited to named tenant models (prompt 2, G12): the cross-college network reads
 * only its opt-in projections. Called only from `lib/network-scope.ts`, which adds the closed list
 * of reasons and the audit.
 */
export function withScopedPlatform<T>(
  reason: string,
  allowModels: readonly string[],
  fn: () => T,
): Promise<Awaited<T>> {
  if (!/^[a-z]+:[a-z-]+$/.test(reason))
    throw new TenantContextError(`Invalid platform scope reason: ${reason}`);
  return als.run({ platformReason: reason, allowModels }, async (): Promise<Awaited<T>> => await fn());
}

/** Express middleware form: the rest of the request runs inside the tenant context. */
export function enterTenant(tenantId: Types.ObjectId, next: () => void): void {
  als.run({ tenantId }, next);
}

export function requireTenantId(): Types.ObjectId {
  const id = als.getStore()?.tenantId;
  if (!id) throw new TenantContextError('No tenant context');
  return id;
}
