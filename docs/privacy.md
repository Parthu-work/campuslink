# Privacy (DPDP Act 2023 baseline)

> Draft for legal review. Not legal advice.

## Roles

- **College = Data Fiduciary.** The college decides why student and alumni data is processed (guidance, mentorship, placements) and answers to its students.
- **CampusLink (platform) = Data Processor.** We process on the college's instructions under a data-processing agreement. Platform operators see aggregate counts only.
- **Grievance officer:** each college names one (placeholder in tenant settings, Phase 2). Platform contact: `privacy@<deployment-domain>` (placeholder).

## Consent (implemented)

- Purpose-specific and granular: `account` (required), `mentorship_matching`, `email_digests`, `analytics_aggregate`.
- Every grant or withdrawal is a new **append-only** record with the purpose version and privacy-notice version (`consents` collection). Current state is the latest record per purpose.
- Users can change optional consents in Settings → Privacy, effective immediately. Withdrawing `account` means account deletion (self-service in the privacy release).

## Age

Sign-up requires an 18+ declaration. Under-18 users are blocked on the client and the server. Edge cases (for example a first-year student who is 17) go to admin review once verification ships in Phase 2. Rationale: DPDP's verifiable-parental-consent requirements for children are out of scope for now.

## Data minimisation (implemented)

- IP addresses are reduced to /24 (IPv4) or /48 (IPv6) prefixes in sessions and audit.
- The raw user agent is reduced to a coarse "Chrome on Android" label.
- No third-party trackers or analytics. Contact details are hidden by default (enforced by the profiles module in Phase 2).

## Retention (implemented)

| Data                                | Retention                                |
| ----------------------------------- | ---------------------------------------- |
| Email-verification and reset tokens | Deleted at expiry (TTL index)            |
| Sessions                            | Deleted 30 days after expiry (TTL index) |
| Audit log                           | Kept                                     |

Configurable per tenant: inactive accounts (default 3 years) and deleted-account grace (default 30 days). Purge jobs ship with BullMQ in Phase 2.

## Rights (planned, Phase 2 and the privacy release)

Self-service export (JSON), correction, and deletion (soft delete → hard delete after the grace period) through background jobs.

## Residency and backups

India region only (AWS Mumbai `ap-south-1` or Hyderabad `ap-south-2`). Backups are encrypted at rest with a KMS key held in-region. See `deployment.md` (Phase 8).
