import type { Types } from 'mongoose';
import {
  resolveFeatures,
  type PermissionOverrides,
  type Branding,
  type Feature,
  type GstStateCode,
  type PlanId,
  type PlanTerms,
  type PlanTermsPatch,
} from '@campuslink/shared';
import { TenantModel } from './tenant.model.js';
import { entitledFeatures, planCatalogue, termsOf } from '../billing/entitlements.js';

export interface TenantRecord {
  _id: Types.ObjectId;
  slug: string;
  kind: 'college' | 'platform';
  status: 'active' | 'suspended';
  branding: Branding;
  logo?: { fileId: Types.ObjectId | null };
  /** The switches that apply: the college has them on and its plan includes them (B10). */
  features: Record<Feature, boolean>;
  /** What the college chose in Admin › Features, plan aside (set by the cache). */
  chosenFeatures?: Record<Feature, boolean>;
  /** The plan terms that apply to a college (B10); null for the platform (set by the cache). */
  terms?: PlanTerms | null;
  subscription?: {
    plan: PlanId;
    seats: number;
    startedOn: Date | null;
    renewalDate: Date | null;
    terms: PlanTermsPatch | null;
  };
  billing?: {
    buyer: { legalName: string; address: string; gstin: string | null; stateCode: GstStateCode } | null;
    seatsUsed: number | null;
    seatsCountedAt: Date | null;
    readOnlyAt: Date | null;
  };
  allowedEmailDomains: string[];
  limits: { mentorshipRequestsPerWeek: number; referralRequestsPerWeek: number };
  permissionOverrides: PermissionOverrides;
  retention?: { inactiveAccountDays: number; deletedAccountGraceDays: number };
}

const TTL_MS = 30_000;

/**
 * Lean reads skip schema defaults: every switch gets a value (stored, else what it was before B1),
 * and a college's switches apply only where its plan allows them (B10).
 */
async function normalise(doc: TenantRecord | null): Promise<TenantRecord | null> {
  if (!doc) return null;
  const chosen = resolveFeatures(doc.features);
  const terms = doc.kind === 'college' ? termsOf(doc.subscription, await planCatalogue()) : null;
  return { ...doc, features: entitledFeatures(chosen, terms), chosenFeatures: chosen, terms };
}
const cache = new Map<string, { at: number; value: TenantRecord | null }>();

/** Small read-through cache; host → tenant lookups happen on every request. */
export async function findTenantBySlug(slug: string): Promise<TenantRecord | null> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const doc = await normalise(await TenantModel.findOne({ slug }).lean<TenantRecord>());
  cache.set(slug, { at: Date.now(), value: doc });
  return doc;
}

/** Lookup by id (background jobs know the tenant id, not the host). Shares the slug cache. */
export async function findTenantById(id: Types.ObjectId | string): Promise<TenantRecord | null> {
  for (const v of cache.values())
    if (v.value && String(v.value._id) === String(id) && Date.now() - v.at < TTL_MS) return v.value;
  const doc = await normalise(await TenantModel.findById(id).lean<TenantRecord>());
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
