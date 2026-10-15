# ADR 0001: Modular monolith in a pnpm monorepo

- Status: accepted
- Date: 2026-10-15

## Context

The target is 500 to 1,000 users per college, with many colleges on one deployment, built by a small team on free tooling. Microservices would add network hops, distributed transactions and operational cost without a matching benefit at this scale.

## Decision

- One Express API process split into feature modules (`auth`, `tenants`, `feed`, …). Each module has routes, controller, service, repository, schemas and tests.
- BullMQ workers run from the same codebase as a separate process entry point, so ingestion and import load never blocks request latency.
- pnpm workspaces plus Turborepo: `apps/web`, `apps/api`, `packages/shared`.

## Consequences

- Simple deploys and refactors; a single test run covers the whole system.
- Module boundaries are a code-review and lint concern, not a network boundary. Cross-module calls go through services only.
- If one module later needs independent scaling (for example, realtime), it can be extracted along its existing boundary.
