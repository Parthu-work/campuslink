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
- **Language:** every string goes through i18next (`en.json`, `te.json`), and `lang` switches with the language, so screen readers use Telugu voices.
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
