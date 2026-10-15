# ADR 0003: Pin TypeScript ~6.0 rather than 7.0

- Status: accepted
- Date: 2026-10-15

## Context

TypeScript 7.0 (the native compiler) is the latest stable release. typescript-eslint 8.71, the latest release, declares `typescript >=4.8.4 <6.1.0` as its peer range. Type-aware lint rules are part of our security posture (for example, `no-floating-promises`).

## Decision

Pin `typescript@~6.0.3` across the workspace. Revisit when typescript-eslint supports 7.x.

## Consequences

Slower type checks than 7.0. The migration should be mechanical, because 6.0 was designed as the bridge release.
