# Performance

Phase 8 load test: one college with 1,000 members, driven through the real HTTP API.

## How to run

```sh
pnpm infra:up
pnpm loadtest            # LOADTEST_DURATION=20 LOADTEST_CONNECTIONS=50 by default
```

`apps/api/src/scripts/loadtest.ts` does the following:

- **Seeds its own database,** `campuslink_load`. It drops that database first and refuses any other name. The data is all fictional and labelled demo:
  - 1,000 members: 30 faculty, 370 alumni and 600 students, with profiles and consents;
  - 5,000 posts spread over 30 days;
  - 20 notifications per member;
  - the roadmap library.
- **Starts one API process** on port 4100 against that database, with rate limits on but scaled ×1000 so the test measures the API rather than the limiter.
- **Signs in 60 members** (40 students, 20 alumni) and rotates their tokens across requests.
- **Runs each scenario with autocannon** for 20 seconds:
  - 50 concurrent connections by default;
  - 10 for sign-in, which is argon2id-bound by design;
  - 10 for a second For You run, to show latency at realistic concurrency.
- **Prints a Markdown table** and exits non-zero if any request fails or returns non-2xx.

## Results (2026-10-16)

Machine:

- 4 vCPU Intel Xeon at 2.10 GHz, Node 22.22.
- MongoDB 8.0 (single-node replica set) and Redis 7.4 in Docker on the same machine.
- One API process run through `tsx` (development mode, no clustering).

The load generator shares the machine, so treat these figures as a regression baseline and a lower bound, not production capacity.

| Scenario                            | Req/s | p50 ms | p90 ms | p99 ms | Max ms | Requests | Non-2xx | Errors |
| ----------------------------------- | ----: | -----: | -----: | -----: | -----: | -------: | ------: | -----: |
| GET /tenant (public)                |  2681 |     16 |     26 |     39 |    368 |    53618 |       0 |      0 |
| GET /me                             |   501 |     94 |    131 |    170 |    247 |    10010 |       0 |      0 |
| GET /feed (For you)                 |    81 |    594 |    689 |   1235 |   2406 |     1627 |       0 |      0 |
| GET /feed (For you), 10 connections |    84 |    114 |    148 |    187 |    529 |     1677 |       0 |      0 |
| GET /feed?tab=following             |   254 |    190 |    240 |    283 |    852 |     5081 |       0 |      0 |
| GET /directory (filter)             |   343 |    141 |    173 |    230 |    827 |     6854 |       0 |      0 |
| GET /directory?q= (search)          |   493 |     98 |    125 |    159 |    635 |     9857 |       0 |      0 |
| GET /notifications                  |   451 |    107 |    135 |    172 |    678 |     9028 |       0 |      0 |
| GET /roadmaps                       |   249 |    197 |    239 |    299 |    945 |     4983 |       0 |      0 |
| GET /jobs                           |   410 |    118 |    150 |    198 |    749 |     8198 |       0 |      0 |
| GET /events                         |   475 |    102 |    129 |    162 |    685 |     9507 |       0 |      0 |
| POST /posts (write)                 |   139 |    350 |    419 |    496 |   1328 |     2780 |       0 |      0 |
| POST /auth/login (argon2id)         |    86 |    112 |    145 |    203 |    286 |     1714 |       0 |      0 |

### Reading the numbers

- **Latency at 50 connections is mostly queueing.** With 50 requests in flight on one Node process, p50 ≈ concurrency ÷ throughput. The 10-connection For You run (p50 114 ms, p99 187 ms) is closer to what a member sees.
- **Demand is far below capacity.** Suppose 20% of 1,000 members open the app in the same busy minute, and each session makes about 10 API calls. That is about 35 requests a second. One process handles that with headroom on every route, and the deployment runs at least two.
- **For You is the heaviest read.** The design ranks at read time ([`feed-ranking.md`](feed-ranking.md)): every request scores the last 30 days of posts (up to 400) for that viewer.
  - A CPU profile showed the time going to BSON decoding and garbage collection, not MongoDB. Every query in the request took under 1 ms in the MongoDB profiler.
