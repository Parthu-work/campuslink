# Phone-first identity, age and guardian consent (build B2)

Status: built in B2. **The minors flow needs legal review** (see `docs/privacy.md`).

## Goal

A student signs up in under two minutes with only a mobile number, and members under 18 are handled lawfully (DPDP Act 2023 §9, DPDP Rules 2025 Rule 10).

## Decisions

- **Codes go to the phone through `OtpSender`** (`apps/api/src/modules/notifications/channels/otp-sender.ts`): WhatsApp first when it is available and the member has not asked for SMS, then SMS. B2 ships the `disabled` and `console` providers for both channels; B3 adds the WhatsApp Cloud API and MSG91 adapters behind the same interfaces. When neither channel is available the college shows email sign-up only (`PublicTenant.phoneSignIn`), and `POST /auth/phone/start` answers `503 CHANNEL_UNAVAILABLE`.
- **No enumeration.** `POST /auth/phone/start` answers `202 {challengeId}` in every case. A sign-in code is sent only when the number has an account (so the platform does not pay to text strangers); a sign-up code is always sent. Verifying a sign-up code for a number that already has an account signs into that account: only the phone's holder learns it exists.
- **Birth month to `adultOn`.** Only the month is asked and only `adultOn` is stored. Because the day is unknown, a member counts as 18 from the first day of the month **after** their eighteenth birthday month (the latest possible birthday), so nobody is treated as an adult early. Birth months more than 100 or fewer than 13 years ago are refused as mistakes.
- **Members who declared adulthood before B2** keep `adultOn: null`, which means adult; `ageDeclaredAt` is renamed `ageCheckedAt` by the migration `b2-age-checked-at`.
- **Phone sign-in and two-factor.** Members with an MFA-required role (`SUPER_ADMIN`, `COLLEGE_ADMIN`) are refused (`403 USE_PASSWORD_AND_2FA`). A member who turned on TOTP voluntarily still has to enter it after the phone code (the same ticket as password sign-in), so a phone code never bypasses a second factor.
- **Wrong codes lock like passwords.** A wrong code on a sign-in challenge counts as a failed sign-in on the account (`failedLogins`, the same lock-out ladder). Each challenge also allows 5 attempts.
- **Caps.** 5 challenges per phone per day (all purposes), 5 per member per day (existing), and the per-IP limiter `otp` (10 per 15 minutes).
- **The challenge keeps the number encrypted** (`phoneEnc`, listed in `ENCRYPTED_COLLECTIONS`) because a sign-up needs it after the code is confirmed; challenges are deleted 24 hours after creation.
- **Changing the number** needs a code to the old number, or the current password; the new number then needs its own code. Other sessions are revoked and both steps are audited.
- **Guardian consent.** The guardian's number comes from the college's admission record (`guardianPhone` on the roster), so the student must be matched to their roster record first (any verification method). The guardian reads a short, versioned declaration (`guardian_consent` v1, in English or Telugu) on the student's screen and confirms with the code sent to their own phone. The record keeps the roster record id, the language and the channel, not the guardian's number. Without a guardian number on the roster, the student enters one; a TPO or admin approves it in the verification queue (`method: 'guardian_manual'`), which writes it to the roster record, and the code flow follows.
- **While `guardian_pending`** a member has no permissions at all: only signed-in basics (`/me`, sessions, sign-out), verification and the guardian screens work; the privacy rights (export, deletion) stay available.
- **While a minor** (with consent): the For you tab is chronological (no ranking signals), contact details are never shown to others (whatever the visibility setting), the member never appears on leaderboards, and (from B9) no product events are recorded. Direct messages already exist only inside accepted mentorships (no endpoint opens any other conversation), so the rule holds by construction; a test pins it.
- **Turning 18.** An hourly tick queues one job (`auth.adulthood`) per college with members whose `adultOn` has passed: a member still waiting for guardian consent becomes active (they no longer need it), `adultOn` is cleared (an adult keeps no age data), and each gets the `adult_now` notification. The restrictions themselves are computed from `adultOn` on every request, so they lift on that day even before the job runs.
- **Adults store no age data.** An adult's `adultOn` is null from sign-up (data minimisation); only a minor's is kept, until the day passes.
- **TPOs review the verification queue.** `verification:review` is added to the TPO role: guardian numbers (here) and bulk verification (B6) are the TPO's work. Reviewers see a guardian number in full, to compare it with the admission papers; it is deleted from the request once decided.
- **Phone first on the web.** Sign-up and sign-in open on the mobile number when the college can send codes (`phoneSignIn`); email and password are one tap away (and the only way on the platform console).

## Data

- `User`: `email` optional (partial unique index), `passwordHash` optional, `phoneEnc`/`phoneIndex` (partial unique index), `phoneVerifiedAt`, `adultOn` (minors only), `guardianConsentAt`, status `guardian_pending`, `ageCheckedAt` (was `ageDeclaredAt`), `otpChannel` (null: WhatsApp first; `sms`: the member chose SMS).
- `OtpChallenge`: `userId` optional; `phoneIndex`, `phoneEnc`; purposes `phone_signup`, `phone_login`, `phone_change`, `guardian_consent`; `channel`; `step` (`old`/`new` for a phone change).
- `Whitelist` (roster): `guardianPhoneEnc`/`guardianPhoneIndex`; import field `guardianPhone`.
- `Consent`: purpose `guardian_consent`, source `guardian`, `evidence {whitelistId, language, channel}`.
- `VerificationRequest`: method `guardian_manual` with `guardianPhoneEnc`.
- `Profile`: `minorUntil` (synced from the user).

## API

| Route                           | Access        | Notes                                                       |
| ------------------------------- | ------------- | ----------------------------------------------------------- |
| `POST /auth/phone/start`        | public, bot   | `{phone, purpose: signup\|login, channel?}` → `202`         |
| `POST /auth/phone/verify`       | public        | `{challengeId, code, signup?}` → session or MFA ticket      |
| `POST /me/phone/change`         | authenticated | `{phone, password?}` → code to the old (or new) number      |
| `POST /me/phone/change/confirm` | authenticated | `{challengeId, code}` → next step or done                   |
| `GET /me/guardian`              | authenticated | what the guardian step needs                                |
| `POST /me/guardian/start`       | authenticated | code to the guardian's number on the roster                 |
| `POST /me/guardian/confirm`     | authenticated | `{challengeId, code, language}` records consent             |
| `POST /me/guardian/manual`      | authenticated | `{phone}` → a `guardian_manual` request for the queue       |
| `GET /dev/outbox`               | dev and test  | the console providers' last 200 messages (never production) |

Email/password sign-up stays for staff and anyone who prefers it, with `birthMonth` in place of `isAdult`.

## UI

Phone-first sign-up and sign-in (the email forms stay one tap away), the birth-month picker, the code step (6-digit field that submits itself, WhatsApp/SMS switch, resend with a countdown), the guardian screen for `guardian_pending` members, and Settings › Security › Change phone.

## Tests

`apps/api/test/phone-auth.test.ts` (codes, caps, brute force, no enumeration, MFA roles, TOTP after the code, lock-out, phone change), `apps/api/test/minors.test.ts` (guardian-pending withholds every permission route, table-driven over the registry; restrictions; guardian flow; manual approval; the adulthood job), isolation and privacy cases, the migration, and `apps/web/e2e/phone-signup.spec.ts` (adult and minor).
