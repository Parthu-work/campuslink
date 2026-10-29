# Build progress (master prompt 1)

A new session reads this file first and resumes from the first phase that is not **Done**. The prompt is [`master-prompt-1.md`](master-prompt-1.md); the codebase map is [`facts.md`](facts.md).

| Phase | Name                                                           | Status      |
| ----- | -------------------------------------------------------------- | ----------- |
| B1    | Feature switches and the cut list                              | Not started |
| B2    | Phone-first identity, age and guardian consent                 | Not started |
| B3    | WhatsApp and SMS channels                                      | Not started |
| B4    | One-tap invites and class onboarding                           | Not started |
| B5    | Mentorship loop that never dead-ends                           | Not started |
| B6    | TPO console                                                    | Not started |
| B7    | Placement drives                                               | Not started |
| B8    | Placement outcomes and accreditation reports                   | Not started |
| B9    | Product analytics                                              | Not started |
| B10   | Plans, entitlements and billing                                | Not started |
| B11   | AI cost control                                                | Not started |
| B12   | Hindi and the language framework                               | Not started |
| B13   | Offline and low-data mode                                      | Not started |
| B14   | In-app help, feedback, legal pages and app-level observability | Not started |
| B15   | Hardening, demo data and final report                          | Not started |

## Step 0 · Set up

- **Baseline:** `main` is at `35fc3e4`; `claude/sleepy-euler-bi65m3` is at `df83e3c` (six commits past `cc965b1`: revamp phases 12 and 13), a straight continuation of `main`. The gate is green on `df83e3c` (format, lint, typecheck, 120 shared + 55 web + 758 API tests, build, bundle budget 169.5 KB, gitleaks).
- **Branch rule (deviation from Step 0.1):** this session must develop and push on `claude/keen-babbage-ts0wgj` and may not push to any other branch, so `main` was **not** fast-forwarded. The working branch was fast-forwarded to `df83e3c` and every phase is pushed there. Fast-forwarding `main` to it is left to the owner.
- **ADR numbering (conflict inside the prompt):** D6 asks for the AI-cost override to be ADR 0009, and B15 lists 0009 to 0012 for phone identity, WhatsApp, placements and plans. Decisions in §1 win, so the numbers shift by one: **0009** AI cost and model tiers (D6), **0010** phone-first identity and minors, **0011** WhatsApp channel and action tokens, **0012** placement records survive erasure in anonymised form, **0013** plans, entitlements and read-only on non-payment.
- **Local infrastructure** notes (Docker Hub rate limits, MongoDB open-file limit) are in `facts.md` › Corrections.
