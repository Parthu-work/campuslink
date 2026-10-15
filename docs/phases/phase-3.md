# Phase 3: Mentorship

Done when: a student can request mentorship, an alumnus can accept, and both can chat and join a video session locally.

## Plan

1. **Platform pieces**
   - `Idempotency-Key` support for sensitive writes (requests, bookings, messages): the key and a request hash are stored per user; a replay returns the first response, and a different body with the same key is refused.
   - `BotProtection` adapter (disabled locally, Turnstile-style adapter behind it) on sign-up and mentorship requests.
   - Delayed jobs in `JobQueue` (reminders, expiry, completion).
   - `VideoProvider`: Jitsi (default), with stub adapters for 100ms and Daily.
   - Socket.io gateway with access-token auth, tenant check against the host, per-user rooms namespaced by tenant, Redis adapter for multiple instances, and a disconnect at token expiry.
2. **Mentor setup:** accepting or paused (one switch), weekly request cap, session types (quick chat, 1:1 video, mock interview, resume review), audience (students, alumni or both), timezone, weekly availability plus date exceptions, minimum notice and booking horizon.
3. **Discovery:** mentor list with filters, and Alumni Match: a score from branch, goals, target companies, skills and languages, with the reasons shown. Mentees' goals and target companies are private match inputs.
4. **Requests (no cold DMs):** structured message (goal, background, what you need) plus a chosen slot for bookable types. The mentor accepts, accepts at another time (reschedule), or declines with a kind template. Messaging opens only after acceptance. Caps, pause, a limit on pending requests per mentee, one open request per mentor, block checks, expiry after 7 days, rate limit and bot check.
5. **Bookings:** slots computed in the mentor's timezone; double booking prevented by a unique index on 15-minute blocks for both mentor and mentee; reschedule (at most twice) and cancel rules with late-cancel flag; reminders 24 hours and 1 hour before (email and in-app); automatic completion; no-show marking within 48 hours; `.ics` calendar export; calendar view in the UI.
6. **Video:** a random room per booking (rotated on reschedule). The join link is issued only to the two participants, only from 10 minutes before the start to 15 minutes after the end. On a self-hosted Jitsi with JWT auth the link carries a token that expires with that window.
7. **Chat:** 1:1 conversations with persistence (bodies encrypted at rest), read receipts, typing indicators, image and PDF attachments (sniffed; images re-encoded; PDFs re-saved without metadata, scripts and embedded files; always downloaded, never rendered inline), and cursor pagination.
8. **Feedback and impact:** after a completed session the mentee rates it (1 to 5, tags, comment). Feedback is visible to the mentor and to admins only. Impact card: "You helped N students this month".
9. **Safety:** block (closes the conversation, withdraws pending requests and cancels future sessions between the two) and report on people, messages and requests. A report on a message stores a snapshot of it, so moderators never browse conversations. The moderation queue UI ships in Phase 4.
10. **Notifications:** in-app (live over the socket), email and web push (VAPID, sent through the SSRF-safe fetcher to an allowlist of browser push services), with per-type preferences and quiet hours (email and push wait until they end).
11. **Web:** Mentors (Match and Browse), mentor page with slot picker and request form, Requests inbox and sent, Sessions (calendar and list, join, reschedule, cancel, feedback, no-show), Messages, mentor settings and availability editor, notification bell and settings, impact card.
12. **Tests:** isolation for every new collection, including **sockets** and attachments; permission matrix; booking races; caps and abuse cases; realtime auth; push SSRF; and an end-to-end journey from request to accept to chat to joining video.

## Assumptions

