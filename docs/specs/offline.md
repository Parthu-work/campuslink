# Offline and low-data mode (build B13)

## Goal

The core screens work on a bad connection, stay readable offline, and use less data on 2G or when the member asks.

## Offline copy

- **Where.** IndexedDB on the device, database `cl-offline`, stores `queries` and `outbox`. The code is `apps/web/src/lib/offline-cache.ts` (its own chunk, loaded at boot in parallel with the college and session; nothing in the first load) with the rules in `lib/offline-rules.ts`.
- **What.** `persistable()` allowlists the member's own reads: `tenant`, `me`, `bookings` (upcoming, past), `conversations`, `conversation/:id`, `messages/:id` (newest 50), `job-tracker`, `roadmaps/following`, `roadmap/:slug`, `placement-drives/registered`, `placement-drive/:id`, `material/:id`, and `feed/for_you` (first page). Contact fields are stripped from everything but `me` (`stripContacts`). At most 80 entries; anything older than `OFFLINE_MAX_AGE_DAYS` (7) is dropped on restore.
- **Owner.** Every entry carries the member id from `me`; on restore only entries of the saved `me` are used. A `me` answer with a different id wipes the copy.
- **Restore.** At boot, saved reads go into the query cache where the cache has nothing yet (with their original `updatedAt`), and the first render waits at most 400 ms for that. Normal fetching then replaces them; `useSavedCopyAt()` (`lib/offline-state.ts`) reports the oldest saved read still on screen.
- **Saving.** A successful fetch of a persistable read is written within 800 ms (batched), only while signed in.
- **Wiping.** On sign-out, on a dead session (status `signed-out` for any reason) and on another member's `me`: IndexedDB is cleared and every restored read is dropped from memory.

## Offline session

`refreshSession()` (`lib/api.ts`) keeps its behaviour, except when the check fails because the network or API is unreachable at boot: if the device holds a saved copy for a member (`hasOfflineCopy()`, `lib/offline-probe.ts`), the session status becomes `offline` instead of `signed-out`. The app then opens read-only from the copy (`RequireAuth` lets `offline` through; no access token exists, so nothing can be written to the API). On the `online` event, and every 30 s while the API is unreachable, the session is checked again: success signs in normally, a dead session signs out and wipes the copy. Tokens, refresh rotation and `refresh-coordinator.ts` are unchanged.

## Status pill

`AppStatus` shows "You're offline · saved {when}" offline with saved data on screen, "You're offline" with none, and a quiet "Updated {when}" online while saved data on screen has not been refreshed yet.

## Offline writes

`putOrQueue()` (`lib/offline-writes.ts`) sends three safe, state-setting PUTs with a fresh Idempotency-Key: `PUT /events/:id/rsvp`, `PUT /jobs/:id/track`, `PUT /roadmaps/:id/progress`. Offline (or on a network error) the write goes to the `outbox` store with its key and the optimistic change stays on screen ("Saved on this phone…"). The outbox is replayed oldest first when the connection returns or the member signs in; a refused write is dropped with a message, a network error stops the replay. The three routes are marked `idempotent: true` in the API, so a replay after a lost answer applies once. Every other write still fails with "you're offline".

## Data saver

`Settings › Preferences › Data saver`: Automatic (default), On, Off, stored per device (`cl:dataSaver`). Automatic is on when the browser reports `navigator.connection.saveData` or an `effectiveType` of `2g`/`slow-2g`. In effect:

- images are fetched at the width they are shown (`GET /files/:id?w=160|320|640`, WebP at quality 55, never enlarged, access checked exactly as for the original; the API keeps up to 300 variants in memory);
- stories are left off Home;
- videos preload nothing until play (no video autoplays anywhere).

## Not done

- **Digests over WhatsApp instead of push.** There is no digest feature yet (only the `email_digests` consent); this waits for digests to exist.
- **A cold start offline needs the service worker** to have cached the app's code (it does after the first visit); the very first visit cannot work offline.

## Tests

- `apps/web/src/lib/offline-rules.test.ts`: the allowlist, contact stripping, feed and message trimming, data-saver decisions.
- `apps/api/test/offline.test.ts`: `?w=` sizes, refused widths, access and tenant isolation, an idempotent RSVP replay.
- `apps/web/e2e/offline.spec.ts`: an offline cold start from the saved copy, the copy wiped on sign-out, an offline RSVP sent on reconnect, the data-saver setting.
