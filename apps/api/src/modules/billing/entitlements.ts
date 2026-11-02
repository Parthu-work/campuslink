import {
  FEATURE_KEYS,
  PLANS,
  allowanceStudents,
  mergeTerms,
  type Feature,
  type PlanId,
  type PlanTerms,
  type PlanTermsPatch,
} from '@campuslink/shared';
import { PlanSettingModel } from './billing.model.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';

/**
 * Entitlements (build B10): what a college's plan allows. Terms resolve as plan default ←
 * the platform owner's plan setting ← the college's custom deal. Feature switches (B1) apply only
 * when the plan includes them and the college has them on; the tenant cache resolves that once
 * per lookup, so routes, jobs, navigation and permissions all see the same answer.
 */
export type Meter = 'seats' | 'whatsapp' | 'aiTokens';

const TTL_MS = 30_000;
let cache: { at: number; value: Promise<Record<PlanId, PlanTerms>> } | null = null;

/** The plans as the platform owner set them (cached 30 s per process, like the tenant cache). */
export function planCatalogue(): Promise<Record<PlanId, PlanTerms>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = PlanSettingModel.find({})
    .lean<{ plan: PlanId; terms: PlanTermsPatch }[]>()
    .then((rows) => {
      const byPlan = new Map(rows.map((r) => [r.plan, r.terms]));
      return Object.fromEntries(
        (Object.keys(PLANS) as PlanId[]).map((id) => [id, mergeTerms(PLANS[id], byPlan.get(id))]),
      ) as Record<PlanId, PlanTerms>;
    });
  value.catch(() => (cache = null));
  cache = { at: Date.now(), value };
  return value;
}
export const invalidatePlans = (): void => {
  cache = null;
};

/** One college's terms: its plan's (an unknown plan counts as the pilot) ← its custom deal. */
export function termsOf(
  subscription: { plan?: string; terms?: PlanTermsPatch | null } | undefined,
  catalogue: Record<PlanId, PlanTerms>,
): PlanTerms {
  const plan = (subscription?.plan ?? 'pilot') as PlanId;
  return mergeTerms(catalogue[plan] ?? catalogue.pilot, subscription?.terms);
}

/** The switches that apply: the college chose them and its plan includes them. */
export function entitledFeatures(chosen: Record<Feature, boolean>, terms: PlanTerms | null) {
  if (!terms) return chosen;
  const allowed = new Set(terms.features);
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, chosen[k] && allowed.has(k)])) as Record<
    Feature,
    boolean
  >;
}

export class EntitlementsService {
  /** A feature switch, as it applies: the plan allows it and the college has it on. */
  can(tenant: TenantRecord, feature: Feature): boolean {
    return !!tenant.features[feature];
  }

  /** Whether the plan includes a feature, whatever the college chose. */
  planAllows(tenant: TenantRecord, feature: Feature): boolean {
    return !tenant.terms || tenant.terms.features.includes(feature);
  }

  /**
   * A meter's limit. Seats: the contracted number (never enforced: going over shows admins a
   * banner). WhatsApp and AI tokens: per student per month, for the students the plan is sized for.
   */
  limit(tenant: TenantRecord, meter: Meter): number {
    const terms = tenant.terms;
    const seats = tenant.subscription?.seats ?? 0;
    if (!terms) return 0;
    const students = allowanceStudents(terms, seats);
    if (meter === 'seats') return seats;
    if (meter === 'whatsapp') return students * terms.whatsappPerStudentMonthly;
    return students * terms.aiTokensPerStudentMonthly;
  }
}
