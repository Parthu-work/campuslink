# Launch checklist: KNRCER (the pilot college)

For the owner, after the server is live ([`docs/deploy-oracle.md`](../deploy-oracle.md) steps 1 to 10)
and after **both** prompt 3 (the UI) and prompt 4 (deployment) are merged into `main` and deployed.
Until then, only the demo college exists on the server. Tick each line; the commands run as the
`deploy` user in `/srv/campuslink/deploy/prod`. Screen names (Admin › …) are today's; prompt 3 may
rename them.

## Before the college

- [ ] `./smoke.sh` passes on the server; the uptime monitor and Sentry are receiving.
- [ ] Last night's backup is in R2 and `drill.sh` with the key passed this week.
- [ ] The pen test (scope in [`docs/security-review.md`](../security-review.md) › Pen-test pack) is done and its findings are fixed or accepted in writing.
- [ ] Legal review of the privacy policy, terms and guardian declaration; the grievance officer named.
- [ ] Seller details from the chartered accountant in `.env` (`BILLING_SELLER_*`, `BILLING_SAC_CODE`; GSTIN or `BILLING_GST_REGISTERED=false`).
- [ ] Every paid account has its cap ([`deploy-oracle.md`](../deploy-oracle.md) step 9): Anthropic spend limit, Meta payment limit, MSG91 prepaid balance, Oracle ₹1 budget alert.
- [ ] WhatsApp templates approved by Meta (at least `auth_code`, `cl_invite_student`, `cl_invite_alumni`), `WHATSAPP_PROVIDER=cloud`, one authentication and one utility message delivered to the owner's phone and a quick-reply round trip through the webhook (P12 live check).
- [ ] If SMS is used: DLT entity, header and templates registered; `SMS_PROVIDER=msg91`; one code delivered.

## College set-up (owner and the college's admin)

- [ ] **Create the college** in the platform console (`https://admin.<domain>` › Colleges › New college): subdomain `knrcer`, display and short name, colours and monogram, the first college administrator (they get an invitation and must turn on two-factor). Plan: pilot; seats: the enrolled students quoted.
- [ ] **Branding:** the college admin uploads the logo and checks the colours (Admin › Branding).
- [ ] **Legal details:** Admin › Legal: legal name, address, grievance officer (name, designation, email). Publishing bumps the notice version; members accept it at their next sign-in.
- [ ] **Billing buyer details:** Admin › Billing: the college's legal name, address, state and GSTIN if any. Invoices stay in draft until the seller details are complete.
- [ ] **Email domains:** the college's own domains for sign-up and single sign-on (Admin › Settings).
- [ ] **Roster import, dry run first:** Admin › Imports: upload the student list (and the alumni list), check the column mapping, run with **dry run**, read the error report, then run for real. Optionally set up the daily roster sync from the same source (changes over 5% wait for approval).
- [ ] **Pilot preset:**

  ```bash
  docker compose exec api node dist/scripts/pilot-preset.js --slug knrcer --dry-run
  ```

  ```bash
  docker compose exec api node dist/scripts/pilot-preset.js --slug knrcer
  ```

  It turns on jobs (with automatic openings), placements, study and the assistant, and Alumni Match,
  and keeps mentorship, referrals, roadmaps, readiness and practice on (they have no switch); turns off stories, reels, leaderboards, circles, giving, public pages, the parent digest,
  batchmate invites and the network; sets a WhatsApp allowance of 1 message per student a month and an
  AI allowance of 3,000 tokens per student a month; caps storage at 4 GB for the college and 50 MB per
  study video. Voice Q&A needs the Whisper service, which the pilot server does not run, so it stays
  unavailable; Campus Captains exist only when an admin grants the capability, so nobody has it.

- [ ] **AI consent:** the college admin accepts the AI notice (Admin › AI) before any passage goes to the provider.
- [ ] **Placements:** the TPO sets up the first drive and the academic records the eligibility checks need.

## Invites

- [ ] **One cohort first** (for example the final-year students of one branch): Admin › Onboarding › Invites, by WhatsApp, after confirming the college's opt-in (`attestOptIn`). Each invite counts against the WhatsApp allowance; anything over it is reported as not sent, never half-done.
- [ ] **The principal's alumni invitation:** the same screen, alumni records, template `cl_invite_alumni` (first name, college, link). Send a first batch of alumni the principal knows will mentor.
- [ ] Wait 48 hours and read the day-one numbers below before inviting the next cohort.

## Day-one watch list

| What                  | Where                                                                               | Healthy                                                   |
| --------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Activation            | Admin › Onboarding (invited, joined, verified); `metrics:yc` for the week           | Most invited members verified within two days             |
| Codes delivered       | `costs-report.js` (WhatsApp and SMS counts); the WhatsApp read rate in `metrics:yc` | Every sign-up code delivered; no "allowance reached"      |
| Errors                | Sentry; `docker compose logs --since 1h api worker \| grep '"level":50'`            | No new error type; nothing repeating                      |
| AI and WhatsApp spend | `docker compose exec api node dist/scripts/costs-report.js`                         | Well under the college's allowances and the provider caps |
| Server                | host alerts by email; `docker stats`                                                | No alert; memory well under 12 GB                         |
| Backups               | the morning after: `cat /var/lib/campuslink/status/backup-status.json`              | `"ok":true`, R2 well under 8 GB                           |
