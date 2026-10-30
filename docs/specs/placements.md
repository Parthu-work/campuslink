# Placement drives (build B7)

Goal: the placement cell runs a campus drive end to end in the app. It creates the drive and opens it, students who meet the rules register in one tap, the cell enters round results, and a selection becomes a verified offer on the student's record. Offers made outside campus drives are reported by the student with proof and verified by the cell. Everything is behind the `placements` feature switch.

## Data

All five collections are tenant-owned, and every index leads with `tenantId`.

| Collection           | Holds                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `placementcompanies` | One per company, unique on `companyKey` (normalised name, `lib/company.ts`); website, sector and the cell's own notes (never shown to students).                                                              |
| `academicrecords`    | One per roll number: CGPA, active and history backlogs, 10th, 12th and diploma percentages, `source` (`import`, `tpo`, `self`), `verifiedBy`/`verifiedAt`, and the member once linked.                        |
| `placementdrives`    | Company, title, roles (title, CTC range in LPA, location, type), mode, venue, drive date, registration close, eligibility rules, up to 10 questions, rounds, `resumeRequired`, status, overrides and version. |
| `driveregistrations` | One per member and drive (partial unique index `one_per_drive`): answers, résumé, status (`registered`, `tpo_override`, `withdrawn`), round results, final result, and the member's branch and batch.         |
| `offers`             | Company, role, exact CTC and its band, date, type, source (`drive`, `off_campus`, `ppo`, `internship_conversion`), status, rejection reason, proof file, and the member's branch and batch.                   |

Nothing in these collections is encrypted with `FieldCipher`. Marks and CTC are access-controlled instead: only the member and holders of `placements:manage` / `outcomes:verify` read them. Phone numbers in exports are decrypted from the roster only when the cell ticks that column.

## Eligibility

`checkEligibility(criteria, record, {branch, gradYear})` (`packages/shared/src/placements/eligibility.ts`) is a pure function shared by the API, which decides, and the app, which explains. It lists **every** unmet rule, not just the first.

- The rules are branches, graduation years, minimum CGPA, maximum active and history backlogs, and minimum 10th and 12th percentages. Empty means "any".
- A diploma percentage stands in for the 12th (lateral entry).
- If the drive has any academic rule and the college has no record for the student, the reason is `noRecord`. A self-reported record that is not yet verified gives `unverifiedRecord`.
- The rules are academic and cohort facts only. There is no field for gender, caste, religion or any other protected attribute, and there must never be one.

The placement cell can let one ineligible student in (`POST /admin/placements/drives/:id/override {rollNumber | userId, reason}`). The override is audited (`placements.override`), and the student then registers themselves; the registration is marked `tpo_override`.

## Drive lifecycle

`draft → open → closed ⇄ open → in_progress → completed`, and anything before `completed` can become `cancelled`. Drives can be edited until they start.

- **Open** requires a registration close in the future. It sets `openedAt`, enqueues `placements.open` once per drive, and schedules `placements.reminder` 24 hours before the close (job id `drvrem-<drive>`, carrying the drive `version`).
  - `placements.open` notifies every eligible verified student in the drive's branches and batches, plus overridden ones: `drive_open` (company and close time). On WhatsApp the message has a **Register** button (`drive_register` action).
  - `placements.reminder` tells eligible students who have not registered: `drive_reminder`, critical on WhatsApp. If the drive's version changed (the close moved), the job does nothing and the new reminder takes over.
