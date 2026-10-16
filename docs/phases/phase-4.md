# Phase 4: Feed and content

Done when: members see a college feed with For You and Following tabs, alumni and staff can post (text, photos, Tips reels, polls, links), stories and a daily "One Useful Thing" appear, students can ask in a moderated Q&A, followed sources bring in snippets automatically, and moderators work through one queue.

## Plan

1. **Posts:** text (a small markdown subset), up to 4 photos (alt text required), Tips reels (MP4 up to 60 s and 25 MB, description required), polls (2–4 options, closing date), and links with a safe preview. Hashtags and up to 3 topics per post. Reactions (helpful, insightful, celebrate), one-level comments, saves and share-within-college. Staff can mark a post as an official announcement. Students post only when the college turns on `studentPosting`.
2. **Rich text safety:** no HTML is stored or rendered anywhere. The server strips all markup with an allowlist sanitizer (`sanitize-html`, empty allowlist); the web app renders the markdown subset into React elements.
3. **Media:** upload first, attach on post (unattached uploads are purged after 24 hours). Images are re-encoded. Videos are sniffed (MP4/QuickTime only); the duration is read from the container header; metadata boxes (`udta`, `meta`) are overwritten in place.
4. **Stories:** a text card or photo with an optional link, gone after 24 hours. The `stories` feature toggle applies.
5. **Feed:** For You (ranked) and Following (chronological). The ranking is simple and documented (`docs/feed-ranking.md`): recency decay, followed people and sources, topic and branch relevance, alumni and official boosts, and engagement. A stable cursor keeps pages consistent while you scroll.
6. **Follows:** people, topics and sources.
7. **Content ingestion (`content-sources`):** RSS/Atom sources per college.
   - **Scheduler and fetch:** a scheduler enqueues fetch jobs. Each fetch goes through `safeFetch` and honours robots.txt, conditional requests (ETag, Last-Modified), Cache-Control, Retry-After and back-off.
   - **Processing:** items are parsed safely (no DTD or entity expansion), deduplicated by canonical URL and content hash, then normalised into a snippet plus link-out with attribution. They are tagged by topic and branch.
   - **Filters:** spam and low-quality items are rejected or held for review.
   - **Admin view:** a per-source health dashboard; admins add a source after a test fetch, and can pause, resume, remove or fetch now.
   - **Starter list:** candidate feeds are verified by `pnpm feeds:verify`, which runs in GitHub Actions; only verified ones are enabled.
8. **One Useful Thing:** one card a day. Staff can feature a post; otherwise the best recent alumni tip or followed-source item is picked automatically.
9. **Q&A:** students ask; questions wait for moderation; alumni and staff answer; the asker accepts an answer; "helpful" votes on answers.
10. **Moderation:**
    - One queue for reports, held automated items, pending questions and appeals.
    - Moderators can remove (with a reason code shown to the author), restore or dismiss, and every action is recorded in the append-only `moderationActions` and audit logs.
    - Authors see why their content was removed and can appeal once.
11. **Notifications:** comments, replies, answers, accepted answers, removals and appeal decisions, in two new categories (community, moderation).
12. **Search:** the command palette also finds posts and questions.
13. **Web:**
    - Feed home: stories, One Useful Thing, composer, tabs, virtualised infinite scroll with optimistic reactions and saves, and a right rail on desktop.
    - Post detail with comments, a Reels viewer, a story viewer (pause and keyboard controls), Q&A, Following (topics and sources), Saved.
    - Admin: Sources and Moderation.
14. **Tests:**
    - Isolation for every new collection, including post media files and the source scheduler.
    - Permissions, including student posting by toggle.
    - Sanitizer and markdown edge cases, ranking maths, robots and RSS parsing, dedupe, spam filters, video header parsing and metadata stripping, the moderation and appeal flow.
    - End-to-end: post → react → comment → report → remove → appeal; ask → approve → answer → accept; stories and reels.

## Assumptions

- **Feed verification:** this container's network policy blocks external news hosts, so feed URLs are verified in GitHub Actions (`.github/workflows/feeds.yml`). The results are recorded in `docs/content-sources.md` with the date. Unverified candidates stay disabled.
- **No video transcoding** (no free transcoder in the stack). Uploads must already be MP4/MOV (what phones record), and playback is a download of the file. Streaming and adaptive bitrate are Phase 8 deployment concerns.
- **Link previews** fetch only title, description and site name (no remote images, so no hotlinking or tracking pixels).
- **Story "seen" state** is not tracked: no read receipts for stories (data minimisation).
- **Ingestion in tests:** the scheduler is off in tests and end-to-end runs (`INGESTION_ENABLED=false`); ingestion is tested with a fake transport. The seed creates no fake news items: only real sources, which fetch when the API runs with internet access.

## Outcome

**Built:** everything in the plan above.

- **API:** modules `feed`, `qa`, `content-sources`, moderation queue and appeals.
- **Web:**
  - Feed home with stories, One Useful Thing, composer, For you and Following tabs, and a virtualised infinite list with optimistic reactions and saves.
  - Post detail with threaded comments; Reels, Saved, Following and Q&A pages.
  - Admin Moderation and Sources tabs.
  - English and Telugu throughout.
- **Seed:** DEMO posts, a poll, an announcement, a story and Q&A (no news items).

**Tests:**

- API: 417 tests, including feed, Q&A, moderation, ingestion and a 38-case isolation suite covering all 15 new collections, media files and search.
- Web: unit tests for the markdown parser, optimistic updates and story grouping.
- Playwright: 40 end-to-end tests with axe on every new view (post → react → comment → report → remove → appeal → restore; ask → approve → answer → accept; stories; reels; sources).
- Checked at 360 px and desktop widths, in light and dark themes and with reduced motion: no horizontal overflow on any new page.

**Feed verification:** done in GitHub Actions. Eight of the nine remaining starter feeds are verified (2026-10-16). Three candidates were dropped (two refuse bots with 403, one is stale), and NASA stays unverified (rate-limited). See `docs/content-sources.md`. The first CI run exposed a real bug: a doctype quoted inside an article's CDATA tripped the DTD guard. The guard now ignores CDATA and comments, but checks the whole document rather than only the first 4 KB.

**Decisions:**

- Plain text plus a markdown subset (ADR 0007).
- Explainable ranking from follows, branch and public counts only (`docs/feed-ranking.md`).
- The feeds workflow turns red only when a verified feed regresses.
- Media is validated before any of it is claimed, so a rejected post never uses up an upload.
- Home is code-split; the main bundle is 454 kB.

**Gaps and next steps:**

- No video transcoding or streaming (Phase 8).
- Story "seen" rings are not tracked.
- Spam filters are keyword-based.
- NASA's feed needs a passing run.
- Phase 5 (Jobs and referrals) is next.
