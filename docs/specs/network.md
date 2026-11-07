# The network: alumni across colleges, the recruiter portal and verified credentials (prompt 2, G12)

The design and every claim it makes are in [ADR 0014](../adr/0014-cross-college-network-and-employer-access.md) (N1 to N36); the threats are in `docs/threat-model.md` › "The network". This spec says where each part lives and how to use it.

Modules: `apps/api/src/modules/network/` (projections, discovery, intros, the college's switches), `modules/employers/` (employer accounts, postings, pools, candidates, billing; the college's side in `college-postings.service.ts`), `modules/credentials/` (issuer keys, VC-JWT, the public pages), `lib/network-scope.ts` (the only way across a college). Web: `features/network/` and `features/recruiter/` (one lazily loaded module, `features/network/screens.ts`), strings in the `network` pack (en, te, hi).

## Who is who

| Who                                                        | Where                              | Can                                                                                                                     |
| ---------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Student or alumnus (`network:discover`, `credentials:own`) | `/network` on the college host     | Opt in, choose what shows, find alumni of other colleges, send and answer intros, share with employers, get credentials |
| TPO, college admin (`network:manage`)                      | Admin › Network                    | Review postings (approve as a drive or decline), block employers, review paused members, see who looked                 |
| College admin (`tenant:settings`, TOTP)                    | Admin › Network                    | Turn the three switches on or off, accepting the network terms                                                          |
| College admin (`credentials:manage`)                       | Admin › Network                    | Rotate the signing key, withdraw a leaked key, revoke a credential                                                      |
| `EMPLOYER_ADMIN` (TOTP)                                    | `/recruiter` on `emp-<name>` hosts | Everything below, plus recruiters (10 seats), domain verification, billing                                              |
| `RECRUITER` (TOTP)                                         | `/recruiter`                       | Postings, the pool, candidates who shared                                                                               |
| `SUPER_ADMIN` (`platform:employers`)                       | `/platform/employers`              | Approve, reject, suspend, reinstate employers; clusters; the colleges' revenue share                                    |

Employers are tenants of kind `employer` (ADR 0014 §1). Every existing route is `scope: 'college'` and answers 404 on an employer host; employer routes are `scope: 'employer'`.

## The college's consent

`Tenant.network`: `alumniDiscovery`, `employerAccess`, `credentials`, all off (the schema default; nothing to migrate). Turning one on needs `acceptTerms` (records `NETWORK_TERMS_VERSION`, who and when) and runs the reconcile at once, so members who already opted in appear (or disappear) immediately. Participating colleges are read from the `Tenant` collection on every cross-college request, never from a cache.

## The member's consent

`NETWORK_CONSENT_PURPOSES` (`packages/shared/src/consent.ts`): `network_discovery` and `employer_visibility`, version 1, recorded in the same append-only consent log as every other purpose but kept out of `CONSENT_PURPOSES`, so sign-up never offers them and they are granted and withdrawn only on the Network screen (`PUT /network/consents`). Refused for members under 18 (`NOT_FOR_MINORS`) and for staff. The member's choices (`NetworkPrefs`: name style, company, city, skills, LinkedIn link, what they help with, intros a week, what they look for) are kept when consent is withdrawn; the projection is not.

## The projections (the only member data that crosses)

- `NetworkProfile` (one per member who granted a purpose, in their own college): the fields in ADR 0014 §4, rebuilt by `NetworkService.refresh()` on every settings change, consent change and `ProfilesService.sync()`, and by the reconcile. A new random `ref` on every re-grant.
- `NetworkCandidacy` (one per student and posting): created when a student registered for a drive that came from an employer posting shares it (`POST /network/candidacies`); name, branch, batch, the registration's résumé file id, the stage. No contact field.

Readers select `NETWORK_PUBLIC_FIELDS` / `CANDIDACY_EMPLOYER_FIELDS` and map to `NetworkCard` / `CandidateView`.

## The named paths

