# Phase 1: Secure core

## Plan

1. **Tenancy:** AsyncLocalStorage request context, a global Mongoose plugin that injects and stamps `tenantId` and throws without context, `withPlatformScope()` for named super-admin paths, tenant resolution from the `Host` subdomain, and a token `tid` check.
2. **Auth:** argon2id; signup with consent and an 18+ declaration; email verification; login with throttling and lockout; a 15-minute access JWT (`jose`); an opaque rotating refresh cookie with family reuse detection; logout; sessions and devices with revoke; password reset; TOTP 2FA (mandatory for admin roles); a HIBP k-anonymity check that fails open; password strength via zxcvbn-ts.
3. **RBAC:** a permission catalogue and role-to-permission map in `packages/shared`, tenant-level overrides, a `CERTIFIED_CONTRIBUTOR` capability, a deny-by-default `authorize()` middleware, and a route registry that produces both the OpenAPI document and the permission matrix.
4. **Audit:** an append-only `auditLogs` collection (updates and deletes throw) covering logins, role changes, tenant lifecycle, branding changes, consent changes and 2FA changes.
5. **Consent:** versioned purpose-specific consent records, with withdraw and grant.
6. **Branding and tenants:** a public branding endpoint resolved by host, admin branding and feature toggles, and super-admin tenant create, suspend and resume with subscription placeholder fields and platform health.
7. **Web:** a design system from the approved brief (tokens, Button, Input, Chip, Avatar, Card, Dialog, Toast), runtime tenant theming, auth screens (sign in, sign up, verify email, 2FA, forgot and reset password), app shell, security settings (sessions, 2FA), admin branding, and the super-admin console.
8. **Tests:** tenant-isolation suite, permission suite, auth suite, and Playwright journeys with axe.

## Assumptions

- The web app proxies `/api` through Vite with the original `Host`, so the API sees `dpit.localhost:5173`. Tenant resolution is by subdomain, and the cookies are same-origin per tenant.
- The super-admin console lives on `admin.localhost`. Super admins are platform users (no `tenantId`) with mandatory 2FA.
- Verification against the roll-number whitelist is Phase 2. In Phase 1, new signups are `pending_verification` with read-only access.
- Phone OTP and SMS are deferred (adapter in Phase 2). Email goes through Mailpit.
- Socket and file cross-tenant tests ship with those modules (Phases 2 and 3). The isolation suite has placeholders that fail if those modules exist without tests.
