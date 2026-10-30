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

## Age and members under 18 (build B2) — needs legal review

> **Needs legal review** before a college enrols members under 18. The flow follows DPDP Act 2023 §9 and DPDP Rules 2025 Rule 10 as we read them; it is not legal advice.

- **Age check.** Sign-up asks for the birth month (`YYYY-MM`). The birth month itself is never stored: an adult keeps no age data at all, and a member under 18 has only `adultOn`, the first day of the month after their eighteenth birthday month (the latest possible birthday, so nobody counts as an adult early). Members who declared they were 18 before B2 keep their declaration date (`ageCheckedAt`).
- **Verifiable guardian consent.** A member under 18 starts in `guardian_pending` with no permissions: only verification and the guardian step work (plus their privacy rights: export and deletion). The college's admission record is the "reliable details" source: the code goes to the guardian's number on the roster (`guardianPhone`, imported with the student list, encrypted and blind-indexed). The guardian reads a short, versioned declaration (`guardian_consent` v1) in English or Telugu on the student's screen and confirms it with the code. The consent record keeps the roster record id, the language and the channel, not the guardian's number. Without a number on the roster, the student enters one and a TPO or admin checks it against the admission papers before any code is sent (`guardian_manual` in the verification queue; the number is deleted from the request once decided).
- **While a member is under 18** (with consent): the For you feed is chronological (no personalised ranking); contact details are never shown to anyone else, whatever the visibility setting; they never appear on leaderboards; they are excluded from product analytics events (B9). Direct messages exist only inside accepted mentorships (no route opens any other conversation).
- **Turning 18.** A daily job clears `adultOn`, opens a still-pending account, lifts the rules above and tells the member. The rules are computed from `adultOn` on every request, so they lift on the day itself.
- **Not relied on:** the DPDP Fourth Schedule exemption for educational institutions covers only tracking and behavioural monitoring for educational activities or safety. We do not rely on it for any of the above.
- Imported list records hold only what verification and guardian consent need (roll number, name, branch, graduation year, email or phone, guardian's phone); they do not create accounts.

## Phone numbers (build B2)

- Members may sign up and sign in with a mobile number and a one-time code; email becomes optional for students and alumni. Numbers are encrypted (`phoneEnc`) with a blind index for lookups, like every other contact detail.
- Codes are sent by WhatsApp (Meta Cloud API) or SMS (MSG91) through `OtpSender` (B3 adds the real adapters). Only the number and the code leave the platform; no message text, names or other personal data are sent with a code.
- Sign-in answers the same whether or not a number has an account, and a code to a number with no account is never sent.
- One-time code challenges keep the number encrypted for at most 24 hours (sign-up needs it after the code) and are then deleted.

## WhatsApp messages (build B3)

- Sent only to members who opted in (`whatsapp_updates`, optional, versioned) and have a verified number, for the kinds of notification they leave switched on. Meta (WhatsApp) receives the number and the template's variables: names, times, session types, company names and counts, never message or request text.
- What was sent is kept per member as the template name and delivery status for 90 days (`channel_messages`), exported with their data and erased with their account; daily counts per college carry no member ids.
- Replies are not stored. A tap on a button runs that one action as the member; free text gets a fixed answer pointing to the app.

## Placements (build B7)

- **Academic records** (CGPA, backlogs, school percentages) are read only by the student and the placement cell (`placements:manage`). Students see their own record and every rule that stands between them and a drive; nobody else sees their figures.
- **Eligibility rules are academic and cohort facts only.** There is no field for gender, caste, religion or any other protected attribute.
- **Exact CTC** is visible only to the member and the placement cell. Statistics use bands and suppressed counts.
- **Exports for companies** contain only the columns the cell ticks (phone numbers and marks are opt-in). Each export is audited with the columns, the format and the row count.
- **Offer proof** (a PDF or a photo, rebuilt without metadata) is readable only by whoever verifies offers. It is deleted 30 days after the offer is verified.
- **Erasure:** self-reported marks are deleted. Registrations are anonymised (answers and the résumé are deleted; branch, batch and results stay without the member), and overrides naming the member are removed. Offers are **anonymised**: the member and the exact CTC are removed and the proof is deleted. The company, CTC band, branch and batch stay, so the college's placement statistics do not change when someone leaves. College-imported marks stay on the college's list by roll number (they are the college's records, like the roster) and are unlinked from the account.

## Outcomes and accreditation reports (build B8)

- **Higher studies, exams and ventures** are reported by the member or imported from the college's own sheet, and count only once the placement cell verifies them. A score band is what the member chooses to say ("AIR under 2,000"), never a score sheet.
- **Reports are aggregates.** Every count of people is suppressed under 5 on screen, on the dashboard and in summary downloads, and ratios are shown only when the counts behind them are not suppressed.
- **Evidence workbooks name students** (the accreditation bodies ask for it). They need `reports:export` (placement cell and college admin) and every download is audited with the report, the parameters and the row count.
- **Erasure:** unverified outcomes are deleted. Verified outcomes, offers and drive registrations stay in the college's record without the member: the member id is removed and one random key per collection lets reports count the person once without saying who they were.

## Product analytics (build B9)

- **First party only.** Product events are stored in the college's own database; there is no third-party tracker or analytics script.
- **Only adults who allow it.** Events are recorded only for active members over 18 who hold the `analytics_aggregate` consent. Withdrawing it in Settings stops recording at once and detaches the member's past events (kept as anonymous counts).
- **No text.** An event is a name from a closed list, a day, and ids or enum values (for example a request id or "accepted"). Nothing a member wrote is ever recorded.
- **13 months.** Events are then rolled up into daily counts with no member in them, and deleted.
- **Aggregates only.** Colleges see counts (under 5 suppressed); the platform sees per-college counts through a named, audit-logged path and never member rows.
- **Erasure** detaches the member's events in the same way as withdrawal.

## Billing (build B10)

- **About the college, not its members.** Invoices and payments name the college (its legal name, address, optional GSTIN and state) and the platform's seller. No member's id, name or contact is stored with them; the platform admin who recorded a bank payment is kept as the recorder.
- **Online payment sends no personal data.** A Razorpay Payment Link carries the invoice number, the amount, the college's legal name and two internal ids; Razorpay's own SMS and email notifications are off.
- **Seat counts are counts.** The nightly seat count stores one number per college.
- **Kept as tax records.** Invoices are not erased with a member (they hold no member data) and are never deleted for non-payment; a college that does not pay becomes read-only, with everything still readable and exportable.

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
- **Jobs:** saved jobs, application statuses, private notes and alerts are visible only to the member. "Alumni at this company" never reveals a company someone hid.
- **Referrals** are opt-in for alumni (off by default, with a weekly cap). A request's message and résumé are visible only to the requester and the chosen alumnus. Résumés are PDFs rebuilt without document metadata and deleted 60 days after the request.
- **Roadmap progress** (steps done, weekly goal) is visible only to the member. Weekly nudges carry only the roadmap's name, and email for them is off by default. Comments on roadmap steps are visible only to people who write or review roadmaps.
- **Points and badges** are private to the member unless they opt in to the leaderboard or the Wall of Mentors (both off by default). The impact card is drawn in the browser and contains only the mentor's own name, college and counts.
- **Events:** attendee lists are visible only to the host and staff; the online link only to people going, shortly before the start.
- **Analytics** are aggregates only, with counts under 5 suppressed; nothing about individual members is shown or exported.
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
| Job listings                        | Deleted 60 days after they close or expire (TTL)                       |
| Unattached résumé uploads           | Deleted after 24 hours                                                 |
| Résumés on referral requests        | Deleted 60 days after the request                                      |
| Offer proof files                   | Deleted 30 days after the offer is verified                            |
| Product events                      | Rolled up into daily counts after 13 months, then deleted              |
| Audit log                           | Kept                                                                   |

File purges run in the API every 6 hours (`lib/maintenance.ts`). Configurable per tenant: inactive accounts (default 3 years) and deleted-account grace (default 30 days); those purges ship with the privacy release.

## Rights (implemented)

- **Access and export:** Settings → Your data → Download my data (`GET /me/export`). This is one JSON file built from every module's registered exporter, and it includes only messages the member sent. Exports are rate-limited (5 an hour) and audited.
- **Correction:** profile editing; name changes go through the college.
- **Withdrawal of consent:** Settings → Privacy.
- **Erasure:** Settings → Your data → Delete my account (`POST /me/deletion`, password required).
  - Every session is signed out at once and the profile is hidden. While deletion is pending, the account has no permissions, and the member can only export or cancel.
  - After the college's grace period (`retention.deletedAccountGraceDays`, default 30), the retention job runs every module's eraser. Private data is deleted. Messages the member sent are blanked for the other person. Shared items (roadmaps they wrote, past sessions) remain and show "Former member". The account record is deleted last.
  - Consent records and the audit log are kept as legal evidence, keyed only by an id that no longer resolves to a person.
- **Grievance contact:** a placeholder in the Privacy Policy template (`docs/legal/privacy-policy.md`), which each college fills in.

**Templates:** `docs/legal/privacy-policy.md` and `docs/legal/terms.md` are drafts that need legal review.

## AI study assistant (Phase 9)

- **Nothing is sent to an AI provider until the college accepts the data notice** (versioned, with who and when, and an audit entry). The notice says that passages of uploaded material and students' questions go to the chosen provider; names, emails, roll numbers and other profile data never do.
- The built-in demo responder sends nothing anywhere and needs no notice.
- **Subjects** record faculty owners and granted contributors by id; per-student overrides (included or excluded) are exportable and erased with the account. Erasure removes the member from owners and contributors; the subject stays (it belongs to the college).
- **AI settings** belong to the college. The admin who set a key is forgotten on erasure; the consent record is kept as evidence, by id.
- **Study material** belongs to the subject once it is published. On erasure, published material stays (it shows "Former member" as the uploader and its files are detached from the member), and so does taken-down material, hidden, for the record; drafts and material waiting for review are deleted with their files, pages, passages and transcripts. Export lists everything the member uploaded with its subject, status, upload date and rights attestation date.
- **Video links** load nothing from YouTube or Vimeo until the member presses play, and then only the privacy-enhanced players; their title and length are fetched once by the server (oEmbed), not by members' browsers.
- **Transcription and OCR** run on the server (Tesseract, a local Whisper service). A college that uses OpenAI may have video audio transcribed by OpenAI, only after it has accepted the data notice.
- **Search by meaning** sends the member's search words to the college's embedding provider (only after the data notice is accepted); nothing identifying the member goes with them. Vectors are stored with the passages and deleted with them.
- **AI usage counters** (`aiUsage`) record, per member and day, how many requests and tokens were used (no text). They are exported with the member's data; on erasure they fold into the college's anonymous counters, so the month's budget stays correct.
- **Conversations with the study assistant** are private to the member: nobody else can open them, not faculty, not college admins, not the platform owner. They are deleted after the college's chat retention period (default 180 days; 0 keeps them until the member deletes them), and members can delete one conversation or all of them at any time. Export includes them; erasure deletes them with any kept flashcard decks.
- **Questions sent to an AI provider** carry only the question (with email addresses, phone numbers and roll-number-like codes removed) and the passages of material it is answered from; never a name or any profile detail.
- **Questions the material does not cover** are logged for the faculty's content gaps without the member's name and with personal details removed; faculty see them only as suppressed aggregates. The member's id is kept on the row only so that erasure can delete it.
- **Faculty insights** are aggregates only: questions per topic and unit, distinct students per unit, feedback, and content gaps as topics (or as words at least 5 different students used), with every count under 5 shown as "<5". No question text, conversation or student is shown, and only the subject's owners and the college's admins see them.
- **Material views** are counted per material and day without any member id (`materialViewStats`), for "most used material"; rows go after about 13 months.
- **The admin AI dashboard** shows the college's totals (tokens per day and model, answers, failures); there is no per-member view of usage. Admin alerts (key rejected, budget nearly or fully used) carry no member data.
- Chats, materials, chunks, vectors, transcripts and usage are covered by export and erasure (steps 2 to 5); the view counters hold no personal data.

## Residency and backups

India region only (AWS Mumbai `ap-south-1` or Hyderabad `ap-south-2`). Backups are encrypted at rest with a KMS key held in-region. See `deployment.md` (Phase 8).
