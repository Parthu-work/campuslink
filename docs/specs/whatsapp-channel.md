# WhatsApp and SMS channels (build B3)

## Goal

Notifications and codes reach people where they read (WhatsApp, SMS for codes), within a cost cap the college's plan covers.

## Decisions

- **Adapters behind interfaces (D3, D4).** `WhatsAppProvider` (`disabled`, `console`, `cloud`: Meta WhatsApp Cloud API) and `SmsProvider` (`disabled`, `console`, `msg91`: MSG91 v5 Flow API). Both go through `safeFetch` with a host allowlist. Production refuses the console providers. The Meta and MSG91 documentation sites were not reachable from the build session; both adapters follow the providers' published request shapes and are tested against fakes, and **need one live check with real credentials** before a college relies on them (see the progress log).
- **SMS only for codes.** D4 limits SMS to code fallback and critical reminders; this build sends codes by SMS (`otp` template, service category). Critical reminders by SMS are left for when a college asks (a second DLT template), because WhatsApp already exempts them from caps.
- **WhatsApp needs an opt-in.** The consent purpose `whatsapp_updates` (v1, optional, unticked by default) is asked at sign-up and in Settings › Privacy, and the notification settings show a WhatsApp card with the number messages go to. Without it, or without a verified number, nothing goes to WhatsApp.
- **Only notification types with a template go to WhatsApp** (`whatsapp-templates.ts`): request received (Accept / Decline buttons), request accepted, session reminder (I'll be there; critical), session moved or cancelled, job alerts. Defaults are on for requests, sessions, reminders and jobs; off elsewhere. B7 adds the placement templates.
- **Parameters are names, times, session types, company names and counts only**; a test feeds message text into every template and checks it never comes out.
- **Fair use.** At most 2 non-critical WhatsApp messages a member per rolling week; the college's monthly allowance (2,000 until plans set it in B10). Critical messages (codes, session reminders, later drive deadlines) are exempt from both. At a cap the notification falls back to push, else email. Admins get `channel_budget_warning` at 80% and `channel_budget_reached` at 100%, once a month each.
- **Quick replies act as the member.** A button carries a JWT (HS256, `WHATSAPP_ACTION_SECRET`, 7 days) naming the college, member, action and item. The webhook verifies it, checks the tap came from the number the button was sent to, then runs the owning service's method inside `runInTenant` with `backgroundAuth()`, so current permissions and blocks apply.
- **The webhook** (`GET/POST /webhooks/whatsapp`, on the platform host) verifies Meta's handshake token and `X-Hub-Signature-256` over the raw body (kept for webhook paths only), dedupes on message ids and status updates (`WebhookReceipt`, platform-level, 7 days), and records delivery statuses on the message record found by provider id through the named platform path `channels:webhook-status`. Free text gets one fixed auto-reply per number per day and is never stored.
- **Metering.** `ChannelMessage` (per member: template, status; 90 days, erased with the member) and `ChannelUsage` (per day, channel and category; no member ids). Codes are metered too.

## Tests

`whatsapp.test.ts` (request → WhatsApp with buttons → tap accepts; bad signature 401; tampered, expired, misdirected and cross-college tokens refused; replay ignored; statuses; auto-reply; handshake; consent; weekly cap and fallback; critical exemption; quiet hours; college switch; allowance alerts; codes metered; adapter request shapes; env validation), `channel-templates.test.ts` (docs parity, parameters), isolation and privacy cases.
