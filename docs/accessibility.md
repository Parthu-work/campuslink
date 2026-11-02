# Accessibility

**Target:** WCAG 2.2 level AA, in English and Telugu, in dark and light themes, on phones from 320 CSS px up and on desktop. The design rules are in [`design/design-brief.md`](design/design-brief.md); this page records how they are checked.

## Automated checks (every CI run)

| Check                                          | Where                                                   | What it covers                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| axe-core (WCAG 2.0 A/AA, 2.1 AA, 2.2 AA rules) | `expectNoA11yViolations()` in `apps/web/e2e/helpers.ts` | 56 scans across the end-to-end specs, each on a mobile (Pixel 7, 412 px) and a desktop project. Scans wait for data and entrance animations, so contrast is measured on final colours                                                                                                                           |
| Both themes                                    | `apps/web/e2e/core.spec.ts`                             | Sign-in and the main screens scanned in dark and in light (`prefers-color-scheme`), plus the manual theme switch                                                                                                                                                                                                |
| Keyboard-only journey                          | `apps/web/e2e/accessibility.spec.ts`                    | Sign in with the keyboard; after the client-side navigation focus is on the main region; on a fresh load the first Tab reaches "Skip to content", which moves focus to the main region; Tab through the navigation to Jobs, with a visible focus indicator; open and close the command palette (Ctrl+K, Escape) |
| Reduced motion                                 | `apps/web/e2e/accessibility.spec.ts`                    | With `prefers-reduced-motion: reduce`, `--motion-scale` is 0, so every token-driven animation and transition is instant                                                                                                                                                                                         |
| Reflow at 320 CSS px (WCAG 1.4.10)             | `apps/web/e2e/accessibility.spec.ts`                    | Home, People, Jobs, Roadmaps, Events, Progress, Messages and Settings → Your data: no horizontal scrolling at 320 px, the equivalent of 400% zoom on a 1280 px screen                                                                                                                                           |
| Offline banner                                 | `apps/web/e2e/pwa.spec.ts`                              | Announced with `role="status"` and scanned by axe                                                                                                                                                                                                                                                               |

## Built-in patterns

- **Focus management:**
  - A skip link comes first in the tab order, and `main#main` takes focus.
  - On a route change, focus moves to the main region unless it is already inside it (`apps/web/src/lib/route-focus.ts`). Without this, Chrome keeps the Tab starting point where a removed element had been.
  - Dialogs (Radix) trap and return focus.
- **Visible focus:** a 2 px accent outline with a 3 px offset on `:focus-visible` (`styles/index.css`).
- **Colour:** tenant colours are applied through contrast-corrected `*-ink` tokens (5.5:1 or better). Status is never shown by colour alone; badges and states carry text or an icon.
- **Motion:** only transform and opacity are animated, scaled by `--motion-scale`, which follows `prefers-reduced-motion` or the in-app setting.
- **Alternatives:**
  - The Career Galaxy has a list view.
  - Charts are SVG with `role="img"` and text labels, and every number is also shown as text.
  - Swipe gestures have buttons.
  - Every image a member uploads asks for alt text.
- **Language:** every string goes through the translation runtime (`src/i18n`, `en.json`, `te.json`), and `lang` switches with the language, so screen readers use Telugu voices.
- **Live regions:** toasts (sonner), the offline banner and the update prompt use polite live regions; errors use `role="alert"`.

## What Phase 8 verified

The Definition of done asks for 360 px and desktop widths, both themes, reduced motion and keyboard navigation. Each of these is covered by automated checks in Chromium, run on 2026-10-16:

- **Widths:** the Pixel 7 project (412 px) and the 320 px reflow check cover narrow screens; the desktop project covers wide ones.
- **Themes:** the core spec runs both.
- **Reduced motion** and **keyboard navigation:** covered by the accessibility spec.

This phase did not include a manual screen-reader pass. Automated tools cannot judge reading order, announcement quality or Telugu speech (see the gaps).

## Gaps

| Gap                                                              | Owner   | Next step                                                                                                       |
| ---------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| No testing with assistive-technology users                       | Product | Sessions with screen-reader users (NVDA on Windows, TalkBack on Android) before launch, including Telugu speech |
| Axe in light theme covers the core screens only                  | Web     | Run the axe scans of the later specs in both themes too (doubles their run time)                                |
| 200% text-only zoom (browser text-size setting) is not automated | Web     | Add a check with `font-size: 200%` on `:root` for the main screens                                              |

## B12 to B14 screens (prompt 1b, R3, 2 November 2026)

`e2e/audit/b12-b14.audit.ts` (run with `pnpm --filter @campuslink/web exec playwright test -c e2e/audit/playwright.config.ts b12-b14` against a freshly seeded database) checks, at 360 px (touch, DPR 2) and 1440 px, in light and dark, with reduced motion: axe (WCAG 2.2 AA), interactive targets under 44 px that WCAG does not exempt, sideways scrolling, and whether Tab alone reaches every control (a radio group counts as one stop). Screens: Settings › Preferences (language switch, data saver) in English and Hindi, Home in Hindi, the offline pill, Help, a guide, Report a problem, a report thread, Settings › Privacy › Grievance officer, `/legal/privacy`, `/legal/terms`, Admin › Support, Admin › Branding › Legal details, Platform › Support, and the notice gate (after the college publishes new details). 60 checks; results in `docs/design/revamp/data-after/b12-b14.json`.

| Check               | Result                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| axe (both themes)   | No violations on any screen                                                                                                                                                                                                                                                                                                                                             |
| Sideways scroll     | None at 360 px, in Hindi included                                                                                                                                                                                                                                                                                                                                       |
| Keyboard only       | Every control reached with Tab on every screen                                                                                                                                                                                                                                                                                                                          |
| Targets under 44 px | **Fixed:** the standalone legal links (Help, the grievance card, the legal pages' navigation, the notice gate, Admin's "Preview the privacy policy") and the grievance officer's email were 19 px tall; they are now 44 px (`inline-flex min-h-11`). The "All" segment of the support desks' filter was 41 px wide; `Segmented` options now have `min-w-11` everywhere. |
| Still under 44 px   | Member names on Home's post headers (24 to 26 px), on the offline and Hindi Home checks. They were in the earlier audit (`touch-targets-360.json`), meet WCAG 2.5.8's 24 px, and are not a B12 to B14 screen, so they were left as they are.                                                                                                                            |

The offline cold start is covered by `e2e/offline.spec.ts` (a page reload with the network off opens Home from the saved copy), which runs in CI.
