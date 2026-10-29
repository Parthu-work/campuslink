# ADR 0011: WhatsApp as a notification channel, with signed quick-reply actions

- Status: accepted
- Date: 2026-10-29

## Context

Tier-3 students and alumni read WhatsApp, not email; push needs an installed app. A mentor who can accept a request from a WhatsApp message answers far more often. WhatsApp business messages cost money per conversation, need approved templates and an explicit opt-in, and a webhook carries replies and delivery statuses for every college to one URL.

## Decision

1. Meta's WhatsApp Cloud API directly (no reseller), behind `WhatsAppProvider`; `disabled` and `console` stubs for development and tests.
2. WhatsApp is a fourth notification channel. Only notification types with an approved template use it, only for members who opted in (`whatsapp_updates`) and verified their number, after quiet hours, within fair-use caps (2 non-critical a week per member; a monthly allowance per college) with push or email as the fallback.
3. Quick-reply buttons carry a short-lived HS256 token (`{tenant, member, action, item}`) signed with `WHATSAPP_ACTION_SECRET`. The webhook acts only when the token verifies, the tap comes from the member's own number, and the member may still do it now (`backgroundAuth`). Actions go through the owning service's existing method.
4. The webhook is authenticated by `X-Hub-Signature-256` over the raw body. Delivery statuses are matched to the college's record through a named platform path (`channels:webhook-status`); deliveries are deduplicated in a platform-level receipt collection.

## Consequences

- Message text never leaves the app: templates take ids, names, times and counts only.
- The owner registers a Meta Business account, a number and the templates in `docs/whatsapp-templates.md` (three languages) before turning it on; until then the channel is unavailable and nothing changes for members.
- Adding an action is one registration in `app.ts` (`channelService.registerAction`).
