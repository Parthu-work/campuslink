# Phase 7: Gamification, events and analytics

Phase 7 is done when:

- **Students** earn XP, streaks, levels and badges for real learning and engagement.
- **Alumni** build an Impact Score with mentor levels (Bronze to Platinum), appear on an opt-in Wall of Mentors and as Mentor of the Month, and can export an "I mentored N students" card.
- **Colleges** run a rewards catalogue with redemption tracking.
- **Leaderboards** are opt-in.
- **Events** have RSVP, a waitlist, reminders, calendar export, check-in and a live Q&A queue for AMAs and office hours.
- **Admins** see an aggregated analytics dashboard with CSV and print-ready exports.

## Plan

### 1. Gamification (`gamification` module)

- **Ledger:** an append-only XP ledger (`xpEvents`) with two tracks: student XP and alumni impact points.
- **Awards:**
  - Every award has a dedupe key (member + kind + item), so repeating or toggling an action never pays twice.
  - Per-kind daily caps apply.
  - Nobody earns from their own content (no XP for answering your own question or reacting to your own post).
  - Revoking an award writes a negative entry with a reason to the audit log; nothing is deleted.
- **Sources** (each called by the owning service after a successful write):

  | Track  | Action                         | Points | Cap        |
  | ------ | ------------------------------ | ------ | ---------- |
  | XP     | Roadmap step done              | 10     | 10 per day |
  | XP     | Roadmap finished               | 100    |            |
  | XP     | Post published                 | 5      | 3 per day  |
  | XP     | Answer accepted                | 20     |            |
  | XP     | Mentorship session completed   | 15     |            |
  | XP     | Feedback given                 | 5      |            |
  | XP     | Event attended (checked in)    | 10     |            |
  | Impact | Session mentored               | 10     |            |
  | Impact | New mentee                     | 15     |            |
  | Impact | Referral given                 | 8      |            |
  | Impact | Answer accepted (alumni)       | 5      |            |
  | Impact | Roadmap contribution published | 20     |            |
  | Impact | Event hosted                   | 10     |            |

- **Levels:** level _n_ needs 50·n·(n+1) XP.
- **Streaks:** consecutive days (in the college's timezone) with at least one XP event.
- **Mentor levels** by impact: Bronze 50, Silver 200, Gold 500, Platinum 1000.
- **Badges:** a small set defined in `packages/shared`, each with written criteria. Awarded once each (unique index), with a level-up and badge toast in the web app (respects reduced motion).
- **Privacy:**
  - Leaderboards (this month, my branch) list only members who opted in.
  - The Wall of Mentors and Mentor of the Month (last month's top opted-in mentor) list only alumni who opted in.
  - Everyone sees their own stats.
- **Rewards:**
  - Admins (`rewards:manage`) run a catalogue with title, description, kind (certificate, event invite, goodies, other), track, cost, stock and whether it is active.
  - Members redeem points they have earned. The redemption is pending until an admin fulfils or rejects it; a rejection refunds the points.
  - The balance is earned minus redeemed. Redemptions use an atomic stock decrement and are idempotent.
- **Admin audit tools:** view a member's ledger, and revoke an award with a reason (audited).

### 2. Events (`events` module)

- **Kinds:** meetup, talk, placement drive, workshop, AMA, office hours.
- **Who creates them:**
  - `events:create`: staff and admins can create any kind.
  - `ama:host`: alumni can create AMAs and office hours.
- **RSVP:**
  - Capacity with a waitlist; when someone cancels, the next person on the waitlist moves up automatically.
  - The online link is shown only to people who are going, and only from 15 minutes before the start.
- **Reminders:** 24 hours and 1 hour before the start, as delayed jobs that carry the event version, so a change or cancellation voids old reminders.
- **Notifications:** new types for updates and cancellations, in an `events` category.
- **Calendar:** a per-event `.ics` download (RFC 5545, properly escaped, with UTC times).
- **Check-in:** the host checks attendees in, which awards XP.
- **Live Q&A queue** (AMAs and office hours): questions, one upvote per member, host marks them answered or hides them. Plain text, rate-limited, reportable. Polled every 10 seconds; no new socket events.
- **Moderation:** events and event questions are moderatable and reportable.

### 3. Analytics (`analytics` module)

- **Metrics:**
  - Active members (7 and 30 days, from sessions).
  - Mentorship sessions per month.
  - Referral requests by outcome.
  - Engagement by branch and batch (posts, answers, sessions, roadmap steps).
  - Alumni participation (share of verified alumni who mentored, referred, answered or hosted in the last 90 days).
  - Jobs posted and event attendance.
- **How it is computed:** each module's service exposes aggregate counts; `AnalyticsService` composes them (no cross-module model access) and caches per college for 5 minutes.
- **Privacy:**
  - Aggregates only. No member-level data on the dashboard.
  - Cells under 5 people show as "<5".
- **Access:**
  - `analytics:tenant`: the college dashboard.
  - `analytics:cohort`: faculty see the same aggregates, limited to branch and batch views.
- **Exports** (`reports:export`):
  - CSV (formula-injection safe) and a print-ready report page; "Save as PDF" uses the browser.
  - Every export is written to the audit log.
  - The data is structured by academic year, so NAAC, NBA and NIRF layouts can be added later.

### 4. Web

- **Me → Progress:** level, streak, badges, history.
- **Leaderboard** (opt-in).
- **Mentor impact:** score, level, an impact card exported with the canvas API, and the Wall of Mentors.
- **Rewards:** catalogue and my redemptions; admin catalogue and fulfilment.
- **Events:** list, calendar view, detail with RSVP, `.ics` and Q&A queue; host tools.
- **Admin:** analytics dashboard with charts as plain SVG (no chart library), CSV and print exports.
- **General:** English and Telugu; reduced motion respected.

### 5. Tests

- **Ledger rules:** dedupe, caps, no self-XP, revocation.
- **Rules:** levels, streaks and badges.
- **Privacy:** leaderboard and wall opt-in.
- **Rewards:** stock and refunds, plus a concurrency test.
- **Events:** capacity, waitlist promotion, reminders voided by version, link visibility, ICS escaping.
- **Q&A queue:** votes.
- **Analytics:** small-cell suppression, CSV injection, export audit.
- **Isolation:** every new collection.
- **Playwright:** RSVP → `.ics` → Q&A; earn XP → badge; redeem a reward → admin fulfils; admin dashboard and export.

## Assumptions

- **Point values and caps** are a first tuning. They live in `packages/shared` so they can change without a migration.
- **Rewards** are real-world items handed out by the college. The platform tracks redemptions only and handles no money.
- **"Active"** means a session refresh in the period. Nothing else is tracked (no page views, no third-party analytics).
- **The impact card** is drawn in the browser and contains only the mentor's own name, college and counts.