- **Writes** (`POST /posts`) do the most work per request:
  - the rate-limit and bot checks;
  - an idempotency record;
  - the author's ranking facts;
  - the post, with plain-text normalisation and hashtag extraction;
  - the points award, with its dedupe and daily-cap checks;
  - the post view returned to the author.
- **Sign-in** is argon2id at 19 MiB and t=2 by design (ASVS). About 86 per second per process is plenty, and the login limiter caps it per IP and per account long before that.

## Changes made from the results

- **For You ranks on a projection, then loads only the page.** Before, it fetched 400 full post documents (bodies up to 3,000 characters, media, polls) to rank them. Now `PostsService.rankingCandidates()` selects only the ranking fields, and `byIds()` loads the 15 posts on the page.
  - At 50 connections: 73 → 81–88 req/s, p50 667 → 543–594 ms.
  - Rankings are unchanged; the feed tests pass.
- **Bug in the load test, not the API:** the first run's `POST /posts` used idempotency keys containing spaces and `/`. The API correctly rejected them with 400; the key format is 8–100 letters, digits, `_` or `-`.

## Next steps (when real traffic needs them)

1. **Cache For You candidates per college for about 15 seconds**, in Redis or in process.
   - Scoring stays per viewer, so personalisation, blocks and hidden authors still apply on every request.
   - Not done yet: a new post would take up to 15 seconds to reach For You, while Following shows it at once. Two API processes already give a margin of more than 4× over the estimate above.
2. **Run the compiled build** (`node dist/server.js`) with one process per vCPU. These figures come from `tsx` in development mode with one process.
3. **Add a scenario for Socket.io message delivery** (send through REST, receive on a socket) to the load test.

## Study search and the assistant (Phase 9, 2026-10-23)

`pnpm --filter @campuslink/api study:perf` (spec §12 targets): its own database (`campuslink_perf`, dropped afterwards), 50,000 synthetic DEMO passages in 50 subjects with demo vectors, the in-memory vector store, and a faculty viewer who reads every subject (the widest search). It exits non-zero when a target is missed. Same development sandbox as above (`tsx`, one process).

| Check                                                  | Runs   | Result                      | Target             |
| ------------------------------------------------------ | ------ | --------------------------- | ------------------ |
| Passages generated                                     | 50,000 | about 39 s                  |                    |
| First search (loads the college's vectors into memory) | 1      | about 2 s                   | once per process   |
| Keyword search only                                    | 50     | p50 42 ms · p95 138 ms      |                    |
| Vector search only (in memory)                         | 50     | p50 75 ms · p95 118 ms      |                    |
| **Hybrid retrieval, all 50 subjects**                  | 200    | **p50 107 ms · p95 153 ms** | p95 < 300 ms: pass |
| **Chat with the demo responder: first words**          | 10     | **p50 137 ms · max 258 ms** | < 1.5 s: pass      |

- **The corpus is shaped like a real library:** each subject has its own topic words, every passage shares a long tail of common words (Zipf's law over 4,000 words), and a question names two topic words and one shared word.
- **Worst case** (`STUDY_PERF_VOCAB=small`: every passage made of the same 70 words, so a question's words are in about 75% of passages and MongoDB's text search must score them all): keyword search alone is p95 467 ms. Hybrid retrieval still meets the target (p50 237 ms, p95 257 ms), because the two halves run at the same time and, when search by meaning is available, the keyword half has a 200 ms limit (`KEYWORD_BUDGET_MS`) after which the meaning results answer alone. With keyword search only (no embedding provider), such a query is not cut short.
- **Changes made from the results:** keyword and vector search now run concurrently (they ran one after the other), and the keyword time limit above.
- **Streaming at 60 fps:** the chat panel batches streamed text into one update per animation frame and only follows the bottom while the reader is at the bottom; this is not measured by the script.
- **Next steps for much larger libraries:** Qdrant instead of the in-memory store (vector search then leaves the API process), and a dedicated text engine (MongoDB Atlas Search or Meilisearch behind the same retrieval service) if keyword search on very common words matters without embeddings.
