# ADR 0014: Cross-college network and employer access

- Status: accepted (owner, 2026-11-11). Proposed in prompt 2, G12, under E5 and E7. The platform switch `NETWORK_ENABLED` (prompt 4, P0) stays as an off switch: production enables the network explicitly (`NETWORK_ENABLED=true` in `deploy/prod/.env.production.example`), and unset still means off.
- Date: 2026-11-06

## Context

Until now every read and write stays inside one college. ADR 0002 makes that the rule: the tenant comes from the subdomain, the Mongoose plugin filters every query by it, and the only way around it is `withPlatformScope(reason, fn)`, which today serves platform statistics, timers and migrations, never a member's request.

G12 needs three things that cross that line:

1. **Cross-college alumni discovery.** A student of college A finds alumni of college B at a company and asks one of them for help.
2. **A recruiter portal.** Employers (not colleges, not members of any college) post roles to several colleges, see how many students might fit, and then see the résumés and readiness of students who chose to apply.
3. **Verified credentials.** Offers, readiness milestones, mentor certificates and recognition signed by the college, so that anyone, anywhere, can check them without an account.

Each one is a way for personal data to leave the college that holds it. The owner's rules: employers reach only students who opted in, through their college (E6); nothing for minors; public pages show no contact details, exact CTC or anything about a minor (E4); and any change to tokens, refresh rotation, tenancy enforcement or encryption, or a new third party holding personal data, needs approval first (E7). This ADR is that approval request. Every claim below is numbered (N1 to N40) and mapped to a test in the last section.

## Decision

### 1. Employers are a tenant kind, not a platform registry

`Tenant.kind` gains `'employer'`. An employer is a tenant with its own subdomain (`emp-<name>`, for example `emp-acme.campuslink.in`), its own members (recruiters), its own postings, audit log and invoices.

Why a tenant kind and not a platform-level registry:

- **No change to tokens or sessions (E7).** Recruiters sign in through the existing per-tenant auth: the access token's `tid` is the employer tenant, the refresh cookie is per subdomain, rotation and reuse detection are unchanged. A platform registry would need recruiters to live somewhere: in the platform tenant beside super admins (a privilege mix we refuse), or behind a second login system.
- **Employers are isolated from each other for free.** Postings, shortlists, recruiters and invoices are tenant-owned, so employer A can never read employer B's postings: the same plugin and the same isolation suites cover it.
- **Billing reuses B10.** An employer is a buyer with a GSTIN and gets invoices through `BillingService` exactly like a college.
- **The registry still exists**: it is the `Tenant` collection itself (a platform model), whose `employer` block holds the verification state that platform staff review (section 9).

Rules that keep the kinds apart:

