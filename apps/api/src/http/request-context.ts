import type { Request } from 'express';
import type { AuthState } from '../types.js';
import type { TenantRecord } from '../modules/tenants/tenant.cache.js';

/** For handlers behind `authenticate`; throws (500) if the pipeline was misconfigured. */
export function authOf(req: Request): AuthState {
  if (!req.auth) throw new Error('authOf() used on a route without authentication');
  return req.auth;
}
/** For handlers behind `requireScope`; throws (500) if the pipeline was misconfigured. */
export function tenantOf(req: Request): TenantRecord {
  if (!req.tenant) throw new Error('tenantOf() used on a route without tenant scope');
  return req.tenant;
}
