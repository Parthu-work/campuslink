# TPO console (build B6)

Goal: the training and placement officer (TPO) runs onboarding and communication from one place, in minutes. It builds on B4's Admin › Onboarding section.

## Bulk verification decisions

`POST /admin/verification/bulk-decision {ids (1 to 100, each once), decision, reason?}` with `verification:review`.

- Each id runs through the existing `VerificationService.decide()`: its own checks (already decided, roll number claimed, guardian numbers), its own audit entry (`verification.approved` / `verification.rejected` with the reviewer) and its own email.
- One failing does not stop the rest. The answer lists every id: `{ id, ok, error, message }` with the error code (`NOT_FOUND` when already decided or unknown, `VALIDATION_FAILED` for a rejection without a reason, `CONFLICT` for a claimed roll number).
- Admin › Verification gets checkboxes, "Select all" (up to 100), "Approve selected" and "Reject selected" (one reason for all, which each person sees).

## Onboarding progress

`GET /admin/onboarding?branch&gradYear` returns one row per branch and batch of the college's list:

| Field      | Meaning                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| `roster`   | records on the list                                                           |
| `invited`  | records with at least one invite link (B4)                                    |
| `claimed`  | records someone joined with                                                   |
| `verified` | of those, members who are verified                                            |
| `active7d` | of those, members who used a session in the last 7 days, through `suppress()` |

Only the activity count is suppressed: the rest describes the college's own list, which the TPO already has.

`POST /admin/onboarding/nudge {branch, gradYear, attestOptIn: true}` invites every unclaimed record of that class on WhatsApp through B4's `sendInvites()` (72-hour resend rule, opt-in attestation, the monthly allowance).

Both routes use `onboarding:manage` (TPO and college admin). The prompt suggested `imports:manage` or `verification:review`; a route declares one permission, and `onboarding:manage` is the one both roles that run onboarding already hold.

The admin overview shows "Not joined yet: N" (students on the list without an account) to anyone with `onboarding:manage`, linking to Admin › Onboarding.

## Targeted announcements

Official announcements (`announcement: true`, `announcements:post`) gain:

- `audience {branches[], gradYears[], roles[]}`: empty lists mean "any", so nothing picked is everyone. A member sees the announcement when they match every non-empty list (branch and batch from their profile, role from their account). Its author and every holder of `announcements:post` see all announcements.
- `pinDays` (1 to 30) → `pinnedUntil`: pinned announcements the viewer may see lead the first page of For you, newest first (up to three), and are left out of the ranking below.
- `sendWhatsApp`: a job (`feed.announce`) notifies the audience with the new `announcement` notification (title only: the first line, at most 60 characters). Members get it on WhatsApp (template `college_announcement`) if they opted in, else by push or email, per their settings.
- `urgent` (requires `sendWhatsApp`): the WhatsApp message is critical, so it skips the member's weekly cap. A college may send `URGENT_ANNOUNCEMENTS_PER_MONTH` (4) urgent announcements per calendar month (UTC); the fifth is refused.

Ordinary posts with any of these fields are refused. The audience applies everywhere a post can be read: For you, Following, lists, saved posts, the post page, search and One Useful Thing. Post cards show "Pinned" and "For ECE · 2027" badges.

**Exception to the notification rule.** Notification payloads normally carry ids, names and times only. An announcement's title is the one piece of text sent, because the announcement is the college's own public message and the prompt asks for its title.

## Tests

`test/tpo-console.test.ts` (bulk decisions with partial failures and audit, audience filtering across feed, lists and the post, ordinary posts refused, pinned order and expiry, title-only fan-out, the urgent cap, progress counts and suppression, nudge), `test/isolation/tpo-console.test.ts`, and `e2e/tpo-console.spec.ts`.
