# Revamp progress log

The plan is `master-prompt.md` §12; the requirements are `audit.md`; the Study feature is `docs/specs/ai-study-assistant.md`. A new session reads this file first and resumes from the first phase that is not **Done**.

Branch: the session branch rule applies (`claude/sleepy-euler-bi65m3`, started from the audit commit `f05e94c`). It overrides `CLAUDE.md`'s "work on `main`", as it did for the audit.

| Phase | Name                                                                        | Status      |
| ----: | --------------------------------------------------------------------------- | ----------- |
|     0 | Setup (prompt, spec, progress log)                                          | Done        |
|     1 | Critical fixes (platform landing, desktop rail, D3, error boundaries, D1)   | Not started |
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
