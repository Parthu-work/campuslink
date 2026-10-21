# Revamp progress log

The plan is `master-prompt.md` §12; the requirements are `audit.md`; the Study feature is `docs/specs/ai-study-assistant.md`. A new session reads this file first and resumes from the first phase that is not **Done**.

Branch: the session branch rule applies (`claude/sleepy-euler-bi65m3`, started from the audit commit `f05e94c`). It overrides `CLAUDE.md`'s "work on `main`", as it did for the audit.

| Phase | Name                                                                        | Status      |
| ----: | --------------------------------------------------------------------------- | ----------- |
|     0 | Setup (prompt, spec, progress log)                                          | Done        |
|     1 | Critical fixes (platform landing, desktop rail, D3, error boundaries, D1)   | Done        |
|     2 | Quick wins (all 24)                                                         | Not started |
|     3 | Navigation and transitions (§7a, §7b, role-aware navigation)                | Not started |
|     4 | Performance (§7d, CI bundle budget)                                         | Not started |
|     5 | Foundations (tokens, fonts, palette generator, contrast tests, ADR)         | Not started |
|     6 | Living style guide (`/design`) — **stop for owner review with screenshots** | Not started |
|     7 | Primitives (`components/ui/` rebuild, duplicates merged)                    | Not started |
|     8 | Showpiece screens                                                           | Not started |
|     9 | Study feature (spec §13 steps 1–6, each a stop-for-review point)            | Not started |
|    10 | Remaining screens                                                           | Not started |
|    11 | Polish                                                                      | Not started |
|    12 | Re-audit (`after/`, `summary.md`, scorecard)                                | Not started |

## Phase 0 · Setup

- Saved the owner's brief: `master-prompt.md` (everything above Appendix A) and `docs/specs/ai-study-assistant.md` (Appendix A).
- Both are listed in `.prettierignore` so the format check never rewrites them; they are verbatim copies.
- Next: Phase 1.

## Phase 1 · Critical fixes

What was done:

- **Platform landing (IA-10) and deep links (IA-8).** Sign-in and `PublicOnly` send members back to the page that asked for sign-in (`safeReturnPath` in `packages/shared/src/navigation.ts` accepts only same-origin app paths), otherwise to the tenant kind's home (`/platform` for the console). An e2e test per role asserts the landing route (`e2e/shell.spec.ts`).
- **Role-aware navigation (IA-1, IA-3; decisions D2, D4).** One navigation model in `packages/shared/src/navigation.ts` (`buildNav`) derives bottom tabs, the desktop rail, the avatar menu, the Create sheet and the command palette's "Go to" list from roles and permissions. Tabs per persona follow `master-prompt.md` §7 with fallbacks while Study, Subjects and Review are not shipped (student: Home, Roadmaps → Study, Create, Mentors, Jobs; alumni: Home, Requests, Create, Mentors, Jobs; staff and admin: Home, Roadmaps → Subjects, Create, Admin → Review, Jobs). Profile, Settings and Sign out live behind the avatar for every role; Messages and Notifications are top-bar icons with counts.
- **Desktop rail (IA-2).** The rail scrolls on its own, collapses to icons below 1280 px, and pins the account menu at its foot. An e2e test checks every rail item is reachable at 1440×900, 1280×720 and 1024×768.
- **Fictional alumni removed (VI-1, D3).** The landing "wall" and its strings are gone for every college; an e2e test asserts no names appear.
- **Error boundaries and stale chunks (ST-0, §7c).** Screens load through React Router `lazy` with `importWithRetry` (one retry, then one guarded reload into the screen being opened, never a loop; `vite:preloadError` handled the same way). Every screen, both layouts and the root have an error element in the design system (`components/layout/route-error.tsx`); inside the shell only the content area changes. The service worker now claims the page on first install (`clientsClaim`), and a controller change reloads only after the member accepts an update. E2e tests cover a blocked chunk (one reload at most, then a friendly state, then Reload works), and offline navigation to an unvisited screen.
- **No more full-screen spinners (TR-1, ST-1, TR-5).** Per-route Suspense wrappers are gone: the router keeps the current screen while the next one's code loads, a thin progress bar appears after 150 ms, and the first load of a screen shows a content-area skeleton that fades in only after 200 ms. While `/me` loads, a shell outline shows instead of a spinner; if it fails, a retryable, offline-aware state shows.
- **Silent sign-outs (PW-8, D1), client only.** `lib/refresh-coordinator.ts`: single-flight refresh, Web Locks across tabs (BroadcastChannel fallback), a tab that waited adopts the other tab's fresh token instead of rotating again, `keepalive` so closing a tab cannot strand a rotated cookie, and network or server errors keep the session. Sign-out is announced to other tabs. Unit tests simulate the server's reuse detection; e2e tests open three tabs at once and close a tab mid-refresh on a slow network. **PW-8 no longer reproduces**, so no server change is proposed.
- **Also fixed on the way:** sheets as history entries for the account and Create sheets, the composer (`?compose=`) and the Ask form (`?ask=`), so Back closes them (PW-2, partial); re-tapping the active tab scrolls to top, again refreshes (NB-3); the offline banner no longer covers the top bar (PW-9); `⌘K` on Apple devices (A11Y-7); `ApiError` carries the request id for error screens.

Deviations and decisions:

- TR-2 and PF-1 (Critical) are structural and are the subject of phases 3 and 4; phase 1 removed the visible symptom of TR-2 (spinner → skeleton → content) and set up the loader-ready route table.
- Docker's default file limit let Mongo crash (`Too many open files`) during the coverage gate; dockerd now runs with `--default-ulimit nofile=20000:20000` in this container. Not a code issue.
- The pinned gitleaks image could not be pulled through the proxy; the same pinned release (8.30.1, checksum verified against the release's checksums file) ran as a binary.

Next: Phase 2 (quick wins).
