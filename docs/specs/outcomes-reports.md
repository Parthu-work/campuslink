# Placement outcomes and accreditation reports (build B8)

Goal: the college's placement and progression evidence is generated from verified records, not compiled by hand. B8 adds three outcome types next to B7's offers, and reports for NBA, NAAC, NIRF-style and internal use. Everything is behind the `placements` feature switch.

## Outcome records

Three tenant collections share one shape (`modules/placements/outcomes.model.ts`): `userId`, `anonKey`, `status` (`reported`, `verified`, `rejected`), `source` (`self`, `tpo`, `import`), `reason`, `verifiedBy`/`verifiedAt`, and the member's `branch` and `gradYear` when recorded. Every index leads with `tenantId`.

| Collection           | Fields                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `higherstudies`      | institution, programme, country (default India), admission year, qualifying exam                               |
| `examqualifications` | exam (`GATE CAT GRE GMAT IELTS TOEFL UPSC STATE_PSC NET OTHER`), its name for `OTHER`, year, score band, level |
| `ventures`           | name, registered (company, LLP or firm), year                                                                  |

The level (state, national, international) is fixed for known exams (`EXAM_LEVEL`) and chosen by the member for `OTHER`. A score band is free text as the member says it ("AIR under 2,000"), never a score sheet.

### Who does what

- **Members report** (`outcomes:report`: students and alumni): `POST /me/outcomes/higher_study | exam | venture` (idempotent), `GET /me/outcomes`, `DELETE /me/outcomes/:kind/:id` (only before verification). At most 20 of each kind per member. Branch and batch come from the profile, never from the request.
- **The placement cell verifies** (`outcomes:verify`: TPO, college admin): `GET /admin/outcomes/:kind?status`, `POST /admin/outcomes/:kind/:id/decision` (a rejection needs a reason, which the member sees). The member gets `outcome_verified` or `outcome_rejected` with the outcome's title only. A decided record cannot be decided again (409).
- **Import**: `POST /admin/outcomes/:kind/import` takes the college's CSV or Excel sheet keyed by roll number (header synonyms per kind). Rows become **verified** outcomes of members on the list. A row matching an outcome the member already has (same institution and programme, same exam and year, same venture name) updates it. Rolls that are not members yet are listed back and never guessed. Each import is audited (`placements.outcomes_imported`) with its counts.
- Waiting outcomes count on the admin overview card together with offers ("Outcomes to verify").

### Screens

- **Your outcomes** (`/outcomes`, avatar menu, for students and alumni): offers (B7), then higher studies, exams and ventures with "Add" dialogs and their status. Students also see the same panel on Placements › Offers.
- **Admin › Offers and outcomes**: a switch between Offers, Higher studies, Exams and Ventures; each kind has its status tabs, a review dialog and "From the college's sheet".

## Reports

`modules/reports/`: each definition (`definitions/*.ts`) is `{id, framework, title, version, sourceNote, needsReview, threeYears, compute(data, params, count), evidence(data, params)}`. Definitions read only through `ReportData`, which `app.ts` builds from the owning services: roster counts per branch and batch (`WhitelistService.countsByCohort`), verified offers (`OffersService.verifiedFor`), drive registrations (`PlacementsService.seekersFor`), verified outcomes (`OutcomesService.verified`), names and roll numbers for evidence, and alumni activity (events hosted, sessions held, referrals given).

Parameters: a programme (or all) and a graduating batch (`gradYear`; 2026 is the academic year 2025-26, June to May). Three-year reports cover that batch and the two before it.

