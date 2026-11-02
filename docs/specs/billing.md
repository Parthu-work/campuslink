# Plans, entitlements and billing (build B10)

Goal: a college can be quoted, invoiced, paid and limited by plan, inside the product. Students and alumni never pay (D9).

## Plans

Plans are configuration (`packages/shared/src/constants/plans.ts`, `PLANS`). Money is always whole paise.

| Plan      | Price per student per year | Annual minimum | Features                    | WhatsApp per student per month | AI tokens per student per month | Length  |
| --------- | -------------------------- | -------------- | --------------------------- | ------------------------------ | ------------------------------- | ------- |
| Pilot     | free                       | none           | all                         | 2                              | 5,000                           | 90 days |
| Connect   | ₹40                        | ₹60,000        | all except placement drives | 2                              | 5,000                           | 1 year  |
| Placement | ₹75                        | ₹1,20,000      | all                         | 4                              | 10,000                          | 1 year  |

- **What applies to a college** is the plan's default ← the platform owner's plan setting (Platform › Billing › Plans, a `PlanSetting` platform record) ← the college's custom deal (`tenant.subscription.terms`, only the terms it changes). `mergeTerms()` does it the same way everywhere.
- **Contracted seats** (`subscription.seats`) are the enrolled students the college is quoted for. The year's price is seats × price, or the minimum when that is more (`annualPricePaise`).
- **Allowances** scale with students: per student per month, for `allowanceStudents()` students (the contracted seats, or as many as the minimum pays for when that is more). A college paying the minimum gets the minimum's worth.
- **Seats in use** are verified students plus alumni active in the last 12 months (signed in, or kept a session going), counted nightly (`UsersService.seatCount`). Going over shows the college's admins a banner (Admin screens, `GET /admin/billing/notice`) and a badge in the console. It never blocks anyone mid-year.
- **The pilot** runs `days` from its start (or to the renewal date if one is set). The admin banner shows its end date in the last 14 days. Nothing locks when it ends; the platform moves the college to a paid plan.
- **Changing a plan's terms** applies at once on the instance that changed it and within a minute on the others (two 30-second caches: plans, then colleges).

## Entitlements

`EntitlementsService` (`modules/billing/entitlements.ts`):

