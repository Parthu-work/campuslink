# Security checklist (OWASP ASVS-aligned)

Legend: ✅ done and tested · 🟡 partial · ⏳ planned (phase)

| Area           | Control                                                                                                                     | Status                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Validation     | Zod strict schemas on every body, query and param; unknown keys rejected                                                    | ✅                                                        |
| Validation     | `$`/dotted/prototype keys rejected at the edge (NoSQL injection, prototype pollution)                                       | ✅                                                        |
| Output         | API returns JSON only; React escapes output; the QR SVG is rendered via `<img>` data URI                                    | ✅                                                        |
| Output         | Allowlist sanitiser for rich text                                                                                           | ⏳ (Phase 4)                                              |
| Headers        | Helmet: CSP `default-src 'none'` for the API, nosniff, frame-ancestors none, `Cache-Control: no-store`; HSTS in production  | ✅                                                        |
| CORS           | Exact allowlist with single-label wildcard subdomains; spoofing tests                                                       | ✅                                                        |
| AuthN          | argon2id (19 MiB, t=2), zxcvbn ≥ 3, HIBP k-anonymity (fails open)                                                           | ✅                                                        |
| AuthN          | Lockout, rate limits, enumeration-safe flows                                                                                | ✅                                                        |
| AuthN          | Rotating refresh tokens with reuse detection, revocation, httpOnly/Strict cookies                                           | ✅                                                        |
| AuthN          | CSRF double-submit plus Origin check for cookie endpoints                                                                   | ✅                                                        |
| AuthN          | TOTP 2FA, mandatory for admins; replay protection; hashed recovery codes                                                    | ✅                                                        |
| AuthN          | Session and device list with revoke                                                                                         | ✅                                                        |
| AuthZ          | Deny-by-default; registry-driven role × endpoint matrix test                                                                | ✅                                                        |
| AuthZ          | Object-level checks (IDOR) and vertical-escalation guards                                                                   | ✅                                                        |
| Tenancy        | Central plugin, no-context-throws, cross-tenant suites in CI                                                                | ✅                                                        |
| Tenancy        | File isolation suite (download, avatar, ID card); socket suite                                                              | ✅ files · ⏳ sockets (Phase 3; guard test fails without) |
| Rate limits    | Redis-backed: auth, signup, email actions, MFA, refresh, admin writes, global                                               | ✅                                                        |
| Rate limits    | Uploads (20/h), search (60/min), verification codes (10/h); messaging, requests, referrals                                  | ✅ uploads, search, verify · ⏳ rest (Phases 3–5)         |
| Uploads        | Magic-byte sniffing, size caps, random keys, sharp re-encode (EXIF stripped), zip-bomb pre-scan, AV hook, sandboxed CSP     | ✅                                                        |
| SSRF           | Safe fetcher: HTTPS only, DNS pinned, public IPs only, redirects revalidated, time and size caps (imports now; feeds Ph. 4) | ✅                                                        |
| Secrets        | Env-only; production refuses placeholder secrets; gitleaks in CI; no secrets or bodies in logs (Pino redaction)             | ✅                                                        |
| Crypto at rest | AES-256-GCM field encryption plus blind index (TOTP secrets, list emails and phones, profile phone)                         | ✅                                                        |
| Audit          | Append-only log (update and delete hooks throw); logins, roles, verification, exports, platform actions                     | ✅                                                        |
| Dependencies   | Lockfile, `pnpm audit` in CI                                                                                                | ✅                                                        |
| Bot protection | Turnstile-style adapter                                                                                                     | ⏳ (Phase 3; sign-up is rate-limited meanwhile)           |
| Verification   | OTP hashed, 10-minute expiry, 5 attempts, single use; each record claimable once; claimed and unknown rolls answer alike    | ✅                                                        |
| Imports        | CSV formula-injection guard on error reports; per-row validation; idempotent re-import; rollback keeps claimed records      | ✅                                                        |
