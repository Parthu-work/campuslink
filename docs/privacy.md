# Privacy (DPDP Act 2023 baseline)

> Draft for legal review. Not legal advice.

## Roles

- **College = Data Fiduciary.** The college decides why student and alumni data is processed (guidance, mentorship, placements) and answers to its students.
- **CampusLink (platform) = Data Processor.** We process on the college's instructions under a data-processing agreement. Platform operators see aggregate counts only.
- **Grievance officer:** each college names one (placeholder in tenant settings). Platform contact: `privacy@<deployment-domain>` (placeholder).

## Consent (implemented)

- Purpose-specific and granular: `account` (required), `mentorship_matching`, `email_digests`, `analytics_aggregate`.
- Every grant or withdrawal is a new **append-only** record with the purpose version and privacy-notice version (`consents` collection). Current state is the latest record per purpose.
- Users can change optional consents in Settings → Privacy, effective immediately. Withdrawing `account` means account deletion (self-service in the privacy release).

## Age

Sign-up requires an 18+ declaration. Under-18 users are blocked on the client and the server. **We do not collect minors' data:** a 17-year-old first-year is told to contact their college, and the admin invites them once they turn 18. Imported list records hold only what verification needs (roll number, name, branch, graduation year, email or phone); they do not create accounts. Rationale: DPDP's verifiable-parental-consent requirements for children are out of scope for now.

## Data minimisation (implemented)

- IP addresses are reduced to /24 (IPv4) or /48 (IPv6) prefixes in sessions and audit.
- The raw user agent is reduced to a coarse "Chrome on Android" label.
- No third-party trackers or analytics.
- Profiles have per-field visibility (members, alumni and staff, only me). Email and phone default to **only me**; the directory and search never return a field the viewer may not see.
- List records store email and phone encrypted (AES-256-GCM) with a keyed blind index for matching. Admin screens show masked emails (`sa•••@dpit.example`).
- Import error reports name the row, column and problem, never the cell's value.
- Uploaded images are re-encoded, which strips EXIF data such as GPS location. Chat PDFs are rebuilt from their pages, dropping document metadata.
- **Messages** are visible only to the two participants and stored encrypted (AES-256-GCM). College admins and the platform operator have no endpoint that returns message content. Moderators see only the text of a message someone reported.
- **Session feedback** is private to the mentor and college admins (`mentorship:oversee`).
- **Alumni Match** uses only profile fields the mentee is allowed to see, plus the mentee's own goals and target companies, which nobody else sees.
- **Notifications** (in-app, email, push) carry names, session types and times, never message or request text. Members choose channels per category and can set quiet hours.
- **Feed ranking** uses only what members chose to follow, their branch and public counts. No dwell time, click tracking or hidden interest profile (`docs/feed-ranking.md`).
- **Posts and stories:** photos are re-encoded and video metadata boxes (which can hold GPS location) are wiped. Link previews keep only the page title, description and site name. Stories expire after 24 hours, and their photos are deleted an hour later.
- **Q&A** questions are visible only to the asker and moderators until approved. Rejection and removal reasons are shown only to the author.
- **News items** keep only a headline, a snippet of at most 300 characters and a link; nothing about who read them is recorded.
- **Blocking** is silent: the blocked person isn't told; the chat closes and future sessions are cancelled.

## Retention (implemented)

| Data                                | Retention                                                              |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Email-verification and reset tokens | Deleted at expiry (TTL index)                                          |
| Sessions                            | Deleted 30 days after expiry (TTL index)                               |
| Verification codes (OTP)            | Deleted 24 hours after issue (TTL index)                               |
| Invites                             | Deleted at expiry, 30 days (TTL index)                                 |
| Import previews                     | Deleted after 2 hours (TTL index)                                      |
| Import source files                 | Deleted right after the import runs; at most 24 hours if it never runs |
| College ID photos                   | Deleted 30 days after the admin's decision                             |
| Unattached post and story uploads   | Deleted after 24 hours                                                 |
| Stories                             | Deleted after 24 hours (TTL); their photos 1 hour later                |
| Ingested news items                 | Deleted 90 days after publication (TTL index)                          |
| Moderation actions and appeals      | Kept (append-only accountability log)                                  |
| Audit log                           | Kept                                                                   |

File purges run in the API every 6 hours (`lib/maintenance.ts`). Configurable per tenant: inactive accounts (default 3 years) and deleted-account grace (default 30 days); those purges ship with the privacy release.

## Rights (planned, privacy release)

Correction is self-service now (profile editing). Self-service export (JSON) and deletion (soft delete → hard delete after the grace period) through background jobs.

## Residency and backups

India region only (AWS Mumbai `ap-south-1` or Hyderabad `ap-south-2`). Backups are encrypted at rest with a KMS key held in-region. See `deployment.md` (Phase 8).
