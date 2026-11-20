# After set for prompt 3 (U13)

Captured on 20 November 2026 on the owner's machine, from `main` at U12 (`7c4b5a1`) with U13's fixes, using the audit scripts in `apps/web/e2e/audit/` and `AUDIT_OUT=docs/build/after-3`. The before set is [`../before-3/`](../before-3/) (`094acfc`); the comparison is in [`../report-3.md`](../report-3.md).

Commands (each run that changes data starts on a fresh seed; nothing else ran on the machine at the same time):

```bash
pnpm --filter @campuslink/web audit:capture
pnpm --filter @campuslink/web audit:journeys -g "journeys, throttled"
pnpm --filter @campuslink/web audit:journeys -g "journeys, unthrottled"
pnpm --filter @campuslink/web audit:extras
pnpm --filter @campuslink/web audit:language
pnpm --filter @campuslink/web audit:tasks
KEYBOARD=1 pnpm --filter @campuslink/web audit:tasks
pnpm --filter @campuslink/web audit:lighthouse
```

Screenshots are re-encoded as palette PNGs (quality 90), as in the before set.

## What changed in the scripts

The journeys, extras and tasks scripts walked the old navigation. They now walk the five spaces (U2), with the same steps where the screens still exist:

- **Journeys.**
  - J3 switches Home, Learn, Mentors and Career. The before set switched Home, Study, Mentors and Placements.
  - J4, J5, J8 and J10 open screens from their space's tab and section row instead of the account menu.
  - J6 opens notifications from the inbox.
  - J9's back and forward land on Events, Progress and Events: the order the spaces give.
- **Extras.**
  - The offline probe opens Events from Home's section row.
  - The scroll test uses the Career tab.
- **Tasks.** Task e asks through Ask, the one assistant since U8. Its study scope answers from every subject, so no subject is picked first.

## What is here

- **`after/`**: 1,152 screenshots with the same names as the before set's.
- **`data-after/`**:
  - the before set's files;
  - `truncation-360.json` and `truncation-1440.json` (the language audit);
  - `tasks.json` and `tasks-keyboard.json` (the U0.2 tasks, by tap and by keyboard).

## How the run went

- **Admin screens.** DPIT's were re-captured after U13's fixes (the AI assistant screen's width, the account button). The other roles' 1440 px pictures were taken before the account-button fix, so their sidebar foot still shows the name cut short ("Demo St…"); the 1440 px language audit is clean on today's code.
- **Journeys.** The first journeys run after the capture ran under heavy machine load (7.2 minutes against 3.0 for the same run later, Back steps at 4 s instead of 0.7 s). It was discarded, and both journeys were run again after the machine restarted.
- **Lighthouse.** The run here is the second on this build after the restart. Companies was measured again after U13's layout-shift fix, and its file and row were replaced. A third run, and two runs of the before build (`094acfc`) on the same machine, are summarised in `report-3.md`.
- **Profile view.** `lighthouse-profile-view-cold` is not a cold load in any run (21–34 KB transferred, in the before set too), so the report leaves it out.

## Headline numbers

- axe (WCAG 2.2 AA): 598 scans, no violations.
- Targets under 44 px: none, on 134 measured screens (90 on 23 in the before set). No screen is wider than a 360 px phone.
- Meaning cut short: none at 360 or 1440 px, in English, Telugu or Hindi.
- Tasks, before → after (taps/fields):

  | a           | b           | c         | d         | e         | f         | g         |
  | ----------- | ----------- | --------- | --------- | --------- | --------- | --------- |
  | 13/7 → 14/7 | 11/4 → 13/5 | 5/1 → 1/0 | 3/0 → 3/0 | 7/2 → 5/1 | 5/1 → 4/1 | 2/0 → 2/0 |

  Every task also completes by keyboard alone.

- Lighthouse, mean LCP of two runs, before → after on this machine: landing 6.1 → 1.7 s, sign-in 4.9 → 4.2 s, Home 6.6 → 6.0 s. The full table is in `report-3.md`.
