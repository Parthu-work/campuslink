# Phase 2: People

Done when: an admin can import a sample CSV, map columns and run it; students and alumni can verify against that list; everyone verified can browse the directory.

## Plan

1. **Platform pieces**
   - `StorageProvider` (local disk, S3 stub) and upload pipeline: size caps, magic-byte sniffing, image re-encoding that strips metadata, random keys, malware-scan hook, and a guarded `/files/:id` route.
   - SSRF-safe fetcher.
   - `JobQueue` (BullMQ in dev/prod; inline runner in unit tests) with jobs that run inside the tenant context.
   - `SmsProvider` (disabled stub).
   - Tenant-cache invalidation over Redis pub/sub.
2. **Imports**
   - `DataSourceAdapter` with CSV, XLSX, Google Sheets (CSV export URL) and generic REST/JSON adapters.
   - Preview and column-mapping endpoint.
   - Background import jobs with progress, dry run, duplicate detection, row-level error report (CSV, injection-safe, no personal values), idempotent re-import, and rollback of the last import.
   - Records form the verification whitelist; email and phone are encrypted with a blind index.
3. **Manual add and bulk invite.** Invites by email link a whitelist record. Phone invites go through the SMS adapter, which is disabled locally and clearly reported as unavailable.
4. **Verification**
   - Roll number (plus graduation year for alumni) matched against the whitelist, then a 6-digit OTP to the email on record.
   - Auto-verify when the record's email is the account's already-confirmed email.
   - Fallback: upload a college ID photo to an admin approval queue.
   - Alumni can verify a company email for a "currently at" badge.
5. **Profiles and directory**
   - Profile with per-field visibility (members, alumni and staff, only me); contact details are only-me by default.
   - Directory with filters; profile pages; search endpoint; Ctrl/Cmd+K command palette.
6. **Admin:** imports UI (source, mapping, preview, run, progress, errors, rollback), whitelist, verification queue, invites.
7. **Tests:** isolation for every new collection, including **file access**; permission matrix (automatic); verification abuse cases; import correctness; upload hardening; SSRF; end-to-end import → verify → directory.

## Assumptions

- **Google Sheets:** the sheet is shared "anyone with the link can view". We use Google's documented CSV export URL; no scraping, no OAuth yet (adapter-ready).
- **SMS:** no free SMS provider exists, so phone OTP and invites are behind `SmsProvider`, disabled locally. Records with only a phone number fall back to ID-photo verification.
- **Under-18 edge cases:** we don't collect minors' data. The sign-up page tells them to contact their college, and admins can invite them once eligible. Documented in `privacy.md`.
- **Retention:** import source files are deleted right after processing. ID photos are deleted 30 days after a decision.

## Outcome (built)

- **API:** 4 new modules (files, imports, verification, profiles) with 27 new endpoints (60 in total), all in the generated `docs/permissions.md` and covered by the role × endpoint matrix.
- **Platform pieces:** `StorageProvider` (local disk, memory, S3 stub), upload pipeline with sniffing, re-encoding and a scanner hook, SSRF-safe fetcher, `JobQueue` (BullMQ, inline for tests), `SmsProvider` (disabled stub), tenant-cache invalidation over Redis pub/sub, retention purge every 6 hours.
- **Imports:** CSV, XLSX, Google Sheets and REST/JSON adapters; preview with suggested mapping; dry run; background job with progress, duplicate and row-error reporting, downloadable error CSV, idempotent re-import and rollback. Guide: `docs/data-sources.md`.
- **Verification:** roll number (plus graduation year for alumni) → emailed 6-digit code, or automatic when the record's email is the account's confirmed email; college-ID photo queue for admins; invite-based auto-verification; revoke; company-email badge for alumni.
- **Profiles and directory:** per-field visibility with contact details private by default, avatar upload, links restricted to an allowlist of hosts, filters and cursor pagination, search, and a Ctrl/Cmd+K command palette.
- **Web:** verify flow, directory, profile view and edit, admin imports wizard, college list, verification queue, and a revoke-verification action; English and Telugu.
- **Tests:**
  - API: 223 tests, including a people isolation suite (files, imports, list, requests, invites, profiles, search), import correctness, verification abuse cases, upload hardening, SSRF (with a fake transport) and real BullMQ. Coverage gate passes.
  - Web: 26 Playwright journeys (phone and desktop) with axe, including import sample CSV → verify by emailed code → browse directory → edit profile. CI now runs Mailpit for the emailed codes.

## Deviations from the plan

- **Profiles are a read model.** `ProfilesService.sync()` copies name, roles, status and verification from the user on every change, so the directory and search never join users.
- **Search** uses the Mongo text index through `db/search.ts`, with an escaped name-substring fallback when the text index finds nothing (partial names). A dedicated search engine is not needed at this scale.
- **Bot protection** (Turnstile-style adapter) moves to Phase 3 with messaging; sign-up and verification are rate-limited meanwhile.
- **Phone verification and phone invites** are wired to the disabled `SmsProvider`. Phone-only records fall back to the ID-photo queue, and the UI says so.

## Gaps and next steps

- No OAuth for Google Sheets; private sheets need "anyone with the link".
- No production SMS or antivirus provider (hooks are in place).
- Self-service data export and deletion remain for the privacy release.
- Phase 3: mentorship requests, messaging (Socket.io with isolation tests), bot protection.
