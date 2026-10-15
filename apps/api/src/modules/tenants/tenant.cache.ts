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
export const invalidateTenant = (slug: string): void => void cache.delete(slug);
export const clearTenantCache = (): void => cache.clear();
