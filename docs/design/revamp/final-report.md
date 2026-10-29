# CampusLink revamp: final report

The master prompt's §13, in full. The before/after detail is in [`summary.md`](summary.md); the work, phase by phase, in [`progress.md`](progress.md); the audit it answers in [`audit.md`](audit.md).

## What was built

Thirteen phases on the session branch `claude/sleepy-euler-bi65m3`, each with the full gate (format, lint, typecheck, unit and API tests with the isolation and permission suites, build, bundle budget, API coverage, secret scan, the end-to-end suite) and a green CI run.

- **Critical fixes and quick wins (phases 1–2):** role-aware navigation from one model, the platform admin's landing, deep links through sign-in, error boundaries and stale-chunk recovery, no full-screen spinners, no silent sign-outs (client only), the fictional alumni removed, and all 24 quick wins.
- **Navigation and performance (phases 3–4):** scroll-aware bars, tab memory, code and data loaded together, view transitions, Back that closes sheets and restores the exact scroll, optimistic updates; first-load JavaScript from 301 to 169 KB with a CI budget.
- **Campus Aurora (phases 5–8, 10–11):** a palette generated from each college's colour and contrast-tested for any colour, a fluid type scale with Geist and Anek Telugu, elevation and springs, a living style guide, one set of primitives with lint rules that keep screens on them, the ten showpiece screens (verification, Home, mentors and booking, requests, sessions and chat, the Career Galaxy, progress, jobs and referrals, events, profile, landing), the admin overview and grouped menu, college logos and a manifest per college, error states that never look empty, pull to refresh, sticky form actions, drafts that survive, and a world-class-bar review of every screen.
- **The AI Study Assistant (phase 9, Appendix A):** subjects and syllabi, material upload with a processing pipeline (scan, extract, OCR, transcripts, chunks), viewers for PDFs, video and notes, hybrid search, a cited assistant that streams and answers only from the college's material, slash commands, budgets and graceful degradation, faculty insights, an AI admin dashboard, a separate worker, and the seeded FLAT demo.
- **Re-audit (phase 12):** the audit's scripts recreated in `apps/web/e2e/audit/` (outside the normal e2e run), `after/` and `data-after/` matching `before/` and `data/`, and `summary.md`.

## Before/after scorecard

|   # | Area                         | Before | After |
| --: | ---------------------------- | :----: | :---: |
|   1 | Visual identity              |   3    |   4   |
|   2 | Design system consistency    |   2    |   5   |
|   3 | Typography                   |   3    |   4   |
|   4 | Navigation and IA            |   2    |   4   |
|   5 | Nav bar scroll behaviour     |   2    |   4   |
|   6 | Screen-to-screen transitions |   1    |   4   |
|   7 | Feedback and states          |   2    |   4   |
|   8 | Motion                       |   2    |   4   |
|   9 | Forms and input              |   3    |   4   |
|  10 | Accessibility                |   3    |   4   |
|  11 | Performance as experienced   |   2    |   3   |
|  12 | Mobile and PWA feel          |   2    |   4   |
|  13 | Microcopy and tone           |   4    |   5   |
|  14 | Per-role experience          |   2    |   4   |

The targets were transitions at least 4 (met) and every area at least 4 (met in 13 of 14). Performance is 3: the installed app and the public pages are inside the budget, a first visit on a cold cache is not (see Known gaps). The reasons for every score are in `summary.md` §2.

## How every audit finding was addressed

`summary.md` §4 lists all 90 findings with what was done and where. In short:

- **Fixed: 84.**
- **Partly fixed: 5.** ST-6 (a few plain placeholders remain on slow reads); PF-1 (initial JS within budget and the boot parallelised, but cold first-visit LCP is still 4–5 s); PF-5 and PW-6 (videos stream through signed links; images keep the session-cached authenticated download, because caching private images across launches is an owner decision); PW-4 (pull to refresh, no tap flash and no rubber-banding are in; iOS splash images and status-bar style wait for a real iPhone).
- **Deferred: 1.** PW-5, offline copies of the feed, sessions and messages: they keep members' private data on the device beyond the session, a privacy decision for the owner (D5). Offline today: code is precached, visited screens work, unvisited ones show a friendly offline state inside a working shell.
- **Not verifiable here: A11Y-8** (screen readers, Telugu speech, 200% zoom), on the list below. The audit's three "done well" notes (ST-7, FO-7, PW-7) still hold.

## Attaching an LLM API key (college admin)

