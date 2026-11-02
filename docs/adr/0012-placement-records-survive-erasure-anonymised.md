# ADR 0012: Placement records survive erasure in anonymised form

- Status: accepted
- Date: 2026-11-01

## Context

A college's placement record (how many of a batch registered, were placed, at which companies, in which salary bands; who went on to higher studies, qualified an exam or started a venture) is what it reports to NBA, NAAC and NIRF, often years after the batch graduates. The DPDP Act 2023 gives a member the right to have their personal data erased. If erasing an account deleted its registrations, offers and outcomes, a college's placement percentage for a past batch would fall each time an alumnus left, and an accreditation figure already submitted could no longer be reproduced. Keeping the records whole would keep the person.

## Decision

1. On erasure, drive registrations, offers and verified outcomes (`HigherStudy`, `ExamQualification`, `Venture`) are **kept and detached**: `userId` is replaced by a random `anonKey` (one per erased member in each collection), so a report still counts that person once.
2. What identifies the person is removed: the link to the account, the exact CTC (the band stays), registration answers, résumés and offer proof. What remains is the company, the role, the CTC band, the offer type and source, the branch and the graduating batch.
3. Unverified outcomes and self-reported marks are deleted; the college's own academic records are unlinked from the account (they are the college's records, imported from its own systems).
4. Reports count by `userId` or `anonKey`, and every count goes through `suppress()`, so an anonymised record cannot be singled out in a small cell. The student-level evidence workbook shows an anonymised row as "Former member", without a name or roll number.
5. Product events follow the same rule (B9): detached, never deleted, so past counts do not shift.

## Consequences

- A past batch's figures stay stable, and a report can be regenerated after members leave.
- The privacy notice says that anonymised placement and outcome records are kept as the college's record (`docs/privacy.md` › Placements); this needs the lawyer's review listed in `docs/build/report-1.md`.
- Erasure tests check both halves: the member is gone from every record, and the anonymised record still counts (`test/privacy.test.ts`, `test/reports.test.ts`).
- A batch so small that even bands identify people is protected by suppression, not by this ADR.
