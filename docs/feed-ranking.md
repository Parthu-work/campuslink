# Feed ranking

The feed has two tabs. Both run on the server (`apps/api/src/modules/feed/feed.service.ts`); the client only renders the results.

## Following (chronological)

Newest first. It includes:

- your own posts;
- posts by people you follow;
- posts tagged with topics you follow;
- items from news sources you follow, and items tagged with topics you follow.

Posts and items are merged by time. The cursor is the timestamp of the last entry shown. Nothing is boosted or hidden except blocked people and removed content.

## For you (ranked)

Candidates are published posts from the last 14 days (up to 400) and published news items from the last 7 days (up to 300). With no follows, items are drawn from every active source, so a new member's feed is never empty. Each candidate gets one score:

```
score   = recency × boost
recency = 0.5 ^ (age in hours / 24)          half-life of one day
boost   = 1
        + 1.0  if you follow the author
        + 0.8  if you follow the source (news items)
        + 0.3 × min(3, topics you follow on it)
        + 0.3  if it matches your branch (author's branch, or the item's branch tags)
        + 0.25 if the author is an alumnus
        + 0.5  if it is an official college announcement
        + 0.15 × ln(1 + engagement)
engagement = reactions + 2 × comments + saves
```

Choices:

- **Shares are excluded from engagement.** They are too easy to inflate, and a share is not proof that a post was useful.
- **Engagement is logarithmic and small.** Three comments help; three hundred don't bury everything else. Fresh posts from people you follow will usually beat yesterday's popular post.
- **There are no personal behaviour signals.** There is no dwell time, no click tracking and no hidden profile. The inputs are what you chose to follow, your branch and public counts, so the ranking is explainable and fits data minimisation (`docs/privacy.md`).
- **Ties are broken by time, then id,** so the order is deterministic.

### Stable paging

The For you cursor is an opaque `{asOf, offset}`. Every page is ranked as of the first page's time (`asOf`), so posts published while you scroll don't shift later pages or cause duplicates. Pull to refresh (or switch tabs) to start a new snapshot. Offsets are capped at 2,000.

## One Useful Thing

There is one card per day (Asia/Kolkata date):

1. a post or item a staff member featured today (`announcements:post`);
2. otherwise, the most engaged alumni text, reel or link post from the last 48 hours (helpful × 2 + saves × 3 + comments), if anyone found it useful;
3. otherwise, the newest item from a source or topic you follow.

## Tests

`test/feed.test.ts` covers the scoring maths, cursor validation, stable pages when new posts arrive, followed-author boosts and the Following tab's filters.
