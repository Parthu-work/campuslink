# Reach (prompt 2, G9)

Goal: CampusLink installs from the Play Store, signs in with the college's own accounts, shows up in members' calendars, and stays in step with the college's records without anyone re-uploading a spreadsheet.

## The calendar feed

Every member can make a **secret calendar address** (Settings › Notifications › Calendar feed): `https://<college>/api/v1/calendar/<token>.ics`, with a `webcal://` link for Apple and phone calendars and Google Calendar's "add by URL" page.

- **What it holds** (30 days back to 180 days ahead, `CALENDAR_PAST_DAYS`, `CALENDAR_AHEAD_DAYS`): their mentorship sessions (with the other person's first name; cancelled ones marked cancelled so calendars remove them), the events they RSVPed "going" to, and, for students with placements on, the drives they registered for and the registration deadlines of open drives they are eligible for. Each fact comes from the module that owns it (`SessionsService.calendarFor`, `EventsService.calendarFor`, `PlacementsService.list`). Fixed words are in the member's language.
- **The token** is 32 random bytes; only its SHA-256 is stored (`calendarfeeds`, unique per member). It is shown once. "Get a new link" replaces it and the old one is a 404 at once; "Turn off" deletes it. Suspended or deleting members' feeds are a 404. The address works only on the member's own college's host.
- **Not an auth token**: it reads the member's calendar and nothing else, and never signs anyone in. Served `private, max-age=900`, rate-limited like search; the last read is recorded at most hourly.
- UIDs are stable per item, so calendars update events rather than duplicating them; RFC 5545 escaping and 75-octet folding (`lib/ics.ts`).

## The scheduled roster sync

From a completed roster import of a Google Sheet or REST source, admins (`imports:manage`) choose "Keep this list in sync" (daily, or weekly on a day). One sync per college (`rostersyncs`).

- An hourly tick (`server.ts`) queues one job per college a day from 02:00 India time (`imports.roster_sync`, job id per day); a weekly sync runs only on its day. Each run is claimed per day, so a retry or a second job does nothing.
- The run reads the source with the stored mapping and **diffs it with the import's own rules** (`ImportsService.diffRoster`: claimed records keep what members proved, except the guardian's number).
- **No change**: recorded, nothing else. **5% of the rows or fewer change** (`ROSTER_SYNC_APPROVAL_SHARE`): a normal import job (`startStored`: the same audit, report and rollback). **More than 5%**: the rows are stored (7 days, `ROSTER_SYNC_PENDING_DAYS`) with the diff (counts and up to 50 roll numbers with the changed field names, never values); college admins are notified (`roster_sync_review`). **Approve** applies exactly those rows; **Discard** deletes them. A source error is recorded and shown.
- A REST source's bearer token is stored encrypted with the existing field cipher and is part of key rotation. Pause, resume, reschedule, sync now and stop are audited.

## Single sign-on

Per college and optional: **Google Workspace** and **Microsoft Entra ID** through OpenID Connect, authorization code with PKCE (Admin › Sign-in options, `tenant:settings`).

- **Settings**: client ID, client secret (encrypted with the existing field cipher, never returned, rotated with the field key) and, for Microsoft, the college's directory ID (never "common"). It can be turned on only when the college has email domains (`allowedEmailDomains`).
- **Start** (`GET /auth/sso/:provider/start`): a single-use attempt (`ssostates`, ten minutes) with a random state, nonce and PKCE verifier; the state is also set as a `cl_sso` cookie (HttpOnly, SameSite=Lax, path `/api/v1/auth/sso`), so the callback is bound to the browser that started it. Google gets `hd` (the domain), Microsoft `domain_hint`.
- **Callback**: the state must match the cookie and an unused attempt; the code is exchanged at the provider's fixed token endpoint (no discovery fetch) with the client secret and the verifier; the **ID token is verified with jose** against the provider's keys for issuer, audience (the client ID), signature (RS256), expiry and age, and the **nonce**. Google also needs `email_verified` and a hosted domain (`hd`) that is one of the college's; Microsoft needs `tid` to be the college's directory and the address to be in its domains.
- **Linking**: by the provider's stable subject id if linked before, else by email. An existing account is linked (`ssoIdentities`); if its address had never been confirmed (someone may have registered it in advance), its password is removed and its sessions revoked. Someone without an account finishes sign-up on `/sign-up/sso` (role, birth month, terms; a minor waits for a guardian as usual) with a single-use ticket (`ssopendings`, 15 minutes, used up only when the account exists) carried in the URL fragment, never sent to the server in a URL.
- **The session is the same** as a password sign-in (`AuthService.signInExternal`, `createSession`): suspended members are refused, and members with two-factor authentication, every admin, still enter their code (the existing MFA ticket, handed to the sign-in page as `#mfa=`). Roster verification still applies to new accounts.
- Failures come back to `/sign-in#sso_error=<reason>` (cancelled, failed, domain, suspended, unavailable, expired) and are audited (`sso.failed`, `sso.linked`).

## The Android app

A Trusted Web Activity built with Bubblewrap from `apps/android/twa-manifest.json`: one platform app whose start screen, on the bare domain, lets the member type their college's address (remembered on the device); every college host is a trusted origin. `/.well-known/assetlinks.json` is emitted by the web build when `ANDROID_PACKAGE_NAME` and `ANDROID_CERT_SHA256` are set and served as JSON on every host. The WhatsApp authentication template can be registered for one-tap autofill with the package name and app hash (the app's handshake is documented, not built). Play Console steps: docs/android.md.

## E7

Nothing about tokens, refresh rotation, tenancy enforcement or encryption changes: single sign-on ends in the existing session and MFA ticket; the calendar token is a read-only capability hashed at rest (like the existing email tokens); the new secrets use the existing field cipher; every new route runs in a college's tenant context (the college picker is client-only, so no route without a college was added). The identity providers are the colleges' own (Google Workspace, Microsoft Entra ID); CampusLink sends them nothing about members and stores only the subject id they return.

## Events

None new (sign-ins are audited, not counted as product events).

## Privacy and isolation

Export: the calendar feed (when made, last read); linked sign-in identities are part of the account. Erasure: the feed is deleted; identities go with the account. A waiting roster sync holds the college's own source rows for at most 7 days. Settings, attempts, tickets, feeds and syncs are per college; another college's feed address, sign-in settings or sync are not found.

## Tests

- API (`reach.test.ts`, 20): the feed's content, hashing, language, replacement, another college, suspension and turning off; the sync's set-up, small change applied, large change waiting with a value-free diff and notification, approval applying the stored rows (not the changed source), rejection, source failure, same-day dedupe, weekly day and pause; OIDC: off until set up, secrets never returned, the authorize URL (PKCE, state, nonce, domain), sign-in and linking, **wrong issuer, wrong audience, wrong nonce, expired token, another domain, unconfirmed address**, missing or replayed state, cancellation, admins' two-factor step, new accounts finishing sign-up (terms required, ticket single use), an address registered in advance losing its password and sessions, Microsoft's directory check, suspension; privacy. The key-rotation list covers the new encrypted fields.
- e2e (`reach.spec.ts`): the calendar feed in Settings; the college picker on the bare domain; the sign-in page without single sign-on (no buttons); Admin › Sign-in options; axe on each.
