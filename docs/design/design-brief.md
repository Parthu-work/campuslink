# Design brief: CampusLink

Status: **proposal, awaiting approval.** The clickable prototype lives at `docs/design/prototype.html` (also published as a private Artifact).

> **Superseded in part (2026-10-22):** colour, type, tokens and motion now follow the "Campus Aurora" design language in [ADR 0008](../adr/0008-design-language.md) (`docs/design/revamp/`). The product ideas below still apply.

## 1. Idea in one line

**"Night campus."** Your college after dark: a sky of the people who walked the same corridors, with your career path drawn as a constellation you light up one star at a time. Instagram's fluidity, carried by LinkedIn's credibility: every face is verified, every claim has a source, every number is real.

## 2. Visual identity

| Element          | Choice                                                                           | Why                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ground           | Deep blue-ink (`#070A14` dark), cool paper (`#F3F5FA` light)                     | Not pure black: the blue bias makes brand colors glow and reads calmer on cheap OLED panels                                                               |
| Platform palette | **Palapitta blue** (`#3FB8E6`), violet (`#6D5AE6`), **Tangedu gold** (`#F2B705`) | The Indian roller (palapitta) is Telangana's state bird and tangedu its state flower. The palette is rooted in the primary market without being folkloric |
| Tenant palette   | `--brand`, `--brand-2`, `--accent`, plus per-theme ink variants                  | A college swaps three colors and a logo; contrast-safe "ink" variants are derived per theme                                                               |
| Display type     | **Bricolage Grotesque** (variable, optical size)                                 | Expressive, slightly irregular grotesque, confident in headlines and never corporate                                                                      |
| Body type        | **Figtree**                                                                      | Friendly and highly legible at 14–16px on low-DPI Android screens                                                                                         |
| Data type        | **IBM Plex Mono**                                                                | Batch years, roll numbers, time estimates, match scores: the "verified record" voice                                                                      |
| Telugu           | **Noto Sans Telugu**, in every font stack                                        | Real Telugu shaping. Line-height is raised 8% when `lang="te"`                                                                                            |

Demo colleges (fictional): **Deccan Plateau Institute of Technology** (`dpit`, blue, violet and gold) and **Musi Riverfront College of Engineering** (`mrce`, emerald, teal and coral).

## 3. Tokens (implemented in `apps/web/src/styles/tokens.css` in Phase 1)

- **Color:** `bg`, `surface-1..3`, `line`, `fg`, `fg-2`, `fg-3`, `brand`, `brand-2`, `accent`, `brand-ink`, `accent-ink`, `on-brand`, `success`, `warning`, `danger`, `glass`. Components never use raw hex values.
- **Type scale** (1.25 ratio, rem): 0.75 · 0.875 · 1 · 1.25 · 1.563 · 1.953 · 2.441 · 3.815 (hero, clamp-based).
- **Spacing:** 4px base (4, 8, 12, 16, 20, 24, 32, 40, 56, 72).
- **Radius:** `sm` 10, `md` 16, `lg` 24, `pill` 999. Cards use `md`; sheets and dialogs use `lg`; avatars are circles; the Galaxy and radar have no radius.
- **Elevation:** three levels via layered low-alpha shadows (dark mode leans on 1px inner highlights instead of shadows).
- **Glass:** used only for floating chrome (bottom nav, sheets, command palette): `backdrop-filter: blur(16px)`, with a solid fallback when unsupported or when reduced transparency is preferred.

## 4. Components (shadcn/ui primitives, restyled)

Button (primary, secondary, ghost, danger), IconButton, Chip (filter and toggle), Segmented tabs with sliding indicator, Avatar (initials gradient fallback, verified tick), Card, Post, Story ring, Sheet (bottom on mobile, side on desktop), Dialog, Command palette (cmdk), Toast, Skeleton, Empty state, Progress steps, OTP input, Slot picker, Match card (swipe), Radar, Galaxy canvas, Impact card, Badge (`Verified alumnus`, `Mentor · Gold`, `needs_review`).

## 5. Motion principles

1. **Physical, not decorative.** Springs (`cubic-bezier(.22,1.2,.36,1)`, 240ms) for things the hand moves: swipes, sheets, toggles. Ease-out at 140ms for feedback.
2. **Transform and opacity only.** No layout-thrashing animation, targeting 60fps on a mid-range Android phone.
3. **One orchestrated moment per screen:** the landing mesh and drifting wall, the onboarding completion burst, a Galaxy node lighting up, the radar sweep. Everything else stays quiet.
4. **Reduced motion is a first-class theme.** The `--motion-scale` token drops to 0, ambient loops stop, and transitions become instant cross-fades. Nothing depends on motion to be understood.

## 6. Layout

- **Mobile (baseline 360px):** top bar, content, glass bottom nav (Feed · Mentors · Galaxy · Jobs · Me). Thumb-zone primary actions; sheets instead of modals.
- **Desktop (≥1024px):** three columns: nav rail, content (max 640px for the feed), and a right rail with suggestions, next session and streak.
- **Bento:** used only where content is genuinely heterogeneous (mentor profile, impact card, admin analytics), never as a default grid.

## 7. Voice

Senior-to-junior: warm, direct, specific. "Rahul has 2 request slots left this week", not "Limited availability". Errors say what to do next. No exclamation marks except the onboarding completion.

## 8. Accessibility and performance commitments

WCAG 2.2 AA in both themes (tokens are contrast-checked), 44px minimum targets, full keyboard paths (swipe has button and arrow-key equivalents, the Galaxy has a list view), visible focus ring in the accent color, and `lang` switching for Telugu. Budgets: under 170KB of gzipped JS on the initial route, LCP under 2.5s on a Moto G-class phone over Fast 3G, and the landing mesh drawn on a 64×40 canvas scaled by CSS.

## 9. Honesty in the UI

All people, companies, listings and numbers in the prototype are **fictional demo data**. Roadmap content is marked `needs_review` until Phase 6 research is cited. Production screens show source attribution on every ingested item and a "last reviewed" date on every roadmap node.
