# Growth loops (prompt 2, G8)

Goal: every member who gets something out of CampusLink can bring the next one in, and show what they achieved, without the college or the member giving up anything about themselves they did not choose to.

## Inviting the batch

Alumni (`invites:batchmates`) see **"N of your batch aren't here yet"** on `/share`: the college's list (B4 whitelist) for their own branch and batch, unclaimed. They can send the B4 WhatsApp invite to them (`POST /me/batchmates/invite {count}`), oldest records first, through the same invite links and delivery as the TPO's (`OnboardingService.deliver`). They never see a name or a number.

- **Off until the college turns it on** (Admin › Growth and invites, `onboarding:manage`). Turning it on needs the admin to confirm that everyone on the list agreed to hear from the college on WhatsApp (`attestOptIn`); the confirmation is stored with who and when, and audited. Until then the request is 503 (`CHANNEL_UNAVAILABLE`).
- **Limits**: 20 a week per member (`MEMBER_INVITES_PER_WEEK`), and the college's WhatsApp allowance still applies. A record invited in the last 72 hours (`INVITE_RESEND_HOURS`) is skipped, whoever invited it.
- Only their own batch: branch and batch come from the member's profile; a member without both gets 400.
- `invite_sent` is recorded (count and who sent: member or captain); every run is audited (`onboarding.member_invites`).

## Campus Captains

A student the college's admins make a **Campus Captain** (`CAMPUS_CAPTAIN` capability, Admin › People; one toggle per capability, so it never touches peer mentoring or roadmap contribution) gets `captains:class` and `invites:batchmates`. `/captain` shows their own class only, in counts (`GET /captain/class`): on the list, invited, joined, verified, active this week (suppressed under five) and how many joined through their own invites. They invite classmates the same way as alumni (`POST /captain/invites`), 50 a day (`CAPTAIN_INVITES_PER_DAY`), under the same college switch. Capabilities are resolved per request from the database, so nothing about tokens changes (E7).

## Public pages (E4)

A member over 18 (`share:pages`: students and alumni) can publish, per achievement, a page at `https://<college>/p/<slug>`:

| Kind       | Shows                                 | From                 |
| ---------- | ------------------------------------- | -------------------- |
| `placed`   | "Placed at <company>", the role       | a **verified** offer |
| `roadmap`  | "Finished the <roadmap> roadmap"      | a finished roadmap   |
| `mentored` | "Mentored N students"                 | completed mentoring  |
| `mentor`   | their mentor card (title and company) | an accepting mentor  |

- **Opt-in, per page** (`POST /me/public-pages {kind, refId, nameStyle, indexable}`); the same achievement twice is the same page.
- **Never**: contact details, the exact CTC, anything else from the profile, or anything about a minor. The page's content is built from these fields only (`PublicPageContent`) and the HTML and the share image use exactly that; the name is the full or first name, as chosen.
- **Revocable**: `DELETE /me/public-pages/:id`, and a page whose source goes away (an offer no longer verified, a member who turns out to be a minor) is a 404 at once, because the content is rebuilt on every view.
- **Not listed** by search engines unless the member turns it on (`robots: noindex` otherwise).
- Minors (`adultOn` in the future) get no options and a 403.

Serving: the API renders the pages itself (`/p/:slug`, `/p/:slug/og.png`; HTML with Open Graph tags and a 1200×630 PNG drawn from an SVG with `sharp`), so link previews work in WhatsApp and LinkedIn. `/p/` is proxied to the API by nginx (production and staging), Vite in development and the ALB (`/p/*`). The college is resolved from the host by the same tenant resolver as every API call, mounted at `/p` too; nothing about tenancy enforcement changes (E7). A member's page and its image are never cached (`Cache-Control: no-store`), so taking it down works at once, even in a browser that opened it; the college outcomes page may be cached for five minutes. All are rate-limited like search. Anything not published, taken down or of another college is a plain 404.

Views: a counter per page (`views`), and one `public_page_viewed` event per page a day, about the page's owner. Nothing about the viewer is stored (E6: no trackers).

## The college outcomes page

When the college publishes it (Admin › Growth and invites, `tenant:settings`), `/p/outcomes` shows aggregates only: placement percentage, students placed and the median CTC band per batch, top recruiters, where alumni work and hours of mentoring. Counts under five show as "<5" (`suppress`); no names. Admins see a preview before publishing (`GET /admin/growth/outcomes-preview`). It is a 404 while off.

## Referral outcomes

14 and 30 days after an alumnus refers a student (`REFERRAL_OUTCOME_PROMPT_DAYS`, delayed jobs `referrals.outcome_prompt`, job ids per referral and day), the student is asked what happened (`referral_outcome_prompt`; nothing is sent once they answered). They answer on the referral (`POST /referrals/:id/outcome`: interview, offer, no response, not selected) and can change it. The referrer sees what their referrals led to (`GET /me/referral-impact`: referred, interviews, offers) on the referrals page. `referral_outcome_reported` is recorded.

## The parent digest

A student (`parents:digest`) can send a parent a monthly WhatsApp summary (`/share`):

1. They enter the parent's number and language (`POST /me/parent-digest`). The parent gets a 6-digit code (OTP purpose `parent_digest`) and the student types it in (`POST /me/parent-digest/confirm`), so a parent only receives it after confirming it reached them.
2. From the 1st of each month (India time), one job per college (`notifications.parent_digest`, job id per month, queued by an hourly tick) sends last month's figures: drives registered for, mentoring sessions attended, the readiness score and its change. The CGPA only if the student turned it on (`PUT /me/parent-digest/grades`). Template `cl_parent_digest` (utility, not critical). Each one is claimed per month before sending, so a retry never sends twice.
3. The student stops it any time (`DELETE /me/parent-digest`); the number is deleted.

The number is stored encrypted with the existing field cipher (`phoneEnc`, last four digits shown); no new third party holds it (E7).

## Events

`invite_sent`, `public_page_published`, `public_page_viewed`, `referral_outcome_reported`.

## Privacy and isolation

Export: public pages (kind, slug, settings, views), the parent digest (last four digits, language, status). Erasure: public pages are deleted (so their links 404), the parent digest and its number are deleted, unused invite links the member created are deleted; referral outcomes go with the referrals. Everything is per college; another college's page, digest or class is not found.

## Tests

- API (`growth.test.ts`): publishing a verified placement shows company and role only (no CTC, no email, first name as chosen); the share image carries only the opt-in fields; pages nobody published, taken down, of another college, whose offer was un-verified, or after erasure are 404; minors cannot publish; the outcomes page is 404 until published, aggregates with "<5", not on another college; member invites need the college's confirmation, stay in the member's batch and limit; captains see their own class in counts and invite it; referral outcomes and the referrer's impact; the parent digest's code flow, monthly send once a month, stop; isolation.
- e2e (`growth.spec.ts`): a student publishes a page and opens it; an alumnus sees their batch; a captain sees their class; the admin turns member invites on.
