# ADR 0006: Authorize before validating; edge-level operator rejection

- Status: accepted
- Date: 2026-10-15

## Context

The spec sketches the request flow as `validate → authenticate → authorize`. We also planned to use Mongoose's global `sanitizeFilter` against NoSQL injection.

## Decisions

1. **Order:** `rate limit → tenant scope → CSRF → authenticate → authorize → validate (Zod) → handler`.
   - Unauthorised callers learn nothing about payload shape.
   - Rejection is cheaper, because nothing is parsed before the caller is known.
   - The permission matrix test can tell "forbidden" (403) from "allowed but bad input" (400) for every route.
2. **NoSQL injection:** there are three layers.
   - (a) Zod strict schemas accept only primitives and reject unknown keys.
   - (b) `middleware/no-operators.ts` rejects any `$`-prefixed, dotted or prototype keys in request bodies and query strings.
   - (c) `strictQuery` is on.

   Global `sanitizeFilter` was dropped: it rewrites the server's own operators (`$gt`, `$ne`, `$pull`), so every query would need a `trusted()` wrapper.

3. **Text search** goes only through `db/search.ts`, which builds the `$text` clause server-side.

## Consequences

Validation errors are only visible to authorised users. `test/auth.test.ts` and `test/isolation/plugin.test.ts` cover the injection defences.