- **Register** (`POST /placements/drives/:id/register`, idempotent): the drive is open and before its close, the student is eligible or let in, every required answer is present, a choice answer is one of the options, and the résumé is attached if asked. Uploaded PDFs (`POST /placements/resume`, purpose `placement_resume`) are all validated before any is claimed. A second registration is a 409, and the unique index settles races. Drives with no résumé and no questions register in one tap, and so does the WhatsApp button.
- **Withdraw** works while the drive is open or closed (not once it has started).
- **Round results** come per registration (`PUT …/rounds/:round`) or from a CSV or Excel sheet keyed by roll number (`POST …/rounds/:round/import`). The sheet's roll and result columns are found by header synonyms, results by words ("cleared", "selected", "pass", "rejected", "absent" and so on). Rolls not registered for the drive are listed back and never guessed. Each student whose result changed gets `drive_round_result`.
- **Final result** (`PUT /admin/placements/registrations/:id/final`): `selected` records a **verified** offer (role and exact CTC confirmed by the cell, default from the drive's first role), idempotently per drive, and sends `drive_selected`.

A drive can create a linked `drive` event (`createEvent`), so it appears in Events with calendar and RSVP. The event is in person at the drive's venue (or "Placement cell") from the drive time, for four hours.

## Offers

- **From a drive:** verified at once (above).
- **Reported:** `POST /placements/offers` with proof (`POST /placements/offers/proof`: a PDF, or a photo rebuilt without metadata; purpose `offer_proof`). The offer date may not be in the future. The cell's queue is Admin › Offers (`GET /admin/offers?status`, `POST /admin/offers/:id/decision`). Verify or reject; a rejection needs a reason, which the member sees (`offer_verified` / `offer_rejected`). A verified offer's proof file is deleted 30 days later (`OFFER_PROOF_RETENTION_DAYS`).
- **Declined** by the member: kept on their record as `declined_by_student`.
- The exact CTC is shown only to the member and the cell. Reports (B8) use `ctcBand` and suppressed counts.

## Academic records

- **Import:** Admin › Imports accepts a second type, "Academic records", keyed by roll number (`importMapping.type = 'academics'`, columns suggested from header synonyms). Rows overwrite the record's figures (`created`, `updated`, `unchanged`); they are verified because the college supplied them. There is no rollback (no undo log): fix mistakes with a corrected file. The roster's rollback skips these imports.
- **Self-report** (`PUT /me/academics`) works only for a student with a confirmed roll number and only while the college has no record of its own. It counts once the cell verifies it (`/admin/placements/academics/pending`, `…/:id/decision`).

## Export

`GET /admin/placements/drives/:id/export?format=csv|xlsx&columns=…` (permission `reports:export`). Only the ticked columns from `EXPORT_COLUMNS` are included: roll number, name, branch, batch, email, phone, academic figures, answers, status and final result. CSV has a byte-order mark for Excel, and cells are escaped against formula injection (`csvCell`). XLSX comes from `write-excel-file`. Each export is audited (`placements.exported`) with the format, the columns and the row count.

## Permissions

| Permission            | Holders                                | Allows                                            |
| --------------------- | -------------------------------------- | ------------------------------------------------- |
| `placements:view`     | students, staff (faculty, TPO), admins | see drives and one's own eligibility              |
| `placements:register` | students                               | register, withdraw, upload a résumé, report marks |
| `outcomes:report`     | students, alumni                       | see one's offers, report and decline offers       |
| `placements:manage`   | TPO, college admin                     | companies, drives, registrants, rounds, overrides |
| `outcomes:verify`     | TPO, college admin                     | the offers queue, proof files                     |
| `reports:export`      | TPO, college admin (existing)          | registrant exports                                |

Alumni do not see drives (campus drives are for current students), but they hold `outcomes:report`: B8 gives them a screen for their outcomes.

## App

- **Placements** (`/placements`): the tabs For you (open drives the student may register for), All drives (with "Not eligible"), Registered, and Offers. It also shows the academic record card. Students in their last two years (graduation in June of `gradYear`, from 24 months before to 6 months after) get Placements as a main tab in place of Jobs (`inFinalYears`, `navigation.ts`).
- **Drive** (`/placements/:id`): roles and pay, "Who can apply" in words, rounds with the student's results, and a panel that shows Register (one tap or a sheet with questions and résumé), registered or selected, or every reason the student cannot register.
- **Admin › Placement drives**: drives by status, marks waiting for verification, and companies with notes. A drive's page has the status actions, registrants (résumé download, round results by select or sheet, final result), "Let a student in" and "Export for the company". The editor creates and edits drives.
- **Admin › Offers**: reported offers with proof, to verify or reject.
- The admin overview shows "Drives closing soon" and "Offers to verify".
- A verified offer, or being selected, is celebrated once per device (ADR 0008).
- The job tracker links an "Offer" card to "Report this offer to your placement cell".

## Privacy

`exportFor`/`eraseFor` are registered for registrations, offers and academic records. On erasure, self-reported records are deleted and college records are unlinked. Registrations are anonymised (answers and résumé deleted; branch, batch and results kept without the member), and overrides naming the member are removed. Offers are **anonymised**: the member and the exact CTC are removed and the proof file is deleted. Company, band, branch and batch stay, so the college's placement statistics hold (see `docs/privacy.md`).

## Tests

- `test/placements.test.ts`: eligibility reasons, open notifying only eligible students, reminder versioning, one-tap and question registration, duplicate and closed registration, overrides by roll number, withdrawal, round results by API and by sheet (unknown rolls listed), final selection creating one verified offer, export columns, format and audit, reported offers with proof (verify, reject, 404 and 409), self-reported marks, the academics import and its refused rollback, and the overview counts.
- `test/isolation/placements.test.ts`: cross-tenant reads, writes, decisions and exports.
- A privacy case: anonymised registrations and offers, deleted self-reported marks.
- `packages/shared/src/placements/eligibility.test.ts`: the rule table.
- `e2e/placements.spec.ts`: the TPO creates and opens a drive, the student registers in one tap, the TPO enters a round result and a selection, and the student sees the verified offer. A second test: a reported offer with proof is verified.
