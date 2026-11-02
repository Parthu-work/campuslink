# One-tap invites and class join codes (build B4)

Most people on a college's list never sign up on their own. B4 lets the placement cell (TPO) and admins bring them in with one tap: a personal link, or a class code on a poster or in the class WhatsApp group. Either way the person proves they own the **contact on the college's record** with a one-time code, and joins already verified.

## Who can do what

| Action                                                     | Permission          | Roles                     |
| ---------------------------------------------------------- | ------------------- | ------------------------- |
| See who on the list has not joined (by branch, year, kind) | `onboarding:manage` | TPO, College admin        |
| Send personal links by WhatsApp, or download them as CSV   | `onboarding:manage` | TPO, College admin        |
| Create, stop and print class join codes                    | `onboarding:manage` | TPO, College admin        |
| Open a link or a code, ask for a code, confirm it          | public              | anyone with the link/code |

The admin screen is **Admin › Onboarding** (`/admin/onboarding`, one `ADMIN_SECTIONS` entry in the `people` group); the printable poster is `/admin/onboarding/poster/:id`.

## Invite links

- `POST /admin/onboarding/invites` takes either picked record ids or filters (`branch`, `gradYear`, `kind`) over **unclaimed** records (at most 1,000 a call). A record invited in the last **72 hours** is skipped (`INVITE_RESEND_HOURS`).
- Each link is `https://<college>/invite/<token>`: 256 random bits (43 base64url characters). Only `sha256(token)` is stored (`InviteLink.tokenHash`, unique per college). Links work for **14 days** (`INVITE_TTL_DAYS`) and **once**.
- **WhatsApp:** the college must confirm the recipients agreed to hear from it there (`attestOptIn`, recorded in the audit log with the counts). The message is the approved template `cl_invite_student` or `cl_invite_alumni` (first name, college, link; `docs/whatsapp-templates.md`). Records without a mobile number are skipped. Each invite counts against the college's monthly WhatsApp allowance; when the allowance is reached the rest are reported as not sent, and nothing is left half-done (a link whose message did not go out is deleted, so the record can be invited again at once). Invites go in English: the person is not a member yet, so there is no language preference to go by (B12 may add a college default).
- **CSV:** the links come back in the response and the browser builds the file (`lib/csv.ts`, cells quoted and formula characters neutralised). The college sends them with its own mail merge. Nothing about the file is stored.

### Accepting a link

1. `GET /invite/:token` shows the college, the first name, the roll number masked (`21DP••••01`) and where the code will go (`phone`, `email` or none). Used, expired and unknown tokens all answer 404.
2. `POST /invite/:token/accept` sends a code to the **number on the record** (WhatsApp first, SMS fallback) or, without one, to the email on the record. The body takes only a channel preference; there is no way to name another number. At most five codes a day per record (on top of the per-number cap and the `otp` rate limit).
3. `POST /invite/:token/accept/confirm` with the code, the birth month and the consents: the link is marked used atomically (two taps at once: one wins), the member is created with the record's name and kind, verified (`VerificationService.claim`, method `roll_invite_link`), with the age rules of B2 (a minor waits for a guardian), and signed in (refresh cookie as for any sign-in). A failed confirmation leaves the link usable.

A contact that already has an account answers 409 ("sign in, then confirm your roll number"): the invite never merges into or signs in an existing account.

## Class join codes

- `POST /admin/join-codes` creates an 8-character code from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no look-alikes), for students or alumni, optionally one branch and one year, valid 1 to 60 days. Codes are unique per college; the same string at two colleges are two codes.
- `/join/:code` (codes are case- and space-insensitive) asks for the roll number. Only an **unclaimed record of that kind, branch and year** matches; anything else is "not in this class". Then the same code-to-contact and confirm steps as a link (method `roll_join_code`); the code's `uses` counts joins.
- `POST /admin/join-codes/:id/expire` stops a code at once. The poster (`GET /admin/join-codes/:id/poster`) carries the code, its class, the link and a QR code of the link (SVG, generated on the server, shown as an image).

## Alumni: three quick answers

Right after an alumnus joins: where they work, their role, the topics they can help with, and "Can you give 30 minutes a month to a student?" (on by default; it turns on accepting requests with a weekly cap of one). Everything is skippable and saved through the existing `PUT /me/profile` and `PUT /me/mentor`.

## Data and privacy

- `InviteLink` and `JoinCode` are tenant collections (indexes lead with `tenantId`), with isolation tests in `test/isolation/onboarding.test.ts`. They hold no contact details: a link has the record id, a hash of the token, who created it and, once used, who used it.
- Erasure (`OnboardingService.eraseFor`) detaches the member from links they used; export has nothing personal to add (the roster record itself belongs to the college).
- Audit: `onboarding.invites_sent` (channel, counts, opt-in attested), `onboarding.code_requested` (record, channel), `onboarding.join_code_created`, `onboarding.join_code_expired`, and `auth.signup` with the method.

## Not in B4

- Bulk verification decisions and the rest of the TPO console are B6.
- The `onboarding` section shows no count on the admin overview: unclaimed records are not a review queue.
