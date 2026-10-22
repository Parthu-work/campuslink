# ADR 0008: Design language "Campus Aurora": a generated OKLCH palette, self-hosted type, one token set

- Status: accepted
- Date: 2026-10-22

## Context

The UI/UX audit (`docs/design/revamp/audit.md`) scored the design system 2/5: hex colours tuned for one college, a second college's colours dropped in at runtime with only the inks contrast-corrected, ad-hoc type sizes and radii, and no depth or motion vocabulary. The revamp brief (`docs/design/revamp/master-prompt.md` §3–§6) asks for a calm, tinted canvas where each college's own colour drives the whole palette, every college looks equally premium, and contrast holds for any colour an admin picks.

## Decision

### Colour: generated from one hue

`packages/shared/src/palette.ts` generates every colour token in OKLCH from the college's **primary** colour (its hue `h`; fallback 275, indigo-violet; greys fall back too):

- **Brand** keeps `h` and clamps lightness to 0.55–0.68 and chroma to 0.12–0.20, so neon lime and pure red look as considered as navy. The college's exact colours appear only in its logo.
- **Neutrals** are tinted by `h` (chroma 0.004–0.014): light canvas 0.985, white cards, surfaces 0.965 and 0.935; dark canvas 0.16 (rich, not black) with surfaces at 0.19, 0.225 and 0.26 and 8% white hairlines.
- **Inks** (`--brand-ink`, `--accent-ink`, status inks) step lightness away from the backgrounds until they reach **5.5:1** on the canvas and every text surface. Body text: `--fg` 12:1, `--fg-2` 6:1, `--fg-3` 4.5:1 on every surface. Labels on fills (`--on-brand`, `--on-accent`, `--on-danger`) reach 4.5:1; white is preferred when darkening the fill by at most 0.08 gets there.
- **Accent** comes from the college's own accent colour with the same treatment (lightness 0.60–0.75, chroma 0.12–0.18), so a college's gold or saffron survives; without one it is the third aurora hue. The **secondary** colour is kept for the logo only.
- **Aurora**: stops at `h`, `h + 45`, `h + 100`, used only for story rings, XP and streaks, badges, the One Useful Thing and onboarding heroes, celebrations, the active Galaxy constellation, the Study "Ask" button and the slow-navigation bar (utilities `bg-aurora`, `aurora-ring`, `aurora-border`, `aurora-mesh`).
- **Ramp** `--brand-50…950`, **eight subject accents** (hue offsets of 45° with fixed lightness and chroma, each with a surface and a readable ink), and fixed-hue **status** (success 150, warning 75, danger 25, info 235: ink, fg, surface, border), **role** (student, alumni, faculty, admin) and six **chart** colours (3:1 against cards).
- Every value is gamut-mapped into sRGB (chroma reduced at fixed lightness and hue) and rounded exactly as written to CSS, so the contrast test measures what browsers paint.

`apps/web/src/styles/palette.css` is the generator's output for the default hue plus the fixed hues (`pnpm --filter @campuslink/web palette`; a test fails when it is stale). At runtime `applyBranding()` injects the college's palette as a `<style>` element (allowed by the existing `style-src 'unsafe-inline'`; no CSP change) and updates the `theme-color` metas.

`packages/shared/src/palette.test.ts` generates palettes for maroon, navy, saffron, forest green, neon lime, pure red, teal and purple (each with an awkward accent) and asserts every threshold above in both themes, plus gamut, ramp order and neutral chroma.

### Type

Self-hosted with `@fontsource` (no font CDN; the CSP only allows `font-src 'self'`):

- **Display:** Bricolage Grotesque (variable), kept from the first design: characterful, wide range of weights.
- **UI:** Geist (variable), replacing Figtree. Compared side by side with Figtree and Inter in English and Telugu: Geist and Inter are clearly more legible than Figtree at 13 px on phones; Geist's Latin subset is 29 KB against Inter's 48 KB, and its numerals have a tabular form.
- **Telugu:** Anek Telugu (variable), replacing Noto Sans Telugu. Its larger x-height matches Geist's, so mixed and Telugu-only text read at the same size; Noto Sans Telugu looked a size smaller at 13 px. It loads only when Telugu text is on screen (`unicode-range`).
- **Mono:** Geist Mono, so labels and records share the UI face's design.
- A fluid scale of eight steps with `clamp()`: caption 12, meta 13, body 15, lead 16–18, title 19–22, headline 24–30, display 30–42, hero 36–56 (`text-caption` … `text-hero`, each with its line height). Headings balance, paragraphs wrap pretty, tabular numerals for stats and times, looser lines under `lang="te"`.
- Only the UI face's Latin file is preloaded.

### Shape, depth, glass, motion

- Radii 6 / 10 / 14 / 20 / 28 / full (`--radius-xs` … `--radius-xl`, `--radius-pill`): chips full, cards 20, sheets 28.
- Elevation 0–4 (`shadow-elev-1…4`): soft layered shadows tinted by the hue in light; lighter surfaces with a 1px inner highlight in dark.
- Glass only on floating chrome, at 92% opacity (audit quick win 15); solid under `prefers-reduced-transparency` and on low-end devices (4 cores or fewer, or 2 GB or less; `boot.js` sets `data-lowend`).
- Motion: transform and opacity only, every duration multiplied by `--motion-scale`. Springs as tokens: **snappy** (buttons, toggles), **smooth** (sheets, cards), **bouncy** (celebrations only), as CSS `linear()` easings sampled from the same springs `lib/motion.ts` exports for `m.*` components. Press feedback scales to 0.97 (`pressable`).
- Interaction tokens: the focus ring is a 2px brand ink outline with a 2px gap; selection, hover and pressed overlays and the scrim are tokens.
- One icon family (Lucide), imported per icon.

## Consequences

- Any college colour produces a palette that passes WCAG 2.2 AA with margin in both themes, and the test proves it for the awkward cases. Changing the generator means updating `palette.css` with one command.
- Components keep using semantic tokens (`bg-surface-1`, `text-fg-2`, `text-brand-ink`); the new ones (`bg-aurora`, `text-subject-…`, `shadow-elev-2`, `text-title`) arrive with the primitives in phase 7. Raw colour values remain only in `palette.css` (generated) and the story gradients in `tokens.css`, which a test enforces.
- The admin Branding screen still offers three colour pickers; the secondary colour now only feeds the logo. Phase 10 turns the screen into a preview of the generated palette.
- Fonts: Geist Latin (29 KB) is preloaded; Bricolage (41 KB) and Anek Telugu (140 KB) load when used.
- Browser baseline: OKLCH, `color-mix()` and `linear()` need Chrome 111+, Safari 16.4+ and Firefox 128+, the same as Tailwind 4, which the app already requires.
- Canvas-drawn backgrounds (the landing mesh) read `--mesh-strength` so text over them keeps its contrast in light mode, where axe cannot measure it.