`NETWORK_PATHS` (17, `packages/shared/src/constants/network.ts`) and `NETWORK_PATH_MODELS` (`lib/network-scope.ts`). `networkScope(reason, actor, fn, touched)` runs `fn` in a platform scope limited to the path's models (the tenant plugin throws on any other model, and on `$lookup`/`$unionWith`/`$graphLookup`), then writes an audit row in the actor's tenant (counts only) and in every touched tenant (`meta.by`, `meta.byKind`, the count; for résumé and readiness views, the candidacy ref as `targetId`). `networkInTenant` runs another college's own service in its context (P6 reports, P12 résumés, P13 readiness). `test/network.test.ts` greps the code: every listed reason is used and no other.

## The reconcile

`network.reconcile` (one job per college every 15 minutes, `NetworkService.enqueueReconcile`, ticked by `server.ts`): rebuilds every projection and deletes those that no longer qualify; withdraws candidacies whose consent, registration, college switch or employer standing went away, and follows the college's published results (`selected`, `not_selected`); bills hires (verified offers on posting drives, P15); expires intros older than seven days on both sides; revokes credentials whose source stopped standing; rotates the issuer key after `ISSUER_KEY_ROTATE_DAYS` (365).

## Alumni discovery and intros

- `GET /network/alumni?company=&q=&branch=&cursor=` (P1, 20 a page, the `network` limiter: 30 an hour), `GET /network/alumni/:ref` (P2).
- `POST /network/intros {ref, helpWith, goal, note}` (P3): students only; 3 a week, 3 pending, one pending per pair, 30 days after a decline, the alumnus's own weekly number (1 to 5, default 2), only types the alumnus helps with. The alumnus is notified in their own college (`network_intro_received`: name, college, type; never the note).
- `POST /network/intros/:id/accept {share: ['linkedin' | 'email']}` / `decline {reason}` (P4): the chosen contact is encrypted (`NetworkIntroOut.sharedContactEnc`, `ENCRYPTED_COLLECTIONS`) on the student's copy only and shown only to them. `network_intro_answered` to the student.
- `POST /network/intros/:id/report` (P6): recorded in the student's college; two different reporting alumni pause the student's network access until a TPO resumes it (Admin › Network).

## The recruiter portal

