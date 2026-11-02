import type { RequestHandler } from 'express';
import type { Types } from 'mongoose';
import { ErrorCode, type Feature } from '@campuslink/shared';
import { requireTenantId } from '../../lib/context.js';
import { AppError, featureDisabled } from '../../lib/errors.js';
import type { AnyRouteSpec } from '../../http/registry.js';
import type { JobHandler } from '../../lib/jobs.js';
import { findTenantById } from './tenant.cache.js';

/**
 * Feature switches (B1). Routes declare `feature` on their spec (or a whole module through
 * `withFeature`); services check content-level switches (a reel inside the feed) with
 * `featureEnabled`; background jobs of a switched-off feature do nothing (`gatedJob`).
 */
export async function featureEnabled(
  feature: Feature,
  tenantId: Types.ObjectId | string = requireTenantId(),
): Promise<boolean> {
  const tenant = await findTenantById(tenantId);
  return !!tenant && tenant.features[feature];
}

export async function requireFeature(feature: Feature): Promise<void> {
  if (!(await featureEnabled(feature))) throw featureDisabled(feature);
}

/** Pipeline step after tenant scope: the college must have the route's feature on. */
export function featureGate(feature: Feature): RequestHandler {
  return (req, _res, next) => {
    if (req.tenant && req.tenant.features[feature] === false) return next(featureDisabled(feature));
    next();
  };
}

/**
 * Pipeline step for writes (B10): a college whose invoice is 30 days overdue is read-only. Reads
 * and exports keep working and nothing is deleted; routes marked `readOnlyOk` still accept writes.
 */
const readOnly = () =>
  new AppError(
    403,
    ErrorCode.READ_ONLY,
    'Your college’s account is read-only until an overdue invoice is paid. Everything is still here to read and export.',
  );
export const readOnlyGate: RequestHandler = (req, _res, next) => {
  if (req.tenant?.billing?.readOnlyAt) return next(readOnly());
  next();
};

/** For writes inside an allowed route (a phone code that would create an account). */
export async function assertWritable(tenantId: Types.ObjectId | string = requireTenantId()): Promise<void> {
  if ((await findTenantById(tenantId))?.billing?.readOnlyAt) throw readOnly();
}

/** Marks every route of a module as part of a feature (unless a route names its own). */
export const withFeature = (feature: Feature, specs: AnyRouteSpec[]): AnyRouteSpec[] =>
  specs.map((s) => ({ feature, ...s }));

/** A job handler that does nothing while its college has the feature off. */
export const gatedJob =
  (feature: Feature, handler: JobHandler): JobHandler =>
  async (data, progress) => {
    if (await featureEnabled(feature, data.tenantId)) await handler(data, progress);
  };