- `can(tenant, feature)`: a feature switch (B1) applies when the plan includes it **and** the college has it on. The tenant cache resolves this once per lookup (`tenant.features` is the result; `tenant.chosenFeatures` keeps the college's choice), so routes (`FEATURE_DISABLED`), jobs (`gatedJob`), navigation and permissions all agree. Admin › Features shows switches outside the plan as unavailable; the college's choice is kept for when the plan changes.
- `limit(tenant, meter)`: `seats`, `whatsapp` (the B3 allowance, now from the plan), `aiTokens` (applied by B11).

## Invoices

`Invoice` is a tenant collection (`modules/billing/billing.model.ts`); the seller's details come from env (`BILLING_*`).

- **Statuses:** `draft` → `issued` → `paid`; `issued` → `overdue` (the day after the due date); `issued`/`overdue` → `void` (no payments recorded; otherwise a credit note corrects it, below). Drafts are the platform's and never shown to the college.
- **Numbers** are given on issue, so drafts never leave gaps: `CL/2026-27/0001` (prefix, Indian financial year in IST, sequence). The sequence is the platform model `InvoiceCounter` (`{prefix, fy}` unique, `$inc` with upsert; a race to create a year's counter retries). It is one series for every college because the seller issues them all.
- **Issue** claims the draft once, fixes both parties as they are that day (seller from env, buyer from `tenant.billing.buyer`: legal name, address, optional GSTIN, state), the tax, the due date (`BILLING_PAYMENT_TERMS_DAYS`, or the draft's own) and the SAC code, then renders the PDF and tells the college's admins (`invoice_issued`). An invoice never changes after issue.
- **GST** (`gstSplit`): a registered seller (`BILLING_GST_REGISTERED`, with `BILLING_SELLER_GSTIN` and `BILLING_SELLER_STATE`) charges CGST + SGST (UTGST in a union territory without a legislature) when the college is in the seller's state, IGST otherwise, at `BILLING_GST_RATE` (18% by default). Each half is rounded to the paisa. An unregistered seller charges none and issues a plain "Invoice" rather than a "Tax Invoice". The SAC code defaults to empty and the console warns until it is set: **confirm the SAC code and rate with a chartered accountant.**
- **Total in words** in the Indian system (`rupeesInWords`: crore, lakh, thousand).
- **PDF:** drawn with `pdf-lib`, Noto Sans embedded (subset) for the ₹ sign (`apps/api/assets/fonts`, SIL Open Font Licence), stored through `FilesService.storeInvoice` as file purpose `invoice` (scanned like every file; served only by the billing routes, never by `/files`). A failed render is redone on download.

## Credit notes (prompt 1b, R5)

A credit note corrects an issued invoice the GST way, without ever changing the invoice. `CreditNote` is a tenant collection.

- **Drafted** by the platform owner against an issued, overdue or paid invoice (`POST /platform/billing/:id/invoices/:invoiceId/credit-notes`): lines and a reason. Drafts are the platform's; the college sees issued ones only.
- **Tax mirrors the invoice:** the same rate and the same kind (CGST + SGST/UTGST, IGST, or none) as the invoice it adjusts, whatever has changed since, so the two net off.
- **Numbers** come from their own series, given on issue only: `CN/2026-27/0001` (`InvoiceCounter` with prefix `CN`, the same financial-year rule). A voided draft never takes a number.
- **Issue** (`POST /platform/billing/:id/credit-notes/:creditNoteId/issue`, `idempotent`) claims the draft once, then takes its total off the invoice in one conditional update, so the credited total never exceeds the invoice total, even with two issued at once. It renders the PDF ("Credit Note", the invoice it adjusts and its date, the reason) and is audited in both logs. Issuing an issued credit note again is a no-op.
- **Void** (`POST …/credit-notes/:creditNoteId/void`) applies to drafts only; an issued credit note is final (a second credit note or a new invoice corrects it).
- **Outstanding** is total − payments − credit notes (never below zero), everywhere: the platform overview, bank payments (never more than it), the online payment link, reminders, and read-only. A credit note that leaves nothing owed marks the invoice `paid` (settled) and ends read-only like a payment. The invoice keeps a running `creditedPaise`; nothing else on it changes.
- **Downloads:** the platform (`GET /platform/billing/:id/credit-notes/:creditNoteId/pdf`) and the college's admins (`GET /admin/billing/credit-notes/:creditNoteId/pdf`, `tenant:settings`).
- A credit note after full payment means the college is owed a refund; refunds are made outside the platform and are not recorded here.

**What a chartered accountant should check (O5):** that a credit note carries what Section 34 of the CGST Act and Rule 53(1A) of the CGST Rules require (the words "Credit Note", a serial number unique in the financial year, the date, the supplier's and recipient's names, addresses and GSTINs, the original invoice's number and date, the taxable value, rate and amount of tax, and the signature line); whether the `CN` series may be shared across colleges as the invoice series is; that a credit note against an invoice from an earlier financial year is declared by 30 November after that year's end (or the annual return, if earlier); and whether a credit note that only corrects the value (no change in tax) is acceptable as drawn.

## Payments

`Payment` is a tenant collection; `{tenantId, method, reference}` is unique, so a payment is recorded once.

- **Bank transfer (primary, D5):** the platform owner records the amount, date and UTR (`POST /platform/billing/:id/invoices/:invoiceId/payments`, `idempotent`). Never more than the balance; the same UTR twice is refused. Audited in the platform's log and the college's.
- **Online:** `PaymentProvider` (`lib/payments.ts`) with `disabled`, `stub` and `razorpay`. "Pay online" in Admin › Billing creates a Razorpay Payment Link for the balance (`POST https://api.razorpay.com/v1/payment_links`, Basic auth with the key id and secret) with the invoice number as `reference_id` and the tenant and invoice ids as notes. Only the college's legal name goes to Razorpay (an organisation, never a member); Razorpay's own SMS and email are off. The open link is reused until paid; a part payment by bank clears it.
- **Webhook:** `POST /api/v1/webhooks/razorpay` on the platform host, event `payment_link.paid`. The `X-Razorpay-Signature` header must be the HMAC SHA256 of the raw body with `RAZORPAY_WEBHOOK_SECRET` (constant-time compare). A payment counts only if its link is one made for that invoice (`payLinkIds`), and the provider's payment id is the unique reference, so a redelivered event is a no-op.
- **Stub (development and tests only; refused in production):** the link opens `/api/v1/dev/stub-pay/:linkId`, which signs a Razorpay-shaped event with the stub secret, records it through the same path and returns to Admin › Billing.
- Paid in full → `paid`, the admins are told (`payment_received`), and read-only lifts at once.

The Razorpay adapter follows the official Node SDK (`razorpay/razorpay-node`: `validateWebhookSignature`, the payment link types); razorpay.com itself was not reachable from the build environment, so confirm the payload against the dashboard's test webhook before going live.

## Reminders and read-only

A daily run per college (`billing.daily` job, queued hourly with a per-day job id, `BillingService.daily`):

1. counts seats;
2. marks issued invoices past their due date `overdue`;
3. sends the reminders that are due, each once (`remindersSent`): 7 days before (`invoice_due_soon`), on the due date (`invoice_due`) and 7 days after (`invoice_overdue`), to the college's admins. A late first run sends only the latest one, and none older than 7 days;
4. **read-only:** while any invoice is 30 or more days past due, `tenant.billing.readOnlyAt` is set (audited, admins told with `college_read_only`); it clears as soon as none is.

**Read-only** is a pipeline step for writes (`readOnlyGate`, after the feature switch): every non-GET route answers `403 READ_ONLY` unless its spec says `readOnlyOk`. Reads, downloads and exports keep working; **nothing is ever deleted for non-payment**. Still allowed: signing in and out (email or phone; a phone code creates no new account), a member's own account, consents, notification settings and privacy rights (export, deletion), safety (blocks, reports, moderation decisions, suspending a member), joining or cancelling sessions already booked, provider webhooks, and paying. Members see a notice in the app; the web shows the API's message on a refused write. `test/billing.test.ts` checks every write route in the registry and pins the allowlist.

## Screens

- **Admin › Billing** (`/admin/billing`, group College, `tenant:settings`): plan and terms, price this year, renewal or pilot end, seats in use against contracted, WhatsApp and AI usage this month against allowances, invoices to pay (with "Pay online" when a provider is set up) and to download, and the invoice details on record. Admin screens show a banner for read-only, overdue invoices, seats over the plan and a pilot ending.
- **Platform › Billing** (`/platform/billing`, `platform:billing`, a platform tab): every college's plan, seats, renewal and outstanding balance (one grouped read of open invoices, `withPlatformScope('billing:outstanding')`, sums only) and the Plans tab. A college's page: usage, the subscription form (plan, seats, term, invoice details, custom terms), invoices (draft from the plan's suggestion, issue, discard, void, record a bank payment, download), credit notes (draft against an issued invoice, issue, void a draft, download) and payments. Admin › Billing lists the college's issued credit notes to download.

## Data and privacy

Invoices and payments are about the college, not its members: no member id, name or contact is stored (the platform admin who recorded a payment is kept as `recordedBy`). Erasing a member changes nothing here; the privacy test checks the schemas. Invoices and credit notes are kept: they are the seller's tax records and the college's.

## Tests

`test/billing.test.ts`: GST, words, digit grouping, financial years, prices and allowances; entitlements (Connect turns drives off, a custom deal or plan setting changes it, the WhatsApp allowance follows); numbering under concurrency (25 at once, unique and gap-free); issue (needs a buyer, claimed once, intra- and inter-state tax, PDF for the college and the platform); drafts hidden from the college; bank payments (partial, full, UTR once, over-balance refused, Idempotency-Key replay); online payment through a signed webhook (bad signature refused, redelivery a no-op, a link from another invoice ignored); the Razorpay request (Basic auth, no member data) and signature; reminders and read-only on a timeline; read-only over every write route; seat counting; the permission matrix; isolation; the platform model allowlist; the plan migration (old documents load and save). `test/credit-notes.test.ts` (prompt 1b): numbering on issue only and no gap from a voided draft, the cap (also with two issued at once), mirrored tax, the invoice unchanged, outstanding, payments capped by it, read-only ended by a settling credit note, the PDF (title and subject name the credit note, invoice and reason), isolation and permissions. `test/phone-auth.test.ts`: phone sign-in works while read-only, sign-up does not. e2e `e2e/billing.spec.ts`: the college admin downloads and pays online; the platform drafts, issues and records a bank payment; a pilot college at phone width.
