# ADR 0002: Shared database, tenantId column, automatic enforcement

- Status: accepted
- Date: 2026-10-15

## Context

Many colleges on one deployment. Options: a database per tenant, a collection prefix per tenant, or a shared collection with `tenantId`.

## Decision

Use shared collections with `tenantId` on every tenant-owned document, enforced centrally:

1. Middleware resolves the tenant from the subdomain and checks that it equals the JWT `tid` claim.
2. The tenant is stored in AsyncLocalStorage for the life of the request, job or socket event.
3. A global Mongoose plugin injects `tenantId` into every query, update, delete and aggregate (`$match` prepended), and stamps it on create and `insertMany`. **With no tenant context, it throws.**
4. Platform-wide code runs inside an explicit `withPlatformScope(reason, fn)`, which is audit-logged.
5. Every compound index starts with `tenantId`.

## Consequences

- One connection pool and simple operations; the design scales to hundreds of tenants.
- A plugin bug would be catastrophic, so mandatory cross-tenant test suites (read, write, update, delete, search, socket, file) block CI.
- Raw driver access (`Model.collection`, `mongoose.connection.db`) bypasses the plugin. It is banned by lint rule outside `withPlatformScope`.
- Large tenants that need physical isolation later can move to a dedicated database with the same code.
