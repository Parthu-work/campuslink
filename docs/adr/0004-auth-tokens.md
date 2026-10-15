# ADR 0004: Short-lived access JWT plus rotating refresh cookie

- Status: accepted (implemented in Phase 1)
- Date: 2026-10-15

## Decision

- **Access token:** a JWT that lives 15 minutes and is held only in memory on the client (never in localStorage). Claims: `sub`, `tid` (tenant), `roles`, `sid` (session id), `ver`.
- **Refresh token:** an opaque random value of 256 bits. It is sent as an `httpOnly; Secure; SameSite=Lax` cookie scoped to `/api/v1/auth`, with a separate cookie per tenant subdomain. Only its SHA-256 hash is stored, in a token family.
- **Rotation:** every refresh issues a new token and marks the old one used. **Reuse of a used token revokes the whole family** (theft detection) and is audit-logged.
- **CSRF:** a double-submit token (`X-CSRF-Token`) on cookie-authenticated endpoints, plus an Origin check against the allowlist.
- **Revocation:** logout, password change and admin suspension revoke sessions. A `ver` counter on the user invalidates outstanding access tokens.