- **N1.** Every existing route keeps its default `scope: 'college'`, so an employer host gets `404` on every college route; employer routes declare `scope: 'employer'` and are `404` on a college or the platform host. `requireScope` gains the value `'employer'` (one line in `http/registry.ts`; a change to the request pipeline, listed in section 14).
- **N2.** Employer slugs start with `emp-`, and college slugs may not; the platform console refuses both mix-ups. A student can never mistake an employer's host for a college's.
- Two new roles live only in employer tenants: `EMPLOYER_ADMIN` (recruiter seats, billing, the employer's profile) and `RECRUITER` (postings and candidates). **N3.** Both are in `MFA_REQUIRED_ROLES`: they open résumés, so TOTP is mandatory. College roles cannot be assigned in an employer tenant, and employer roles cannot be assigned in a college.

The tenant model change is one block next to `kind`: the `'employer'` enum value, the `network` block (section 2) and the `employer` block (section 9).

### 2. The college's consent: a switch per capability, off by default

`Tenant.network = { alumniDiscovery: false, employerAccess: false, credentials: false, termsVersion: null, changedBy: null, changedAt: null, blockedEmployers: [] }`.

- **N4.** All three are off for every existing and new college (a migration writes `false` explicitly). Only a `COLLEGE_ADMIN` with TOTP may switch them (`network:manage` on Admin › Network), and switching on records the admin, the time and the network terms version (`NETWORK_TERMS_VERSION = 1`) the college accepted; every change is audited (`network.switched`).
- **N5.** Cross-college reads take the list of participating colleges from the `Tenant` collection at query time (not a cache), so switching off hides the college from every other tenant on the next request. A college with `alumniDiscovery` off is neither searchable nor able to search; with `employerAccess` off, no employer can see its pool, offer it postings or read its candidates.
- Switching off never deletes anything (CLAUDE.md: never delete data when a feature is off); projections stop being read at once and are deleted by the next reconcile (section 7).
- `blockedEmployers` lets a college refuse one employer without leaving the network (section 9).

These are not entries in `FEATURES`: a feature switch is "plan ∧ college choice" and its default can be on; this consent must default to off and record who accepted which terms.

### 3. The member's consent

Two new purposes in `CONSENT_PURPOSES`, both `{ version: 1, required: false }`:

- `network_discovery`: "Members of other colleges on CampusLink can find me (the fields I choose) and ask me for help."
- `employer_visibility`: "Verified employers that my college approved can count me in their totals, and see the résumé and readiness I share when I apply to their postings."

- **N6.** Opt-in only: no default, no pre-ticked box, nothing granted at sign-up; asked on the network settings screen and when a student first applies to a posting-backed drive. Granting one does not grant the other.
- **N7.** Revocable at any time from Settings › Privacy (`PUT /me/consents`), with effect as described in section 7. Withdrawal is recorded as a new consent record (records are kept on erasure, as today).
- **N8.** Never for minors. `ConsentService.set` refuses either purpose for a member with `adultOn` in the future or status `guardian_pending` (`400 NOT_FOR_MINORS`); the projection builder refuses to write one for a minor; the reconcile deletes any that exists. A member who turns 18 is not opted in automatically.
- Only `STUDENT` and `ALUMNI` members who are verified and active can grant them. Faculty, TPOs and admins are never projected.

### 4. The opt-in projections: the only member data another tenant reads

Two tenant-owned collections hold everything a cross-tenant path may read about a member. Each document lives in the member's own college (its `tenantId`), is written only by `NetworkService` inside that college's own context, and is rebuilt from the source records, so it never holds more than the sources and the member's choices allow.

**`NetworkProfile`** (one per member who granted at least one purpose; unique `{tenantId, userId}`, index `{tenantId, discoverable, company}`, `{tenantId, employerVisible, gradYear, branch}`):

| Field                              | Source                                               | Notes                                                                                            |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ref`                              | random 128-bit, base64url                            | The only id another tenant ever sees. A new `ref` on every re-grant, so a withdrawal unlinks.    |
| `userId`                           | the member                                           | Never leaves the college: no cross-tenant read selects it.                                       |
| `kind`                             | `student` or `alumni`                                |                                                                                                  |
| `name`                             | user name, as the member chooses: full or first name | First name + last initial when "first" is chosen.                                                |
| `branch`, `gradYear`               | profile                                              |                                                                                                  |
| `company`, `roleTitle`             | profile work entry (alumni)                          | Only if the member ticks it; company normalised (`lib/company.ts`).                              |
| `city`                             | profile                                              | Only if ticked; city only, never an address.                                                     |
| `skills`                           | profile                                              | At most 10 tags, only if ticked.                                                                 |
| `helpWith`                         | member's choice from `SESSION_TYPES`                 | What they will do for another college's students (alumni).                                       |
| `acceptingIntros`, `introsPerWeek` | member's choice                                      | `introsPerWeek` 1 to 5, default 2.                                                               |
| `seeking`                          | member's choice (students)                           | `internship`, `full_time` or none; used for employer counts.                                     |
| `linkedinUrl`                      | member's choice                                      | The only contact-like field, null unless the member grants it (a public profile URL, validated). |
| `discoverable`                     | `network_discovery` granted                          |                                                                                                  |
| `employerVisible`                  | `employer_visibility` granted                        |                                                                                                  |
| `consentVersions`, `refreshedAt`   | consent records, clock                               |                                                                                                  |

**N9.** It never holds: email, phone, address, roll number, photo, date of birth or `adultOn`, guardian data, marks or CGPA, academic records, readiness, offers, CTC, registrations, activity, chats or product events. A schema test pins the field list; adding a field fails it until this ADR is amended.

**`NetworkCandidacy`** (one per member and posting; unique `{tenantId, postingRef, userId}`): created only when a student registers for a drive that came from an employer posting **and** ticks "Share my résumé and readiness with <employer>" (which needs `employer_visibility`).

| Field                                 | Notes                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `ref`                                 | random 128-bit; the id the employer sees                                          |
| `userId`, `driveId`, `registrationId` | never leave the college                                                           |
| `employerTenantId`, `postingRef`      | which employer and posting it is shared with                                      |
| `name`                                | full name (an applicant gives their name to the employer, as on any application)  |
| `branch`, `gradYear`                  |                                                                                   |
| `resumeFileId`                        | the `resume_pdf` (G2) attached to the registration; never sent, only signed links |
| `stage`                               | `shared`, `shortlisted`, `not_selected`, `selected`, `withdrawn`                  |
| `sharedAt`, `withdrawnAt`             |                                                                                   |

**N10.** It holds no contact details at all: employers reach candidates only through the college's placement cell (E6). There is no field, route or notification by which an employer messages a student.

### 5. The cross-tenant paths: a closed list

Every read or write that touches another tenant goes through one of two helpers in `lib/network-scope.ts`:

- `networkScope(reason, actor, fn)`: `withPlatformScope(reason, fn)` plus a model allowlist and audit (section 6); used to read projections across colleges and to write the few mirror records.
- `networkInTenant(reason, actor, tenantId, fn)`: `runInTenant(tenantId, fn)` for the three cases where another college's own service must answer (readiness, a signed file link, a safety report), plus the same audit.

**N11.** The reason must be in the closed list `NETWORK_PATHS` below (a shared constant); any other `network:*` reason throws, and a test greps the code to check that every `networkScope`/`networkInTenant` call uses a listed constant and every listed reason is used.

| #   | Reason                        | Who calls it                             | Reads / writes (models allowed)                                                                                                    |
| --- | ----------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `network:alumni-search`       | student or alumnus, own college opted in | reads `NetworkProfile` (`discoverable`, `kind: alumni`, other participating colleges), at most 20 per page                         |
| P2  | `network:alumni-card`         | same                                     | reads one `NetworkProfile` by `ref`                                                                                                |
| P3  | `network:intro-send`          | student                                  | reads the target `NetworkProfile`, counts and writes `NetworkIntro` in the alumnus's college; the requester's copy stays at home   |
| P4  | `network:intro-reply`         | the alumnus                              | writes the reply onto the requester's `NetworkIntroOut` (status and, on accept, the contact the alumnus chose to share)            |
| P5  | `network:intro-expire`        | `network.intro_expire` job               | marks both sides expired after 7 days                                                                                              |
| P6  | `network:intro-report`        | the alumnus                              | `networkInTenant` into the requester's college: `SafetyService.report` (target `network_intro`)                                    |
| P7  | `network:pool-size`           | recruiter of an approved employer        | counts `NetworkProfile` (`employerVisible`) in colleges that allow employers and have not blocked this one; counts only            |
| P8  | `network:posting-offer`       | recruiter                                | writes `PostingOffer` (the posting's text, no personal data) into each chosen college                                              |
| P9  | `network:posting-decision`    | the college's TPO                        | writes the college's decision onto the employer's `Posting.colleges[]`; the drive is created in the college by `PlacementsService` |
| P10 | `network:posting-withdraw`    | recruiter                                | closes or edits `PostingOffer` in each college (an edit needs the college's approval again)                                        |
| P11 | `network:candidates`          | recruiter                                | reads `NetworkCandidacy` (`stage ≠ withdrawn`) for the employer's own postings                                                     |
| P12 | `network:candidate-resume`    | recruiter                                | `networkInTenant`: `FilesService.signedUrl` for the candidacy's `resumeFileId`, purpose `network_resume`, re-checked per request   |
| P13 | `network:candidate-readiness` | recruiter                                | `networkInTenant`: `ReadinessService.forMember(userId)`, computed on read, returns the score and component points only             |
| P14 | `network:shortlist`           | recruiter                                | writes a proposed `stage` onto `NetworkCandidacy`; the college's TPO publishes round results through the existing drive tools      |
| P15 | `network:hire-billing`        | `network.hire` job in the college        | writes a `BillableEvent` (`hire`, posting, college, random hire ref; no member data) into the employer tenant                      |
| P16 | `network:employer-review`     | platform staff (`platform:employers`)    | reads the applying employer's `EmployerApplication` and its first recruiter's name and work email                                  |
| P17 | `network:revenue-statement`   | `network.revenue` job (monthly)          | reads `BillableEvent` counts and amounts per college across employers; no member data                                              |

**N12.** Nothing else crosses a tenant. In particular there is no cross-tenant path to `User`, `Profile`, `Registration`, `Offer`, `AcademicRecord`, messages, files (other than P12's one signed link) or any analytics.

### 6. How the paths are enforced (changes to tenancy enforcement, E7)

1. **A model allowlist inside the scope.** `RequestContext` gains `allowModels?: string[]`. `networkScope` sets it from the path's row above; the tenant plugin's `currentScope()` throws `TenantContextError` when a platform-scoped operation names a tenant model that is not on the list. **N13.** Inside `network:alumni-search`, `UserModel.find()` throws. Platform models (`Tenant`, `NetworkCluster`) stay readable. Existing `withPlatformScope` callers pass no list and behave as before.
2. **Field allowlists on the way out.** Each reader selects a fixed field list (`NETWORK_PUBLIC_FIELDS`, `CANDIDACY_EMPLOYER_FIELDS`) and maps rows to a DTO. **N14.** A test serialises every response of P1, P2, P7, P11 and checks its keys are a subset of the DTO's (no `userId`, `tenantId`, `_id`, `email`, `phone`, `ctc`).
3. **Audit on both sides, failing closed.** **N15.** Every path writes an append-only audit row in the actor's tenant (`network.<reason>`, the actor, counts) and one in each tenant whose data it returned or changed (the actor's tenant id and kind, the count; never the filter text for a college, never member ids for the employer). If the audit write fails, the request fails. Colleges see these rows in Admin › Audit and a summary on Admin › Network ("who looked, how often").
4. **The member sees who opened their résumé.** **N16.** A candidate's network settings list each employer that opened their résumé or readiness, with the date (from the college-side audit rows).
5. **The request pipeline** gains the `'employer'` scope (section 1). No change to how the tenant is resolved from the host, to the `tid` check, to tokens or to refresh rotation, with one exception: the three public credential routes in section 12 take the college from the URL path.
6. **One new platform model**, `NetworkCluster` (a named group of colleges, such as "Hyderabad engineering", set by platform staff; no personal data), is added to `PLATFORM_MODELS`.

### 7. Revocation and the job cycle

Visibility ends by two mechanisms:

- **At once, on the request that withdraws.** **N17.** `consentService.onChange` calls `NetworkService.onConsent()`: withdrawing `network_discovery` deletes the member's `NetworkProfile` (or clears `discoverable` if `employer_visibility` remains); withdrawing `employer_visibility` clears `employerVisible` and moves every active `NetworkCandidacy` to `withdrawn` in the same request. The next cross-tenant read does not return them. **N18.** `ProfilesService.sync()` calls `NetworkService.refresh(userId)`, so a name change, suspension, deletion request or a corrected birth month is reflected in the same call. Withdrawing a candidacy alone (`DELETE /me/network/candidacies/:ref`) has the same immediate effect for that posting.
- **The guarantee: one reconcile cycle of 15 minutes.** **N19.** A timer queues `network.reconcile` for every college every 15 minutes (job id per college and window, so it runs once). It rebuilds each projection from the sources and deletes every projection whose member no longer qualifies: consent withdrawn, account not active or not verified, deleting, erased, a minor, field no longer ticked, or the college's switch off. Any path that changes the sources without calling the service (an import, a manual database fix, a bug) is corrected within 15 minutes. The test "revoking consent removes visibility within one job cycle" runs the job once with the clock moved 15 minutes and checks that every revocation route left no readable row.
- **Signed links** for résumés live 5 minutes and re-check the candidacy and consent on every request (`FilesService.signedUrl`), so a link handed out just before a withdrawal stops working at once.
- **What cannot be recalled.** A résumé an employer already downloaded stays with them. The employer terms (accepted on approval) make them a data fiduciary for it and require deletion when a candidate withdraws; the app notifies the employer (`candidate_withdrawn`, ids only). This residual risk is stated in the privacy notice and the threat model.
- **Erasure.** `NetworkService.eraseFor(userId)` deletes the member's projections, intros (both sides; the other party sees "Former member") and candidacies, and revokes their credentials (section 12). Consent records and audit rows are kept, as today.

### 8. Cross-college alumni discovery

- **Who.** A verified, adult student or alumnus who granted `network_discovery`, in a college with `alumniDiscovery` on, sees "Alumni at <company> across CampusLink colleges". The alumni shown granted `network_discovery`, are in a college with the switch on, and accept intros. **N20.** If any of the four conditions is missing (either college's switch, either member's consent), nothing is returned or the route is `403 NETWORK_NOT_ENABLED`.
- **What.** The `NetworkProfile` card: name as chosen, college name and city, branch, batch, company and role, skills, what they help with. Initials instead of a photo.
- **Requests ("intros").** A student sends a structured intro: what they want (one of the alumnus's `helpWith` types), a goal from a fixed list, and an optional note of at most 300 characters stored as plain text (`plainText()`). It follows the existing mentorship rules: one pending per pair, at most `MAX_PENDING_REQUESTS` (3) pending, expiry after `REQUEST_TTL_DAYS` (7), decline templates, the alumnus's `accepting` flag and audience. **N21.** Caps: a student sends at most `NETWORK_INTROS_PER_WEEK = 3` (counted separately from the college's own `mentorshipRequestsPerWeek`), an alumnus receives at most their `introsPerWeek` (1 to 5, default 2), and a pair that was declined cannot ask again for 30 days.
- **On acceptance** the alumnus chooses what to share with that one student: their LinkedIn link, their email, or both. It is stored encrypted (`sharedContactEnc`, `FieldCipher`, listed in `ENCRYPTED_COLLECTIONS`) on both sides and shown only to the requester; erasure of either side deletes it. Nothing else opens: no cross-college chat, booking or video room in this phase.
- **Abuse.** The alumnus can report an intro; the report goes to the requester's college's safety queue (P6). **N22.** Two reports from different alumni pause the requester's network access until their college reviews them; the `network` limiter allows 30 searches an hour per member.
- **Notifications** carry the first name, the college name and the request type, never the note (`network_intro_received`, `network_intro_accepted`, `network_intro_declined`; category `requests`).

### 9. Employer verification, limits and abuse controls

**Becoming an employer.** `POST /employers/apply` on the platform host (public, `bot: true`, limiter `employerApply`: 3 per IP per day) creates a pending employer tenant and its first `EMPLOYER_ADMIN`. The `employer` block on the tenant: `{ legalName, domain, gstin, status: applied | verified | approved | suspended | rejected, domainVerifiedAt, dnsToken, gstinCheckedAt, approvedBy, approvedAt, reviewNote }`.

1. **Work email at the domain.** **N23.** The applicant's email must be at `domain`; free mail and disposable domains (a shipped list: gmail.com, yahoo.\*, outlook.com, hotmail.com, rediffmail.com, proton.me and others) are refused. The address is confirmed with a code from `OtpService` (existing purpose list gains `employer_email`).
2. **Domain control.** A DNS TXT record `campuslink-verify=<token>` on the domain, looked up with `node:dns` (no third party). Every later recruiter must have an address at a verified domain.
3. **GSTIN.** **N24.** Format and check digit validated in code (15 characters, state code 01 to 38, embedded PAN, mod-36 checksum); the legal name and GSTIN are then checked by a person on the public GST portal. The app does not call any GST API (no new third party).
4. **Manual approval.** Platform staff with the new `platform:employers` permission approve or reject on the platform host; audited (`employer.approved`). **N25.** Until approved, an employer can draft postings but cannot publish, see any pool size, or read anything in any college.

**Limits** (constants in `packages/shared/src/constants/network.ts`, enforced in `EmployersService`; **N26** tests each):

| Limit                           | Value                                             |
| ------------------------------- | ------------------------------------------------- |
| Recruiter seats per employer    | 10 (a deal may raise it)                          |
| Open postings at once           | 10                                                |
| New postings per calendar month | 20                                                |
| Colleges per posting            | 50, or one cluster                                |
| Pool-size queries               | 60 an hour per employer                           |
| Candidate list reads            | 120 an hour per employer                          |
| Résumé links                    | 200 a day per employer; each link lives 5 minutes |
| Readiness reads                 | 200 a day per employer                            |
| Applications from one IP        | 3 a day                                           |

**Abuse controls.**

- **N27.** A college can block an employer (`network.blockedEmployers`); from the next request the employer sees nothing of that college and its postings there close. Three blocks from different colleges within 90 days suspend the employer automatically pending platform review.
- **N28.** Students and staff can report a posting (`SafetyService` target `posting`). Three open reports from different members hide it in that college until a moderator decides.
- Suspending an employer (status `suspended`, or the tenant suspended) stops every path at once: each path checks the employer's status on the request.
- Pool counts resist differencing: **N29.** below 5 they read `<5` (`suppress()`), above that they are rounded down to a multiple of 5; filters come only from fixed lists (college, branch, batch, `seeking`, at most 3 skills).

### 10. What an employer sees, and what is never visible

| Stage                                        | The employer sees                                                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before approval                              | The names and cities of participating colleges (public anyway). Nothing else.                                                                                                           |
| Pool (before any posting is approved)        | Counts of `employerVisible` members per college, branch, batch and `seeking`, suppressed and rounded. No names, no rows.                                                                |
| A college reviews the posting                | Its decision (approved, declined with a reason chosen from a list, or pending).                                                                                                         |
| Candidates (students who applied and shared) | For each `NetworkCandidacy`: name, college, branch, batch, the résumé the student attached (signed link), the readiness score and its component points computed on read, and the stage. |
| A hire                                       | The stage `selected` once the college publishes it.                                                                                                                                     |

**N30. Never visible to an employer**, through any route: phone numbers, email or postal addresses; the exact CTC of any offer, including its own; any other offer, registration or application of a candidate (count or company); marks, CGPA and academic records beyond what the student wrote on their own résumé; the readiness of anyone who has not shared a candidacy with that employer (including everyone in the pool counts); anything about a minor; photos, roll numbers, guardian data, chats, activity, product events, other employers' postings. Readiness stays computed on read and is never stored, also on the network side (CLAUDE.md, readiness).

### 11. Postings, drives and pricing

- An employer writes a `Posting` (title, role, location, type, CTC range as the employer chooses to state it, eligibility as text and structured branches and batches, closing date) and offers it to chosen colleges or one cluster (P8).
- **N31.** Each college's TPO (`network:manage` or `placements:manage`) approves or declines it in Admin › Network. Only an approved posting is visible to that college's students, and approving creates a `PlacementDrive` in the college through `PlacementsService` (Prompt 1 B7), with `source: { employerTenantId, postingRef }`. From then on the drive is the college's: its eligibility checks, registrations, round results and offers work as today. Declined or pending postings are invisible to students.
- Students apply by registering for the drive. Registration offers the "share with <employer>" tick (section 4).
- **Pricing hooks.** `EMPLOYER_PRICING` (platform setting, like plans): `perPosting`, `perDrive`, `perHire` in paise, any of them zero, and `revenueShareBps` (default from the platform setting; a college's deal may override it). Billable moments are recorded as `BillableEvent` in the employer tenant with a unique key (`posting:<ref>`, `drive:<college>:<ref>`, `hire:<college>:<hireRef>`), so retries never double-charge: a posting on its first approval, a drive on each college's approval, a hire when the college verifies an offer from that drive (P15). `BillingService` invoices employers monthly like colleges (B10). The monthly revenue statement per college (P17) shows its share; the payout itself happens outside the app (bank transfer), like giving.

### 12. Verified credentials

- **Data model.** W3C Verifiable Credentials Data Model 2.0, secured as a JWT per "Securing Verifiable Credentials using JOSE and COSE" (`typ: vc+jwt`, `alg: EdDSA`, Ed25519), signed and verified with `jose` (already a dependency). The issuer is the college as `did:web:<root>:<slug>`, whose DID document is served at `https://<root>/<slug>/did.json` and lists its public keys (active and retired). No third party is involved.
- **Credential types.** `PlacementOfferCredential` (company, role, offer type, batch, verified on; never the CTC), `ReadinessMilestoneCredential` (a milestone such as "readiness 80 reached" and the date; never the score itself), `MentorCertificateCredential` (G6: academic year, sessions, mentees, asks, events) and `MentorshipRecognitionCredential` (alumnus of the month and the month).
- **N32.** Issued only when the member asks ("Get a verified credential"), only from a verified source record, never for a minor, only in a college with `network.credentials` on. The subject is named as the member chooses (full or first name); there is no email, phone, roll number or student DID in the credential.
- **Storage.** `Credential` (tenant-owned): `publicId` (random 128-bit), `userId`, `type`, `claims`, `jwt`, `kid`, `statusIndex`, `status: active | revoked`, `revokedReason`, `issuedAt`.
- **The issuer key.** **N33.** One Ed25519 key pair per college, generated in the app (`jose.generateKeyPair('EdDSA')`), the private key stored as PKCS#8 encrypted with the existing `FieldCipher` in `IssuerKey.privateKeyEnc` (listed in `ENCRYPTED_COLLECTIONS`, so `rotate-field-key` re-encrypts it), `kid`, `publicJwk`, `status: active | retired | compromised`. It is decrypted only inside `CredentialsService.sign()`, never returned, logged, exported or audited in clear.
- **Does this count as an encryption change under E7?** The cipher, its key ring and its rotation tooling do not change, so the encryption scheme itself is unchanged. But it adds a new class of key material (signing keys) and a new encrypted collection, so I treat it as within E7 and ask for approval with this ADR rather than as routine.
- **Rotation.** Yearly by the `credentials.rotate` job, or on demand by a `COLLEGE_ADMIN` with TOTP (`credentials:manage`, audited): a new key becomes active, the old one `retired` (still published, verifies, never signs). If a key is marked `compromised`, it is removed from the DID document and every active credential signed with it is re-signed with the new key under the same `publicId`, so links keep working. Rotating `FIELD_ENCRYPTION_KEY` re-encrypts `privateKeyEnc` like any other field (runbook).
- **Revocation.** **N34.** A credential is revoked when its source stops standing (an offer un-verified, a certificate revoked), when the member or an admin revokes it, or when the member is erased (the claims and name are deleted; only the status remains). Revocation is published through a W3C Bitstring Status List per college (131,072 entries, indexes assigned at random) at `https://<root>/<slug>/credentials/status/<n>`, itself a signed VC with `Cache-Control: max-age=300`; the verify page reads the database and shows it at once.
- **The public verify page `/{tenant}/verify/{id}`.** Served by the API on the root host (`https://<root>/<slug>/verify/<publicId>`), so it matches the `did:web` path form. **N35.** It shows the college name and logo, the credential type, the subject's name as issued, the claims, the issue date, the status (valid, revoked, issuer key compromised) and the result of checking the signature against the published key, plus the raw `vc+jwt` to download. It never shows contact details, a CTC, other credentials of the member, or anything about a minor (minors have none). Unknown ids, revoked-and-erased ones and ids of another college under this slug are a plain 404. `Cache-Control: no-store`, `X-Robots-Tag: noindex`, limiter `verifyPublic` (60 a minute per IP). The G6 check (`/verify/certificates/:code`) keeps working; a certificate can be upgraded to a credential.
- **Tenancy note.** These three public routes (`/:slug/verify/:id`, `/:slug/did.json`, `/:slug/credentials/status/:n`) resolve the college from the path through the same `findTenantBySlug` cache and then run inside `runInTenant` for that college only; they are read-only and kind `college` only. This is the second way of resolving a tenant (the first is the host), limited to these routes, and is listed for approval in section 14.

### 13. Data residency (India)

- **N36.** Every new collection lives in the same MongoDB replica set in `ap-south-1` with DR in `ap-south-2` (`docs/deployment.md`); résumés stay in the college's storage and are served only through signed links; nothing is copied to an employer's systems by the app.
- No new external service: DNS lookups use `node:dns`; GSTIN is checked by a person; signing uses `jose` in-process. No AI is used by any G12 path.
- Only employers with an Indian GSTIN can be approved, so every employer is an Indian legal entity bound by the DPDP Act for what it downloads. A recruiter who opens the app from abroad sees what the app shows; the employer terms forbid moving downloaded résumés outside India except as the DPDP Act allows.
- Public credentials contain only the claims listed in section 12, so anyone, anywhere, can verify them without receiving more.

### 14. What this ADR asks approval for (E7)

| Area                        | Change                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens and refresh rotation | **None.** Recruiters use the existing per-tenant sign-in; `tid` is the employer tenant.                                                                                                                                                                                                                                   |
| Tenancy enforcement         | (a) `Tenant.kind` gains `employer`; (b) `requireScope` gains `'employer'`; (c) `networkScope`/`networkInTenant` and the closed path list; (d) the `allowModels` check in the tenant plugin; (e) `NetworkCluster` in `PLATFORM_MODELS`; (f) the college resolved from the URL path for the three public credential routes. |
| Encryption                  | No change to `FieldCipher`. New encrypted fields: `IssuerKey.privateKeyEnc`, `NetworkIntro.sharedContactEnc`, `NetworkIntroOut.sharedContactEnc`.                                                                                                                                                                         |
| Auth roles                  | New roles `EMPLOYER_ADMIN`, `RECRUITER`, both MFA-required; new purpose `employer_email` for `OtpService`.                                                                                                                                                                                                                |
| New third parties           | **None.**                                                                                                                                                                                                                                                                                                                 |

## Consequences

- The only member data another tenant can read is two projections the member chose to fill, through 17 named and audited paths; adding an 18th means amending this ADR.
- Colleges control everything: nothing happens until they switch it on, they approve every posting before students see it, they publish round results and verify offers, and they can block an employer.
- Employers get a real product (pool sizes, a funnel, candidates' résumés and readiness) without ever holding a student's phone or email through the app; the placement cell stays the channel, which is how Tier-3 colleges already work.
- Revocation is immediate on the normal path and guaranteed within 15 minutes on every path; what an employer already downloaded cannot be recalled, which the privacy notice says.
- Readiness keeps its rule (computed on read, never stored): employers get it per consenting candidate at view time, through the college's own service.
- Credentials are verifiable offline with only the college's public key, survive key rotation, and die with erasure.
- Cost: one more tenant kind to keep out of college routes (a test walks the registry), a plugin check on every platform-scoped operation (a list lookup), a 15-minute reconcile per participating college, and audit rows per cross-tenant request.
- Merge note for the main session: `Role`, `ROLE_PERMISSIONS`' keys and `MFA_REQUIRED_ROLES` in `packages/shared/src/roles.ts` have no slot markers; the two employer roles need one block directly after `STUDENT` in each.

## Tests that prove each claim

| Claims                 | Test                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1, N2, N3             | `test/employers.test.ts`: an employer token on every registry route with `scope: 'college'` gets 404, and a college token on every `employer` route gets 404 (walks the registry); slug prefixes; employer roles cannot sign in without TOTP.                                                                                                                                             |
| N4, N5                 | `test/network.test.ts`: switches default off after the migration and for a new college; only an admin with TOTP switches; audited with the terms version; switching off hides the college on the very next request without a job run.                                                                                                                                                     |
| N6, N7, N8             | `test/network.test.ts`: no purpose granted at sign-up; granting one does not grant the other; withdrawal recorded; a minor and a `guardian_pending` member get `NOT_FOR_MINORS`; the builder and the reconcile delete a minor's projection.                                                                                                                                               |
| N9, N10                | `test/network.test.ts` (schema pin): the exact field lists of `NetworkProfile` and `NetworkCandidacy`; no contact field unless `linkedinUrl` is granted.                                                                                                                                                                                                                                  |
| N11, N12               | `test/network-paths.test.ts`: every call site uses a listed reason, every listed reason is used, an unlisted `network:` reason throws.                                                                                                                                                                                                                                                    |
| N13                    | `test/isolation/network.test.ts`: inside each path, any model outside its allowlist throws (`User`, `Profile`, `Offer`, `Registration`, `File`).                                                                                                                                                                                                                                          |
| N14, N30               | `test/network.test.ts`: response keys of P1, P2, P7, P11, P12, P13 are within the DTOs; seeded phone, email, exact CTC, other offers, marks and a non-consenting member's readiness never appear in any employer response.                                                                                                                                                                |
| N15, N16               | `test/network.test.ts`: each path writes the actor-side and target-side audit rows; a failing audit write fails the request; the member sees the employers that opened their résumé.                                                                                                                                                                                                      |
| N17, N18, N19          | `test/network-revocation.test.ts`: for each revocation route (either consent, candidacy withdrawal, erasure, suspension, a corrected birth month, field un-ticked, college switch off, employer blocked) the next read returns nothing, and the reconcile with the clock moved 15 minutes leaves no readable row even when the source was changed behind the service's back.              |
| N20, N21, N22          | `test/network.test.ts`: the four opt-in conditions; one pending per pair, 3 pending, 3 a week, the alumnus's weekly cap, 30 days after a decline, 7-day expiry; two reports pause access; the `network` limiter.                                                                                                                                                                          |
| N23 to N29             | `test/employers.test.ts`: free-mail refused, email code, DNS token (stubbed resolver), GSTIN check digit (valid and invalid samples), nothing before approval, every limit in the table at its edge, college block, three blocks suspend, three reports hide a posting, rounding and `<5`.                                                                                                |
| N31                    | `test/network.test.ts` and `test/placements.test.ts`: a posting is invisible until approved; approval creates one drive; billable events are unique per key.                                                                                                                                                                                                                              |
| N32 to N35             | `test/credentials.test.ts`: issuance rules; the JWT verifies with the published key and fails when tampered; rotation keeps old credentials valid; a compromised key re-signs; revocation in the status list and on the page; erasure; the page shows no contact, CTC or minor data; 404 for unknown and other-college ids; the private key never appears in any response, log or export. |
| N33                    | `test/field-rotation.test.ts`: the new `…Enc` fields are listed and re-encrypted.                                                                                                                                                                                                                                                                                                         |
| N36                    | Review item in `docs/deployment.md` (no new region or service); `test/network.test.ts` checks no G12 path calls `safeFetch` or an AI provider.                                                                                                                                                                                                                                            |
| Every non-network path | `test/isolation/network.test.ts`: the existing cross-tenant suites are extended with an employer tenant and a second college for every non-network route (read, write, update, delete, search all refused).                                                                                                                                                                               |
| Privacy                | `test/privacy.test.ts`: `exportFor`/`eraseFor` registered as `network`, `employers` and `credentials`.                                                                                                                                                                                                                                                                                    |

## Implementation notes (G12 build, after approval)

Where the build differs from the text above, and why; none widens what crosses a college.

- **Member consent (§3, N7).** The two purposes are in `NETWORK_CONSENT_PURPOSES`, recorded in the same append-only consent log, but not in `CONSENT_PURPOSES`: sign-up and Settings › Privacy list every key of that map with strings in the core language files, so the network's purposes are offered, granted and withdrawn on the Network screen (`PUT /network/consents`) instead. They are in the member's data export.
- **The work inbox (N23).** Proved by the set-password link sent to the address (the proof the platform already uses for a new college's admin), not by a separate `employer_email` code; `OtpService` is unchanged.
- **Shared contacts (§8, §14).** Encrypted only on the student's copy (`NetworkIntroOut.sharedContactEnc`); the alumnus's own copy has no need of it.
- **Résumé links (P12).** A five-minute HMAC link on the employer's host, bound to the employer, the recruiter and the candidacy, checked again on every request (candidacy, the college's approval, consent read in the college); the file is read through `FilesService.read` inside the college's context. `FilesService.signedUrl` re-checks access as a member of the college, which an employer is not.
- **Posting reports (N28).** Counted on the college's `PostingOffer` (three different members hide it; Admin › Network keeps or removes it) rather than as a `SafetyService` target, whose queue is keyed to members of the same college.
- **Withdrawn candidates (§7).** The employer sees how many stopped sharing on each posting instead of a `candidate_withdrawn` notification (which would have needed a read of the employer's tenant from the college's job).
- **The switches (N4).** Off is the schema default, so there is nothing to migrate; turning a switch on or off also runs the college's reconcile at once.
- **Roles (§1).** `EMPLOYER_ADMIN` and `RECRUITER` sit in `Role`, `ROLE_PERMISSIONS` and `MFA_REQUIRED_ROLES` directly after `STUDENT` (as approved); `TENANT_ROLES` excludes them, and college admins never receive employer permissions (`EMPLOYER_PERMISSIONS`).
