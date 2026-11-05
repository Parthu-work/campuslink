# Alumni engagement (prompt 2, G6)

Goal: alumni say yes because asks are small, recognition is real, and their batch is there.

Module: `apps/api/src/modules/alumni/` (micro-asks, recognition, giving, LinkedIn import, batch pages), with weekly office hours in `modules/events/`. Web: `/alumni` (`features/alumni/`), `/batch/:gradYear/:branch`, the public `/verify-certificate/:code`, Admin › Recognition and Admin › Giving. Strings: the `alumni` language pack (core holds only nav labels, notification text and the few strings on screens that are not pack-loaded: the event form and page, the Wall of Mentors, the mentor dashboard and requests).

## Permissions

| Permission         | Who                     | What                                                           |
| ------------------ | ----------------------- | -------------------------------------------------------------- |
| `alumni:ask`       | students, alumni        | send micro-asks                                                |
| `alumni:help`      | alumni                  | receive micro-asks, certificates, alumnus-of-the-month replies |
| `alumni:recognise` | TPO, college admin      | nominate the alumnus of the month, revoke certificates         |
| `giving:pledge`    | alumni                  | pledge, mark paid, download acknowledgements                   |
| `giving:manage`    | TPO, college admin      | funds, recording receipts, receipt settings                    |
| `profile:import`   | students, alumni, staff | LinkedIn import into one's own profile                         |

Batch pages use `directory:read`; following office hours uses `events:rsvp`.

## Micro-asks

`MicroAsk {kind: review_resume | answer_question | quick_intro | feedback_on_project, fromUserId, toUserId, audience {company, branch, topic}, resumeId?, questionId?, note, status, tried[], assignedAt, expiresAt, version, doneAt}`.

