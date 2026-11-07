import type { RequestHandler } from 'express';
import { z } from 'zod';
import { credentialIdParams, credentialIssueBody, credentialKidParams } from '@campuslink/shared';
import type { AnyRouteSpec, HandlerResult } from '../../http/registry.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import { enterTenant } from '../../lib/context.js';
import { findTenantBySlug } from '../tenants/tenant.cache.js';
import { slugFromHost } from '../../http/tenant.middleware.js';
import type { CredentialsService } from './credentials.service.js';
import { credentialNotFoundHtml, verifyHtml } from './render.js';

const tag = 'Credentials';
const own = { kind: 'permission', permission: 'credentials:own' } as const;
const manage = { kind: 'permission', permission: 'credentials:manage' } as const;
const slug = z.string().regex(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/);
export const CREDENTIALS_PUBLIC_MODULE = 'credentials-public';

const PUBLIC_PATH =
  /^\/([a-z][a-z0-9-]{1,30}[a-z0-9])\/(verify\/[A-Za-z0-9_-]{22}(\.jwt)?|did\.json|credentials\/status\/1)$/;

/**
 * The three public credential routes take the college from the URL path (ADR 0014 §12, approved
 * under E7), so they match `did:web:<root>:<slug>`. On the root host the college comes from the
 * path; on a college's own host the path must name that same college. Read-only, colleges only.
 */
export const credentialTenantFromPath =
  (rootDomain: string): RequestHandler =>
  (req, _res, next) => {
    const m = PUBLIC_PATH.exec(req.path);
    if (!m || req.method !== 'GET') return next();
    const name = m[1] ?? '';
    // On a college's own host the path must name that same college; elsewhere nothing answers.
    const host = slugFromHost(req.hostname, rootDomain);
    if (host && host !== name) return next();
    void findTenantBySlug(name)
      .then((t) => {
        if (!t || t.kind !== 'college') return next();
        req.tenant = t;
        enterTenant(t._id, () => next());
      })
      .catch(next);
  };

const raw = (body: string, type: string, cache: string, status = 200): HandlerResult => ({
  status,
  data: null,
  raw: {
    body,
    headers: {
      'Content-Type': type,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  },
});

/** Members and the college (API prefix). */
export function credentialRoutes(s: CredentialsService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/credentials',
      tag,
      summary: 'My verified credentials and what I could have one for',
      access: own,
      handler: async ({ req }) => ({ data: await s.mine(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/credentials',
      tag,
      summary: 'Ask the college to sign a credential for a verified record (never for minors)',
      access: own,
      limiter: 'posting',
      idempotent: true,
      body: credentialIssueBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.issue(authOf(req), body, requestMeta(req)),
      }),
    },
    {
      method: 'delete',
      path: '/credentials/:id',
      tag,
      summary: 'Revoke one of my credentials (its page says so at once)',
      access: own,
      readOnlyOk: true,
      params: credentialIdParams,
      handler: async ({ req, params }) => ({
        data: await s.revokeMine(authOf(req), params.id, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/credentials',
      tag,
      summary: 'The college’s issuer keys and how many credentials are live',
      access: manage,
      handler: async () => ({ data: await s.adminView() }),
    },
    {
      method: 'post',
      path: '/admin/credentials/rotate',
      tag,
      summary: 'Rotate the signing key (old credentials keep verifying)',
      access: manage,
      limiter: 'adminWrite',
      handler: async ({ req }) => ({ data: await s.rotate(authOf(req), requestMeta(req)) }),
    },
    {
      method: 'post',
      path: '/admin/credentials/keys/:kid/compromised',
      tag,
      summary: 'Withdraw a leaked key and re-sign its live credentials with a new one',
      access: manage,
      limiter: 'adminWrite',
      params: credentialKidParams,
      handler: async ({ req, params }) => ({
        data: await s.compromised(authOf(req), params.kid, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/admin/credentials/:id/revoke',
      tag,
      summary: 'Revoke a credential',
      access: manage,
      limiter: 'adminWrite',
      params: credentialIdParams,
      handler: async ({ req, params }) => ({
        data: await s.revokeByAdmin(authOf(req), params.id, requestMeta(req)),
      }),
    },
  ];
}

/** The public pages: `/{tenant}/verify/{id}`, the DID document and the status list (outside the API prefix). */
export function credentialPublicRoutes(s: CredentialsService): AnyRouteSpec[] {
  const PUBLIC = { kind: 'public' } as const;
  return [
    {
      method: 'get',
      path: '/:slug/verify/:id',
      tag,
      summary: 'Check a credential: the claims, the signature and whether it was revoked',
      access: PUBLIC,
      limiter: 'verifyPublic',
      params: z.strictObject({ slug, id: z.string().regex(/^[A-Za-z0-9_-]{22}(\.jwt)?$/) }),
      handler: async ({ req, params }) => {
        const t = tenantOf(req);
        const asJwt = params.id.endsWith('.jwt');
        const id = asJwt ? params.id.slice(0, -4) : params.id;
        const v = await s.verify(t, id);
        if (!v.found) return raw(credentialNotFoundHtml(), 'text/html; charset=utf-8', 'no-store', 404);
        if (asJwt) {
          if (!v.jwt) return raw('Not found', 'text/plain; charset=utf-8', 'no-store', 404);
          return raw(v.jwt, 'application/vc+jwt', 'no-store');
        }
        return raw(
          verifyHtml(v, `${s.verifyUrl(t.slug, id)}.jwt`, `${s.base(t.slug)}/did.json`),
          'text/html; charset=utf-8',
          'no-store',
        );
      },
    },
    {
      method: 'get',
      path: '/:slug/did.json',
      tag,
      summary: 'The college’s DID document (did:web): its credential signing keys',
      access: PUBLIC,
      limiter: 'verifyPublic',
      params: z.strictObject({ slug }),
      handler: async ({ req }) =>
        raw(
          JSON.stringify(await s.didDocument(tenantOf(req))),
          'application/did+json',
          'public, max-age=300',
        ),
    },
    {
      method: 'get',
      path: '/:slug/credentials/status/1',
      tag,
      summary: 'The college’s revocation list (W3C Bitstring Status List, signed)',
      access: PUBLIC,
      limiter: 'verifyPublic',
      params: z.strictObject({ slug }),
      handler: async ({ req }) =>
        raw(await s.statusList(tenantOf(req)), 'application/vc+jwt', 'public, max-age=300'),
    },
  ];
}