1. **Applying** (`/employers/apply` on the platform host, `POST /employers/apply`, 3 a day per address, bot check): company, legal name, domain (no free or disposable mail), GSTIN (shape, state code and check digit; `isValidGstin`), the `emp-` address, the applicant's work email at the domain. The account is created with an unusable password and the set-password link goes to the work address: using it proves the inbox (the same proof as for a new college admin). Sign-in then needs TOTP.
2. **Domain**: a DNS TXT record `campuslink-verify=<token>` (`POST /employer/verify-domain`, `node:dns`). Inbox and domain proved → `verified`.
3. **Approval** (`/platform/employers`): a person checks the GSTIN and legal name on the public GST portal and approves (P16 shows the applicant's name and work email). Until then nothing is visible.
4. **Postings**: drafts (`POST /employer/postings`), offered to chosen colleges or a cluster (P8; at most 50 colleges, 10 open postings, 20 new a month). Each college approves (a placement drive is created through `PlacementsService.create`) or declines (P9). Edits go back to every college; closing withdraws pending offers (P10).
5. **The pool** (`GET /employer/pool`, P7, 60 an hour): counts of `employerVisible` members per college, filtered by branch, batch, what they look for and up to three skills; `<5` and rounded down to five (`poolCount`).
6. **Candidates** (`GET /employer/postings/:id/candidates`, P11, 120 an hour): the shared candidacies of colleges that approved the posting, plus the number who stopped sharing. Résumé: `POST /employer/candidates/:ref/resume-link` (P12, 200 a day) returns a five-minute link bound to the employer, the recruiter and the candidacy, checked again (candidacy, approval, consent) on `GET /employer/resume/:token`. Readiness: `GET /employer/candidates/:ref/readiness` (P13, 200 a day), computed now by the college's `ReadinessService`, never stored. Shortlist proposals: `PUT /employer/candidates/:ref/stage` (P14); the college publishes results through its drive tools.
7. **Abuse controls**: colleges block employers (`POST /admin/network/blocks`; three colleges within 90 days suspend the employer); three reports from different members hide an approved posting until a moderator keeps or removes it.

## Pricing hooks

`EMPLOYER_PRICING_DEFAULT` (per posting, per drive, per hire in paise; `revenueShareBps`, the colleges' share, 20%). `BillableEvent` (employer tenant, unique key, no member data): a posting on its first approval, a drive per approving college, a hire per verified offer (the key is a hash of the offer id). `GET /employer/billing`; `GET /platform/network/revenue?month=YYYY-MM` (P17) gives each college's counts, amounts and share. Invoicing employers through `BillingService` and paying colleges their share happen outside these hooks (follow-up).

## Verified credentials

- W3C VC Data Model 2.0 secured as `vc+jwt` (EdDSA, Ed25519, `jose`), issued by `did:web:<root>:<slug>`; payload `@context`, `id` (the verify URL), `type`, `issuer`, `validFrom`, `credentialSubject {type, name, claims}`, `credentialStatus` (W3C Bitstring Status List entry, random index of 131,072).
- Types and claims: `PlacementOfferCredential` (company, role, batch), `ReadinessMilestoneCredential` (60 or 80 of 100, reached on), `MentorCertificateCredential` (G6 counts), `MentorshipRecognitionCredential` (alumnus of the month). Never a CTC, contact details or a student identifier.
- `GET/POST /credentials`, `DELETE /credentials/:id`; Admin: `GET /admin/credentials`, `POST /admin/credentials/rotate`, `POST /admin/credentials/keys/:kid/compromised` (re-signs live credentials under the same link), `POST /admin/credentials/:id/revoke`.
- Public, on the root host, the college from the path (`credentialTenantFromPath`; on a college host the path must name that college): `/{slug}/verify/{id}` (HTML, `no-store`, `noindex`, 60 a minute), `/{slug}/verify/{id}.jwt`, `/{slug}/did.json`, `/{slug}/credentials/status/1` (signed, cached five minutes). Vite proxies these paths to the API; production nginx and the staging edge need the same location (follow-up for the main session, which owns `deploy/`).
- The private key: PKCS#8, encrypted with `FieldCipher` (`IssuerKey.privateKeyEnc`, `ENCRYPTED_COLLECTIONS`), decrypted only in `sign()`.

## Privacy

Registered with `privacyService`: `network` (choices, projection, intros both ways, network consent history; erasure leaves "Former member" on the other side), `networkCandidacies`, `employers` (postings a recruiter created; nothing personal is stored on them), `credentials` (erasure revokes and strips the claims, the name and the JWT; only the status stays). Consent records and audit rows are kept.

## Product events

`network_intro_sent`, `network_intro_accepted`, `posting_published`, `posting_approved`, `candidacy_shared`, `credential_issued` (ids and enum values only).

## Tests

`test/network.test.ts` (N4 to N22: switches, consent, the field pin, discovery and its audit, intros and caps, the path list and the model allowlist, revocation by every route and by the reconcile, Admin › Network, privacy), `test/employers.test.ts` (N1 to N3 and N23 to N31: applying, the kind boundary walked over the registry, TOTP, verification and approval, recruiters, postings to drives, pool rounding, candidates without contact or CTC, résumé links, readiness on read, withdrawal, hires billed once, limits, reports, blocks), `test/credentials.test.ts` (N32 to N35), `test/isolation/network.test.ts` (tokens across kinds on every route; every network collection closed to other tenants; other colleges' admins), `test/privacy.test.ts`, `test/billing.test.ts` (read-only allowlist), `test/permissions.test.ts`, `packages/shared/src/constants/network.test.ts`, `apps/web/e2e/network.spec.ts` and `e2e/recruiter.spec.ts` (with axe).