- **Routing.** One alumnus at a time: verified alumni matching any of the company (by `companyKey`), branch or topic (skills or topics), best match first (company 4, branch 2, topic 1), never the asker, nobody already tried, nobody who turned asks off, nobody blocked either way.
- **The weekly cap.** An alumnus is handed at most `MICRO_ASKS_PER_WEEK` (2) asks in a rolling week, counted in `MicroAskOffer` (a hand-over counts even when they pass). A unique (alumnus, week slot) index makes two hand-overs at once take different slots or fail, so the cap holds under races.
- **Hand-overs.** The alumnus says yes, passes (it moves on) or does not reply within `MICRO_ASK_REPLY_HOURS` (72; a delayed job with the ask's `version` moves it on). After `MICRO_ASK_MAX_TRIES` (3) alumni, or when nobody is free, it is `unmatched` and the asker is told.
- **The asker.** At most `MICRO_ASKS_OPEN_MAX` (3) open at once; a résumé review must name the asker's own résumé, and an answer a Q&A question they can see. The helper of a résumé-review ask may read and comment on that résumé (G2's reviewer access now also accepts a micro-ask).
- **Done.** Marking it done awards `micro_ask_done` (impact, 8 points, at most 5 a day) through `lib/awards.ts` with `from` the asker, once (the award's item id is the ask), and tells the asker.
- **WhatsApp.** `micro_ask_received` has the template `cl_micro_ask` (the asker's first name and the kind, never the note) with **Yes, I'll help** and **Not now** buttons: new action kinds `micro_ask_accept` and `micro_ask_decline` on the existing signed action-token mechanism (nothing about how tokens are signed, rotated or expire changed). Not critical: the alumnus's weekly WhatsApp cap and the college's allowance apply.
- **Turning off.** `PUT /me/micro-asks/settings {open}` (`MicroAskOptOut`).

## Weekly office hours

- `recurrence {weekly: true, until}` on events of kind `office_hours` only, until at most `OFFICE_HOURS_MAX_WEEKS` (26) weeks after the first start. The first instance's id is the `seriesId`.
- When an instance ends, the job `events.office_hours_next` (keyed by its end time) makes next week's, unless the series stopped (recurrence removed in an edit, the event removed or moved, the host no longer an active member) or it would start after `until`. The unique `(tenantId, seriesId, startsAt)` index makes a second run a no-op. Cancelling one instance does not stop the series. The job runs inside the college's tenant context like every job.
- **Following.** `PUT /members/:id/office-hours/subscription {on}`; followers are told (`office_hours_scheduled`) whenever the host schedules office hours, one-off or recurring, if they may see the event (checked with `backgroundAuth`, so current rights and audience apply).

## Recognition

- **Certificates.** `MentorCertificate {userId, academicYear (June to May), name, sessions, mentees, asks, events, code, status: rendering | issued | revoked, pdfFileId}`, one per member and year, issued only when there is something to certify (a completed session as mentor, a micro-ask done or an event hosted in that year). The PDF (pdf-lib, Noto Sans, landscape, college name, counts, a QR code to the check link) is drawn in the `alumni.certificate` job and stored as `mentor_certificate`. Refreshing a running year keeps the code.
- **Verification (owner decision, E7).** No signing key fits (the files key is per process; reusing login or WhatsApp secrets would break every certificate on rotation), so the owner chose a random 128-bit code stored with the certificate: `GET /verify/certificates/:code` (public, rate-limited, college host) returns the name, college, year, counts and whether it still stands. An unknown code is 404; a revoked one says so. G12's verifiable credentials can replace it.
- **Alumnus of the month.** The TPO nominates (`alumni:recognise`) with a month and a citation; the alumnus is asked (`alumni_of_month_nominated`) and nothing shows until they accept. One per month (a declined nomination frees it). Accepted ones show on the Wall of Mentors (`GET /alumni/of-the-month`). The TPO may then post the announcement from a template they can edit (an official announcement, so it needs `announcements:post` too), once.

## Giving

- **Funds** `{title, purpose: scholarship | lab | event | general, description, targetPaise, payLink, bankDetails, status}`: the college's own payment page (for example a Razorpay link) or bank details. **Money never passes through the platform**: there is no payment adapter call.
- **Pledges** `{userId, fundId, purpose, amountPaise, status, reference, receivedPaise, receivedOn, receiptNo, taxReceipt, ackFileId}`. Statuses: `pledged` → `paid` (the member says so, with a reference) → `received` (the college records the money) or `cancelled` (by the member, before receipt). Recording claims the pledge first, then numbers it from the college's `ReceiptCounter` for the Indian financial year of the receipt date (`ACK/2026-27/0001`, or `RCPT/…` for tax receipts): a number is used once, two clicks record once, and a received pledge never changes or cancels.
- **Acknowledgement.** The `alumni.acknowledgement` job draws the PDF (`giving_acknowledgement`). It says "Receipt for donation" with the registration number only when the college's `GivingSettings.taxReceipts` is on (fixed on the pledge when received); otherwise "Acknowledgement of contribution … not a tax receipt".
- **Totals** per fund: received, pledged and donors (through `suppress()`).
- **NAAC.** The alumni engagement report (B8 definition 5, now version 2026.2) adds quick favours done by alumni, alumni who contributed and the amount received (whole rupees; hidden when fewer than five contributed). It counts only money recorded as received.

## LinkedIn import

The member uploads LinkedIn's own data export (the ZIP, or one of its CSV files), at most 10 MB. It is scanned (fail closed) and read in memory, never stored. The ZIP passes `lib/zip-guard.ts` first (ratio, total and entry caps), then only `Positions.csv`, `Education.csv` and `Skills.csv` are inflated, each capped at 2 MB of output; encrypted entries are refused. The preview shows positions, education and skills; the member picks their current role and the skills to add. Only company, job title and skills are written, through the profile's own validation (skills capped at the profile's 20). Education is shown to check but not kept: branch and batch come from the college's record (data minimisation). No scraping, no LinkedIn API or sign-in.

## Batch pages

`GET /batches/:gradYear/:branch`: members through the directory (each field as their visibility allows), the batch's verified count (suppressed), companies named only when five or more of the batch work there and show their company to every member, upcoming meetups whose title names the batch year or a reunion, and how many on the college's list have not joined (suppressed) with a "find your batchmates" share of the college's sign-up link (the full invite loop is G8).

## Privacy

| Collection                                 | Export                                 | Erasure                                                                                                  |
| ------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `MicroAsk`                                 | sent (with notes), received (no notes) | own asks deleted; as helper: open ones unmatched, done ones keep no name                                 |
| `MicroAskOffer`, `MicroAskOptOut`          | whether asks are on                    | deleted                                                                                                  |
| `OfficeHoursSubscription`                  | with events                            | deleted (as follower and as host); the host's series stop                                                |
| `MentorCertificate`                        | yes                                    | deleted (the check link stops working); PDFs go with the member's files                                  |
| `AlumniOfMonth`                            | yes                                    | deleted; as nominator: detached                                                                          |
| `Pledge`                                   | yes                                    | not received: deleted; received: kept for the college's accounts with `anonKey`, acknowledgement removed |
| `Fund`, `GivingSettings`, `ReceiptCounter` | no member data                         | n/a                                                                                                      |

## Product events

`micro_ask_sent`, `micro_ask_done`, `office_hours_subscribed`, `certificate_issued`, `pledge_made`, `linkedin_imported`.

## Tests

`test/alumni.test.ts` (routing, hand-overs, expiry, the weekly cap, the open-asks cap, permissions, XP once, résumé access, opting out; recurrence, idempotent next instance, `until`, followers; certificates, the public check, refresh keeps the code, revoke; alumnus of the month, announcement once, a declined month freed; fund, pledge statuses, receipt numbers, tax receipts, acknowledgement PDF, NAAC totals; LinkedIn ZIP and CSV, the ZIP bomb guard; batch pages; privacy), `test/isolation/alumni.test.ts`, `test/privacy.test.ts`, `test/reports.test.ts`, `packages/shared/src/navigation.test.ts`, `apps/web/e2e/alumni.spec.ts` (with axe).
