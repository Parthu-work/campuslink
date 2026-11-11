# Handover from prompt 4 (deployment) to prompt 3 (UI rebuild)

Prompt 4 runs in parallel with prompt 3 and never edits `apps/web/`. This file lists what prompt 3
should build or keep. Prompt 4 updates it whenever it merges `main`; prompt 3 reads it whenever it
merges `main`. Last updated: 11 Nov 2026 (prompt 4 branch `claude/clever-hypatia-cpgn8m`).

## Rules prompt 3 must keep

1. **`NETWORK_ENABLED` in `buildNav()`** (`packages/shared/src/navigation.ts`). `NavSubject` has an
   optional `networkEnabled`; when it is `false`, `buildNav()` hides the `network`, `recruiter` and
   `employers` destinations and the `network` admin section, whatever the permissions say. The test is
   `packages/shared/src/navigation.test.ts` › "the network switch (NETWORK_ENABLED, ADR 0014)". If the
   U2 navigation rebuild rewrites `buildNav()`, keep the condition and the test; prompt 4 restores them
   in a fix commit if they disappear.
   - The API already enforces the switch on its own: while it is off nobody holds a network permission,
     so `useNav()` hides the network without any web change. Passing `networkEnabled` from the tenant
     is optional polish (see "Possible web follow-ups").
2. **The live server deploys from `main`** (`.github/workflows/release.yml`): every merged prompt 3
   phase reaches production after the owner approves the deploy. Keep `main` green.
3. **Real students arrive only after both prompts are merged and deployed.** Until then the server
   hosts the demo college and the owner's checks.

## Screens to build on prompt 4's backend

| Screen                                               | Backend to call                                                                                                                                                                           | Notes                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Platform console › **Costs** panel                   | `CostsService.report(month, backupStatus)` (`apps/api/src/modules/billing/costs.service.ts`); today only the command `costs:report`. Needs a route (`platform:billing`)                   | Per college: AI tokens on the platform key vs allowance and estimated ₹, WhatsApp vs allowance, SMS, stored GB vs limit; totals; R2 backup GB vs 10 GB free. Aggregates only. A `null` amount means "price not set", never ₹0. |
| Platform console › college › **Pilot preset** button | `PilotPresetService.apply(slug, { dryRun })` (`apps/api/src/modules/platform/pilot-preset.service.ts`); today only `college:pilot-preset`. Needs a route (`platform:tenants`, idempotent) | Show the dry-run list of changes first, then apply. Audited in the college.                                                                                                                                                    |
| Admin › Billing › **storage limit**                  | `EntitlementsService.limit(tenant, 'storageMb' \| 'studyMediaMb')` and `FilesService.storedBytes()`                                                                                       | The billing view does not return storage today; add the two figures to the billing view (`BillingService`) and show "used of limit". `0` means no limit.                                                                       |

Prompt 4 did not add these routes: a route without its screen would be dead code, and the screens
are prompt 3's. Whoever builds a screen adds its route spec, a permission test and the `docs/permissions.md` row.

## User-facing strings to add (en, te, hi)

Server messages added by prompt 4 that members or admins can see (they come from the API in English
today, like other server errors; translate them if prompt 3 maps server errors to keys):

- "Your college’s storage is full ({{mb}} MB). Ask your administrator to remove old files or to raise the limit." (HTTP 413 on any upload when the college's `limits.storageMb` is reached.)
- Study uploads over the plan's media cap use the existing "File is too large (max {{mb}} MB)" message (the pilot cap is 50 MB).

No new translation keys were added by prompt 4.

## Prompt 3's carry-over items (from the 7 Nov audit; not done in prompt 4)

- Initial JS headroom: U0 freed 10.1 of the 15 KB target.
- 44 px touch targets everywhere.
- Per-language font loading on English pages (do not load the Telugu and Devanagari faces on English pages).

## New settings and behaviour

| Setting / behaviour                                                                                                                 | Effect on the web app                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `NETWORK_ENABLED` (env; off by default in production)                                                                               | Employer hosts answer 404 (`/tenant` too); the network, employer and credential APIs answer 404; no network permission in `/me`.                |
| Storage limits (`PLAN_STORAGE` in `packages/shared/src/constants/plans.ts`; pilot 4 GB per college, 50 MB per study video or audio) | Uploads can fail with 413 and the storage message above.                                                                                        |
| `PILOT_PRESET` (same file)                                                                                                          | After the preset, a pilot college has stories, reels, leaderboards, circles, giving, public pages, the parent digest and batchmate invites off. |
| Production `TRUST_PROXY_HOPS=1` behind Cloudflare and nginx                                                                         | Nothing to do.                                                                                                                                  |

## Possible web follow-ups (optional)

- Pass `networkEnabled` to `buildNav()` from the tenant (the API would need to expose it in
  `PublicTenant`); today the permissions already hide everything.
- The edge serves the web container through nginx with `deploy/nginx/security-headers.conf`
  unchanged; any new script, frame or connection source still changes that file and its test.
