# Owner checklists (prompt 1b, §4)

What the platform owner registers, signs or has reviewed. The code side is done; each item below lists what to prepare, the exact texts, and a short live check. Nothing here can be done by an engineer or agent (E1). Live checks run from the operator's own machine with real keys, never in CI (E3).

Hosts below use `APP_ROOT_DOMAIN` (for example `campuslink.example`): the platform console is `admin.<root>`, each college is `<slug>.<root>`. Webhooks are on the platform host.

## O1 · Merge into `main`

- Pull request [Parthu-work/campuslink#1](https://github.com/Parthu-work/campuslink/pull/1) (prompt 1) is merged (`1d527a1`), and CI on that commit is green.
- Prompt 1b's work is on `feat/prompt-1b-remaining`. Open a pull request into `main` and merge it when its CI is green (verify, e2e, adapters, security).

## O2 · Meta Business, a WhatsApp number, templates

1. Verify the business in Meta Business Manager and add a WhatsApp Business number. Create a system user token with `whatsapp_business_messaging` and `whatsapp_business_management`.
2. Submit every template in [`docs/whatsapp-templates.md`](../whatsapp-templates.md) in **English, Telugu and Hindi**, with exactly the names and texts shown (utility category; the code template as authentication with a copy-code button). New in prompt 1b: `cl_weekly_digest` (R8) and `cl_account_inactive` (R7, the warning before an unused account is deleted).
3. Webhook: callback URL `https://admin.<root>/api/v1/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to the `messages` field. Set `WHATSAPP_APP_SECRET` (the app secret; deliveries are checked against `X-Hub-Signature-256`).
4. Env: `WHATSAPP_PROVIDER=cloud`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION` (for example `v21.0`), `WHATSAPP_ACTION_SECRET` (32+ random characters), `WHATSAPP_AUTH_TEMPLATE` if the code template has another name.

**Live check (one page, about 15 minutes, staging with a test number of your own):**

| Step | Do                                                                                             | Expect                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1    | Sign up by phone on a staging college with your own number                                     | One code on WhatsApp with a copy-code button; the code signs you in                           |
| 2    | Opt into WhatsApp (Settings › Privacy) and have a second account send you a mentorship request | `cl_request_received` with Accept and Decline                                                 |
| 3    | Tap **Accept**                                                                                 | The request shows as accepted in the app within seconds                                       |
| 4    | Look at Admin › Overview › WhatsApp usage, then the message's status                           | Usage counts the messages; the status moves to delivered and read (the status callback works) |

If step 1 fails, check the Graph API version and the template's button component; the adapter was built from Meta's published shapes and tested against fakes only.

## O3 · DLT and MSG91

1. Register the principal entity on a DLT portal, a six-letter header, and the templates in [`docs/sms-templates.md`](../sms-templates.md) **character for character**: `otp` (service implicit), `session_reminder` and `drive_reminder` (service explicit, R4), and when wanted their Unicode versions `otp_hi`, `session_reminder_te`, `session_reminder_hi`, `drive_reminder_te`, `drive_reminder_hi`. Register the reminders' third variable as a URL variable and whitelist the college domains.
2. In MSG91, create one Flow template per DLT template with the DLT template id, header and entity mapped; variables are `var1`, `var2`, `var3` in the order of the `{#var#}` placeholders.
3. Env: `SMS_PROVIDER=msg91`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_DLT_ENTITY_ID`, `SMS_DLT_TEMPLATE_IDS` (`otp=<flow id>,session_reminder=<flow id>,drive_reminder=<flow id>`, plus the language versions once registered).

**Live check:** (1) with WhatsApp off for your test account, sign in by phone and receive one code SMS; (2) book a session starting in a little over an hour and wait for the one-hour reminder SMS with your first name, the time and a link. Both appear in Admin › Overview › usage.

## O4 · Razorpay

1. Open a Razorpay account and enable Payment Links. Turn Razorpay's own SMS and email notifications off for links.
2. Webhook: URL `https://admin.<root>/api/v1/webhooks/razorpay`, event `payment_link.paid`, and a secret.
3. Env: `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.

**Live check (test mode keys):** issue a small invoice to a staging college, open Admin › Billing as its admin, **Pay online**, pay with a Razorpay test card. Expect the invoice marked paid once and the payment listed in Platform › Billing. Then use **Resend** on that delivery in the Razorpay dashboard: the payment must not be recorded twice.

## O5 · A chartered accountant's review

Send: a sample invoice and a sample credit note (render them from the seed: `pnpm seed`, then Platform › Billing › Deccan Plateau Institute of Technology downloads the issued invoice; draft and issue a credit note against it to get its PDF), and [`docs/specs/billing.md`](../specs/billing.md) › Invoices and › Credit notes. Questions to ask:

- The GST rate (18% by default, `BILLING_GST_RATE`) and the SAC code (`BILLING_SAC_CODE`, empty until set) for this service.
- The intra-state split (CGST + SGST, UTGST in union territories without a legislature) and IGST across states, each half rounded to the paisa.
- One invoice series per financial year for every college (`CL/2026-27/0001`) and one credit note series (`CN/2026-27/0001`): acceptable, or one series per college?
- Whether the credit note carries everything Section 34 of the CGST Act and Rule 53(1A) require, and the deadline for a credit note against an earlier year's invoice.
- The wording when the seller is not registered for GST ("Invoice", no tax).

## O6 · A lawyer's review

Already reviewed (owner, 2 November 2026): the English privacy policy and terms. Still to review:

- **New since that review:** the privacy policy's SMS sentence (R4), in `apps/api/src/modules/tenants/legal-templates.ts` › "Why we use it".
- The minors flow and the guardian declaration (`docs/privacy.md` › Age and members under 18; `apps/web/src/features/guardian/declaration.ts`), if not part of the earlier review.
- The consent texts (sign-up and Settings › Privacy) and ADR 0012 (placement records kept in anonymised form after erasure).
- **New since that review:** the inactive-account sentence (R7), shown in the privacy policy's "How long we keep it" only for colleges that turn the purge on (`legal.service.ts` › `inactivePurge`), and the purge itself (`docs/privacy.md` › Retention).

## O7 · Native Hindi and Telugu review

[`translation-review.md`](translation-review.md), in its order: the legal texts first (`legal-translations.ts`; publishing them needs the review recorded and a notice version bump), the guardian declaration and consents, then messages sent outside the app (SMS and WhatsApp templates, fixed once registered), then the screens.

## O8 · An external penetration test

Hand the tester:

- [`docs/threat-model.md`](../threat-model.md), [`docs/security-review.md`](../security-review.md) (including its Gaps) and [`docs/permissions.md`](../permissions.md) (every route, its permission and rate limit).
- **Scope:** a staging deployment only (`deploy/staging/`), never production data. Hosts: `admin.<staging root>` (platform console and webhooks) and two college hosts, `dpit.<staging root>` and `mrce.<staging root>`, to test cross-college isolation. In scope: the web app, `/api/v1`, Socket.io, uploads, the webhooks. Out of scope: Meta, MSG91 and Razorpay themselves.
- **Accounts (from `pnpm seed`, password from `SEED_PASSWORD`):** platform `superadmin@campuslink.example`; per college (`dpit.example`, `mrce.example`) `admin@` (college admin, TOTP required), `tpo@`, `faculty@`, an alumnus `rahul@` and the demo students; a pending minor who waits for guardian consent. Admin accounts need TOTP: enrol the tester's authenticator during setup.
- Ask especially for: tenant isolation, IDOR on placement records and invoices, the phone-code flows and caps, the webhook signatures, file uploads, and the read-only mode.