1. Sign in as a college admin (two-factor authentication is required for admins) and open **Admin › AI assistant** (`/admin/ai`; on a phone, Admin is in the avatar menu). The **Set-up steps** checklist at the top ticks off as you go.
2. Under **Answer provider**, choose **Anthropic (Claude)**, **OpenAI**, **Google Gemini** or **OpenAI-compatible server** (then enter its public `https://…/v1` address under **Endpoint address**). **Demo (built in)** tries the whole flow with no key and sends nothing anywhere. Press **Save settings**.
3. Paste the key into the **<provider> API key** field that appears and press **Save and test**. The key is encrypted at once and never shown again (only its last four characters are); the test makes one small request (the provider's model list) and shows **Working** or the provider's reason for refusing it. Choose the **Answer model** from the models the key can use (Anthropic defaults to `claude-opus-5-5`) and press **Save settings**.
4. Optional, for search by meaning: under **Semantic search (embeddings)**, choose an **Embedding provider** and **Embedding model**, and press **Save settings**. Anthropic has no embeddings API, so pair Claude answers with OpenAI, Gemini or a compatible server (a second key field appears for it; press **Save and test**), or leave it at **None (keyword search)**. Once a working key is saved and the notice accepted, existing material is indexed automatically; the search-index panel shows progress and the checklist ticks **Search index ready**.
5. Under **Data processing notice**, read what leaves the college (passages of uploaded material and students' questions; never names, emails, roll numbers or profile data) and press **I accept, on behalf of the college**. External providers stay off until the current notice is accepted; the acceptance is versioned and audit-logged.
6. Under **Switches**, turn on **Study chatbot**; under **Limits and budget**, check the **Monthly token budget** (0 means none; when it runs out members get passages instead), **Questions per member per day**, answer length, passages per answer and how long chats are kept; press **Save settings**. The status at the top reads **On**.
7. Optional, for the cost estimate: under **Prices for the cost estimate**, enter the provider's prices per million tokens exactly as its pricing page lists them, in the currency you pay. The app never fills these in.

**Stop all AI now** (the kill switch) stops every request to any provider at once; search and the library keep working. Removing a key, changing provider, accepting the notice and every test are audit-logged; the key itself never appears in a response, a log or the audit log. Platform-wide defaults and private endpoints are environment settings for the platform owner (`docs/ai-assistant.md`).

## Assumptions

- **Branch:** all work is on `claude/sleepy-euler-bi65m3` (the session's branch rule), not `main` as `CLAUDE.md` says; nothing was merged and no pull request was opened.
- **API changes** stayed within what the brief allows (D1, Appendix A and the owner's decisions Q7, Q9 and Q12), with one exception for the owner to confirm: `GET /api/v1/admin/overview` (phase 10), a read-only count of what each admin section already lists, behind the same permissions, with member and activity counts through `suppress()`. If the owner prefers no additions, the module can be removed and the overview reduced to the section list.
- **Media:** videos stream through the owner-approved five-minute signed links (Q9); images keep the authenticated download, cached for the session.
- **Study:** a semester is descriptive (batches decide who takes a subject); usage and budgets use UTC days and months; the cost estimate uses only prices the admin enters.
- **Numbers** in `summary.md` come from one cloud container with simulated throttling; compare them before and after, not with field data.

## Known gaps

- **Performance on a first visit is the one area below the target (3 of 5).** On a cold cache at simulated 4× CPU the largest paint takes 4.1–5.3 s (Lighthouse 56–74 signed in); the installed app (81–93) and the public pages (86–87) are inside the brief's budget. Back to Home and Jobs takes 0.6–0.7 s on a throttled phone because those screens render more than before. What would close it is in `summary.md` §3: a cached first screen (an owner decision, below), lighter first renders of Home and Jobs, or server rendering.
- **Offline copies (PW-5)** and **caching images across launches (PF-5, PW-6)** both store members' private data on the device beyond the session: decisions for the owner (D5), not made here.
- **iOS splash images and status-bar style (PW-4)** need checking on real iPhones before they are added.
- **A few placeholders** (forms and panels on slow reads) are still plain blocks rather than shaped skeletons (ST-6).
- **View transitions are adaptive:** devices that are already dropping frames switch screens without the animation (measured: transitions cost 300–500 ms per tap at 4× CPU). On a capable phone every screen change animates.
- **Not shown because the API does not provide it:** a mentor's reply time and next free slot, mentor impact stats and reviews, company logos, and the faces of alumni at a company (only counts).
- **Faculty reading chats** (`facultySeeChats`) is stored but does nothing: whether faculty may ever read students' conversations is a privacy decision for the owner.
- **The worker image** could not be built in this sandbox (the proxy blocks npm inside `docker build`); build it and run `deploy/staging/up.sh --build` and `smoke.sh` on a normal machine.
- **AI providers** were tested against recorded-format fakes, not live keys; Whisper and OpenAI transcription were tested with fakes; the Atlas vector store is documented, not tested.
- **`pnpm audit`** reports one low, build-time advisory (deepmerge in vite-plugin-pwa's workbox-build) with no fixed release.

## Verify yourself

- **Provider terms and pricing:** each provider's data-use and retention terms for API traffic (education, minors if any students are under 18), their current prices (enter them under Limits for the estimate), regional availability and rate limits.
- **Legal review:** the AI data-processing notice the college accepts (Admin › AI assistant), the consent and privacy texts, and the terms for uploaded material (copyright of notes, slides and videos; the takedown flow).
- **Real devices:** an installed Android PWA and iOS Safari (back gesture, notch, pull to refresh, splash, each college's icon and name), low-end Android performance, bright-sunlight legibility.
- **Screen readers:** NVDA, VoiceOver and TalkBack through the main journeys, Telugu speech, and 200% text zoom.
- **Telugu:** a native speaker's review of every string.
- **Live keys:** attach a key per provider and run a few questions, `/quiz` and an embeddings back-fill; check the cost estimate against the provider's dashboard.
