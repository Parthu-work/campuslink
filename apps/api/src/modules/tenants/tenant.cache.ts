import type { Types } from 'mongoose';
import type { PermissionOverrides, Branding, Feature } from '@campuslink/shared';
import { TenantModel } from './tenant.model.js';

export interface TenantRecord {
  _id: Types.ObjectId;
  slug: string;
  kind: 'college' | 'platform';
  status: 'active' | 'suspended';
  branding: Branding;
  features: Record<Feature, boolean>;
  allowedEmailDomains: string[];
  limits: { mentorshipRequestsPerWeek: number; referralRequestsPerWeek: number };
  permissionOverrides: PermissionOverrides;
  retention?: { inactiveAccountDays: number; deletedAccountGraceDays: number };
}

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: TenantRecord | null }>();

/** Small read-through cache; host → tenant lookups happen on every request. */
export async function findTenantBySlug(slug: string): Promise<TenantRecord | null> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const doc = await TenantModel.findOne({ slug }).lean<TenantRecord>();
  cache.set(slug, { at: Date.now(), value: doc });
  return doc;
}

/** Lookup by id (background jobs know the tenant id, not the host). Shares the slug cache. */
export async function findTenantById(id: Types.ObjectId | string): Promise<TenantRecord | null> {
  for (const v of cache.values())
    if (v.value && String(v.value._id) === String(id) && Date.now() - v.at < TTL_MS) return v.value;
  const doc = await TenantModel.findById(id).lean<TenantRecord>();
  if (doc) cache.set(doc.slug, { at: Date.now(), value: doc });
  return doc;
}

/** Cross-instance invalidation (Redis pub/sub). Without it, other instances refresh within TTL_MS. */
let publish: ((slug: string) => void) | null = null;
export function connectTenantCacheBus(bus: {
  publish: (slug: string) => void;
  subscribe: (onSlug: (slug: string) => void) => void;
}): void {
  publish = bus.publish;
  bus.subscribe((slug) => cache.delete(slug));
}
export const invalidateTenant = (slug: string): void => {
  cache.delete(slug);
  publish?.(slug);
};
export const clearTenantCache = (): void => cache.clear();
