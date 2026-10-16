# Content sources (RSS and Atom)

Colleges bring outside news into the feed only from **official RSS or Atom feeds**. We show the headline, a snippet of at most 300 characters, the publisher's name and a link to the original. Full articles and remote images are never stored or shown, and nothing is scraped.

## Adding a source

Admin → Sources (`sources:manage`). Every new URL is **test-fetched first**: robots.txt, reachability, content type and parsing, with a preview of three headlines. A source that fails the test cannot be added.

## How fetching works

| Step        | Behaviour                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schedule    | The API ticks every 60 s (`INGESTION_ENABLED`) and queues one `content.fetch` job per due source. The job id includes the due time, so several instances never fetch twice. The tick is the named platform path `content:due-sources`. |
| Identify    | User agent `<APP_NAME>Bot/1.0 (+snippets and links only; respects robots.txt)`.                                                                                                                                                        |
| robots.txt  | Checked per origin and cached for 24 h, per RFC 9309: 4xx means allowed; 5xx or unreachable means disallowed (rechecked after 1 h). A disallow marks the source **blocked** and waits a day.                                           |
| Transport   | `safeFetch` only: HTTPS, public IPs, pinned DNS, 15 s timeout, 3 MB cap.                                                                                                                                                               |
| Conditional | Sends `If-None-Match` and `If-Modified-Since`; a 304 counts as healthy.                                                                                                                                                                |
| Caching     | The next fetch waits for the larger of the source interval (30 min to 24 h) and `Cache-Control: max-age`.                                                                                                                              |
| Rate limits | 429 and 503 honour `Retry-After` (clamped to 5 min–24 h, default 1 h).                                                                                                                                                                 |
| Failures    | Exponential back-off: interval × 2^failures, at most a day. Health shows the last error and the failure count.                                                                                                                         |
| Parsing     | `fast-xml-parser` with DOCTYPE and ENTITY declarations refused (no XXE or billion-laughs). Text is stripped of markup and control characters.                                                                                          |
| Dedupe      | A canonical URL (tracking parameters and fragments dropped, query sorted) gives a unique `urlHash` per college; a title-plus-snippet `contentHash` within 7 days catches syndicated copies.                                            |
| Filters     | Spam terms or a too-short title: rejected (not stored). All caps, `!!!`, clickbait phrases or thin items: **held** for a moderator (Admin → Moderation → News held).                                                                   |
| Tagging     | The source's topics and branches plus keyword rules (`tagging.ts`).                                                                                                                                                                    |
| Retention   | Items expire 90 days after publication (TTL index). Removing a source deletes its items and follows.                                                                                                                                   |

Health states: **new** (never fetched), **ok**, **failing** (last attempt failed), **blocked** (robots.txt). Admins can pause, resume, fetch now or remove a source.

## Verified starter list

`apps/api/src/modules/content-sources/starter.ts` lists candidate feeds from reputable publishers. They are **disabled until verified**: `verifiedAt` stays `null` until a run of `pnpm --filter @campuslink/api feeds:verify` passes for that feed. The check covers reachability, robots.txt, RSS or Atom parsing and at least one item. The check runs in GitHub Actions (`.github/workflows/feeds.yml`: on demand, weekly, and when the module changes), because the development container's network policy blocks news hosts. The API refuses to add an unverified starter (409).

### Verification results

| Key                      | Publisher | Result | Date |
| ------------------------ | --------- | ------ | ---- |
| (filled from the CI run) |           |        |      |

## Terms and attribution

- Only feeds a publisher offers for syndication are used, and only what the feed itself contains (title, summary, link).
- Each card names the source and links out; the link opens the publisher's site in a new tab with `rel="noopener noreferrer nofollow"`.
- A college admin removes a source if a publisher asks.
