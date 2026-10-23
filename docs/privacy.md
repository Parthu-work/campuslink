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
- **Questions the material does not cover** are logged for the faculty's content gaps without the member's name and with personal details removed; faculty see them only as suppressed aggregates (step 5). The member's id is kept on the row only so that erasure can delete it.
- Chats, materials, chunks, vectors, transcripts and usage join the export and erasure as they are built (steps 2 to 5).

## Residency and backups

India region only (AWS Mumbai `ap-south-1` or Hyderabad `ap-south-2`). Backups are encrypted at rest with a KMS key held in-region. See `deployment.md` (Phase 8).
