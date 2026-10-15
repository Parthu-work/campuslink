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
