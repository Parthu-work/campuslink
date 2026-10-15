import type { RequestHandler } from 'express';
import { enterTenant } from '../lib/context.js';
import { findTenantBySlug } from '../modules/tenants/tenant.cache.js';

const LABEL = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

/** `dpit.localhost` → `dpit`. Only a single label directly under the root domain is a tenant. */
export function slugFromHost(hostname: string | undefined, rootDomain: string): string | null {
  if (!hostname) return null;
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const suffix = '.' + rootDomain.toLowerCase();
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  return LABEL.test(label) ? label : null;
}

/**
 * Resolves the tenant from the subdomain and opens the AsyncLocalStorage tenant context for the
 * rest of the request. Requests on the bare root domain carry no tenant (and no DB access).
 */
export function tenantResolver(rootDomain: string): RequestHandler {
  return async (req, _res, next) => {
    const slug = slugFromHost(req.hostname, rootDomain);
    const tenant = slug ? await findTenantBySlug(slug) : null;
    if (!tenant) return next();
    req.tenant = tenant;
    enterTenant(tenant._id, () => next());
  };
}