| Id                       | Framework | What it shows                                                                                                                                                        |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal-placement`     | internal  | per branch: final-year students, seeking placement, placed, placement %, offers per placed student, median band, last year's %                                       |
| `nba-sar-placement`      | NBA       | per year: N, x placed, y higher studies (with a qualifying exam), z entrepreneurs, P = (x + y + z) / N; the three-year average and "30 × average" per the SAR format |
| `naac-placement`         | NAAC      | employers per programme with students placed and the median package band                                                                                             |
| `naac-higher-education`  | NAAC      | institution and programme joined, per programme, with the number abroad                                                                                              |
| `naac-exams`             | NAAC      | students per exam and level, by the calendar year qualified                                                                                                          |
| `naac-alumni-engagement` | NAAC      | events alumni hosted, alumni hosts, sessions alumni held, alumni mentors, referrals alumni gave, alumni referrers                                                    |
| `nirf-median-salary`     | NIRF      | per year and programme: graduates placed and their median salary (one per student, their highest offer)                                                              |

Rules every definition follows:

- **Verified records only.** Reported or rejected outcomes and offers never count.
- **People once.** Counts are of distinct people. An erased member's records share one random `anonKey` per collection, so they still count once without saying who they were.
- **Placed means a job offer.** Internships are not placements; a PPO-type offer is.
- **Seeking placement** means registered for a drive (not withdrawn) or placed some other way.
- **Small counts.** Every count of people goes through `suppress()` on screen, in the dashboard and in summary downloads ("<5"). A ratio or percentage is shown only when the counts behind it are 0 or at least 5, so a suppressed count cannot be worked back from it. The NBA average and assessment need all three ratios.
- **Medians.** The NIRF median needs 5 or more exact salaries; anonymised offers keep only a band and are left out of it. The median band uses exact figures where every one is known, otherwise the median of the bands.
- **No invented thresholds.** Frameworks change (NAAC moved to binary accreditation in 2025), so each definition is versioned and carries its `sourceNote`. Every accreditation definition is `needsReview: true` until someone checks it against the current manual; the screen and every download say so.

### Routes

| Route                                     | Permission         | Notes                                                                                                                                             |
| ----------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/outcome-reports`              | `analytics:tenant` | the definitions                                                                                                                                   |
| `GET /admin/outcome-reports/dashboard`    | `analytics:tenant` | placement %, placed, seeking, final-year, median band, higher studies, top 5 recruiters, five batches of trend                                    |
| `GET /admin/outcome-reports/:id`          | `analytics:tenant` | the table, totals and notes (suppressed)                                                                                                          |
| `GET /admin/outcome-reports/:id/export`   | `reports:export`   | the same table as CSV (BOM, formula-safe) or Excel; audited `reports.exported`                                                                    |
| `GET /admin/outcome-reports/:id/evidence` | `reports:export`   | Excel workbook: "Summary" with exact counts and "Students" with every student behind them; audited `reports.evidence_exported` with the row count |

The paths are `outcome-reports` because `/admin/reports` already belongs to moderation (content reports). Downloads carry the college, the framework and version, the parameters, the notes, the source note and the footer "Generated by {APP_NAME} on <date> from verified records."

### Screens

**Admin › Reports** (`/admin/reports`, group Insights): batch and programme (kept in the URL), stat cards, the trend as a `ColumnChart`, top recruiters, and the list of reports. A report page shows the table, the review warning, notes, source and method, and (with `reports:export`) Excel, CSV and the evidence workbook. Report content (titles, column headings, notes) is in English, as the accreditation bodies take it and as it downloads; the screens around it are translated.

## Privacy

`OutcomesService.exportFor`/`eraseFor` are registered as `outcomes`. On erasure, unverified outcomes are deleted. Verified ones stay in the college's record without the member: `userId` is removed and one random `anonKey` keeps them countable. B7's offers and registrations get an `anonKey` the same way. Evidence workbooks name members, so they need `reports:export` and are audited.

## Tests

- `test/reports.test.ts`: a fixture with known answers for every definition (NBA ratios, average and assessment; NAAC rows and totals; NIRF medians; internal percentages, last year and suppression), the dashboard, both downloads and their audit entries, and the permissions.
- `test/outcomes.test.ts`: reporting each kind, `OTHER` validation, permissions, verification and rejection with notifications (no reason text), double decisions, removal rules, the sheet import (created, updated, unknown rolls, row errors) and the overview count.
- `test/isolation/outcomes.test.ts`: cross-tenant reads, decisions, deletions, imports, reports and the dashboard.
- `test/privacy.test.ts`: a verified outcome anonymised with an `anonKey`, an unverified one deleted, and the offer's `anonKey`.
- `e2e/reports.spec.ts`: a student reports higher studies and the TPO verifies it; the TPO opens the dashboard and the NBA report and downloads the summary and the evidence workbook.
