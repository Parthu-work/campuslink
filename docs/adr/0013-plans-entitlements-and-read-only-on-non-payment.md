# ADR 0013: Plans, entitlements and read-only on non-payment

- Status: accepted
- Date: 2026-11-01

## Context

Colleges buy the product on one of a few plans (a free pilot, Connect, Placement), sometimes with a negotiated deal, and the plan decides which modules they get and how many WhatsApp messages and AI tokens they may use. Colleges in India pay late as a matter of course, often by bank transfer against a GST invoice. A college that stops paying must not keep growing usage indefinitely, but deleting or locking its members out would punish students and alumni for an administrative failure, and losing data would be irreversible.

## Decision

1. **Plan terms are configuration, merged in one place:** `PLANS` (code) ← `PlanSetting` (the platform owner's edits) ← the college's deal, combined by `mergeTerms()`. Money is whole paise.
2. **Entitlements, not checks scattered through the code:** a feature switch is the plan ∧ the college's own choice, resolved in the tenant cache, so routes, jobs, navigation and permissions agree. Limits (WhatsApp and AI allowances, sized per contracted student) come only from `EntitlementsService.limit()`. A plan without a feature shows it as unavailable in Admin › Features.
3. **Invoices** are numbered only when issued, from `InvoiceCounter` (one GST series for the seller), and never change afterwards; void only without payments. **Payments** are recorded only through `BillingService`, once per reference (a bank UTR or a Razorpay payment id).
4. **Non-payment makes a college read-only, never deleted:** a daily run marks overdue invoices, sends reminders (7 days before, on, and 7 days after the due date) and, from 30 days overdue, sets `readOnlyAt`. While read-only, the request pipeline refuses writes before authentication, except an allowlist: signing in and out, a member's own account, consents and privacy rights, safety and moderation, sessions already booked, provider webhooks, paying, accepting a notice and asking for help. Reads keep working. Recording a payment lifts it as soon as no invoice is 30 days overdue.
5. **Seats are counted, never enforced:** verified students and alumni active in 12 months, counted nightly; going over shows admins a banner.

## Consequences

- One place to answer "may this college do X" (`tenant.features`, `EntitlementsService`), and one test that walks every write route under read-only and pins the allowlist (`test/billing.test.ts`); a new route opts in only on purpose.
- Members can always reach their data, exercise their rights and ask for help, whatever the college's billing state.
- A college that never pays stays read-only with its data intact; any deletion follows the normal retention and contract terms, not non-payment.
- GST rate and SAC code are settings to be confirmed by a chartered accountant; credit notes are out of scope for now.
