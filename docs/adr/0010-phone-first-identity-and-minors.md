# ADR 0010: Phone-first identity, birth month instead of an age tick, and guardian consent for minors

- Status: accepted (the minors flow needs legal review before a college enrols members under 18)
- Date: 2026-10-29

## Context

Tier-3 students live on cheap Android phones and WhatsApp; many do not use email. Until now an account needed an email and a password, and sign-up required ticking "I am 18 or older", which turned away first-years under 18 and gave no lawful way to include them (DPDP Act 2023 §9 requires verifiable consent from a parent or guardian for children).

## Decision

1. **Phone identity (D1).** Students, alumni and faculty may sign up and sign in with a mobile number and a 6-digit code. Email and password become optional for them; `SUPER_ADMIN` and `COLLEGE_ADMIN` keep password plus TOTP, and a member with an MFA-required role is refused by phone (`USE_PASSWORD_AND_2FA`). A member who turned on TOTP still enters it after the phone code. Sessions are created by the existing `createSession`: tokens and refresh rotation are unchanged.
2. **One code service.** `OtpService` issues and checks every one-time code (roll claims, company email, phone sign-up and sign-in, phone change, guardian consent): hashed codes, 10-minute expiry, 5 attempts, single use, 5 codes a day per member and per number, plus a per-IP limiter. `OtpSender` delivers phone codes by WhatsApp first and SMS as fallback (decisions D3 and D4; adapters behind interfaces).
3. **No enumeration.** Starting sign-in answers the same for any number and sends nothing to a number without an account; a sign-up code for a number that already has an account signs into it after the code is proved.
4. **Birth month, not an age tick (D2).** Only the date a minor turns 18 is stored (`adultOn`, from the latest possible birthday); adults keep no age data.
5. **Guardian consent from the college's record.** A member under 18 has no permissions until a guardian confirms a versioned declaration with a code sent to the guardian's number on the admission roster. A number the student enters is used only after a TPO or admin approves it. While under 18 with consent: chronological For you, contact details never shown, no leaderboards, no product analytics events.

## Consequences

- `email` and `passwordHash` are optional on `User`; every email path checks for an address.
- The verification queue has a second kind of request (`guardian_manual`), and TPOs gain `verification:review`.
- The flow is documented in `docs/privacy.md` and `docs/specs/phone-identity.md` and needs a lawyer's review; it does not rely on the DPDP Fourth Schedule exemption.
- Paid channels (WhatsApp, SMS) need external registrations (Meta Business, DLT); until then a deployment offers email only (`phoneSignIn: false`).