- **Video locally** uses the public `meet.jit.si`, opened in a new tab: its terms limit embedding to short demos, and it does not support our JWT, so link expiry there is enforced by when we hand out the link. For production, the docs describe self-hosted Jitsi with JWT (`JITSI_APP_ID`/`JITSI_APP_SECRET`), which makes the link itself expire and allows embedding.
- **Group mentoring** (AMAs, office hours with RSVP and a live Q&A queue) belongs with events in Phase 7. Phase 3 is 1:1.
- **Web push** needs VAPID keys in env. Without them, push is reported as unavailable and in-app plus email still work. Generating keys is documented and free.
- **Times** are stored in UTC. Availability is defined in the mentor's IANA timezone (default `Asia/Kolkata`) and shown in the viewer's timezone.
- **Bot protection** stays disabled locally (no external calls). The Turnstile adapter is ready but needs a site key and secret.

## Outcome (built)

- **API:** 5 new modules (mentorship, sessions, messaging, notifications, moderation) with 49 new endpoints (109 in total), plus the Socket.io gateway. All endpoints are in the generated `docs/permissions.md` and covered by the role × endpoint matrix. New permission: `mentorship:oversee` (college admin, TPO).
- **Platform pieces:** `Idempotency-Key` (replay store, 24 h), `BotProtection` (Turnstile adapter, disabled locally), delayed and cancellable jobs, `VideoProvider` (Jitsi with optional JWT; 100ms and Daily stubs), web push sender (VAPID through the safe fetcher), timezone maths on `Intl`.
- **Mentorship:** mentor settings with the pause switch, weekly cap, audience, session types and durations, notice, horizon and buffer; weekly availability and days off in the mentor's timezone; slot engine (DST-aware). Structured requests with every abuse limit from the plan; accept, accept at another time, or decline with a kind template; expiry.
- **Bookings:** double booking is impossible by construction (unique holds for both people). Reschedule (max 2, new room), cancel (late flag), reminders at 24 h and 1 h, automatic completion, no-show within 48 h, `.ics`, private feedback, impact card.
- **Alumni Match:** score from branch, target company, goals, skills, languages and availability, with reasons; only visible fields are used.
- **Chat:** encrypted bodies, read receipts, typing, images and rebuilt PDFs, pagination, live delivery.
- **Notifications:** in-app (live), email and push; per-category channels; quiet hours (reminders exempt); message email throttle.
- **Safety:** block (closes chat, withdraws requests, cancels sessions, hides both ways) and report (people, messages, requests) with snapshots; moderator list and resolve API (queue UI: Phase 4).
- **Web:** Mentors (Alumni Match swipe deck with keyboard support, Browse), mentor page with slot picker and request form, Requests inbox, Sessions with a two-week strip, Messages, mentor dashboard with availability editor, Notifications page and bell, notification settings with push, admin Mentorship tab; a phone bottom bar with a More sheet; English and Telugu at full parity.
- **Tests:** API 312 (Phase 3 isolation for all 13 new collections, realtime auth and delivery, concurrent booking, idempotency, bot check, PDF sanitising, push SSRF, quiet hours); e2e 32 journeys including request → accept → live chat with typing → join video, for both colleges, with axe on every new screen.

## Deviations from the plan

- **Availability is embedded** in the mentor profile instead of a separate collection: settings and hours change together.
- **Request labels:** the request cards show neutral labels ("Goal", "What they need") so they read correctly for both sides.
- **Join flow:** "Join video" opens a dialog with the link (new tab, `noopener`) rather than opening a window directly; popup blockers can't interfere and the link's expiry is shown.
- **Product name:** removed the remaining hard-coded product names (API messages, fetch user agent, mail default, PWA manifest, page title, translations), which now come from `brand.ts`.

## Gaps and next steps

- Group mentoring (AMAs, office hours with RSVP and live Q&A) moves to Phase 7 with events.
- The moderation queue UI for reports ships with Phase 4 (API exists).
- Push needs VAPID keys (`pnpm --filter @campuslink/api vapid`); without them it's reported as unavailable.
- Shareable impact image, mentor levels and Wall of Mentors: Phase 7.
- Phase 4: feed and content (posts, reels, stories, Q&A, sources, ingestion, moderation queue, "One Useful Thing").
