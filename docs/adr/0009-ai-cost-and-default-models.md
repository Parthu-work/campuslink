# ADR 0009: The platform's AI provider by default, Haiku for answers, metered by plan

- **Status:** accepted (build B11, decision D6)
- **Overrides:** two Phase 9 decisions in `docs/design/revamp/decisions.md`: "No provider is the default" and "Anthropic default model: `claude-opus-5-5`".

## Context

Tier-3 colleges rarely have, or want, an account with an AI provider. With "no provider is the default", the study assistant answered only for the few colleges that brought a key, and with Opus as the Anthropic default every answer cost several times what a study answer needs. Plans (B10, ADR-free config in `packages/shared/src/constants/plans.ts`) now include a monthly AI token allowance per student, which gives the platform a way to pay for the provider and cap the cost.

## Decision

1. **The platform's provider (`AI_DEFAULT_*`) is every college's default.** A college with no key of its own uses it automatically (`platformDefault`, already wired in Phase 9). A college may still bring its own key; its own budget rules then apply as before.
2. **Its monthly budget is the plan's allowance** (`EntitlementsService.limit(tenant, 'aiTokens')`: per student per month, for the students the plan is sized for). The admin can set a lower budget, never a higher one (`400` on save). Only tokens the platform's key served count against it. A plan with no AI tokens leaves the platform's provider off: the college is _not configured_.
3. **Answers default to `claude-haiku-5-5`** (`DEFAULT_CHAT_MODEL.anthropic`). **`claude-sonnet-5-5` is the "deep" model** (`DEEP_CHAT_MODEL.anthropic`, `ActiveChat.deepModel`), used only by features that ask for it (Prompt 2's mock interviews and résumé rewrites). **Opus is used only when an admin picks it.** For the platform default, `AI_DEFAULT_CHAT_MODEL` may be left unset for Anthropic (Haiku is used) and `AI_DEFAULT_DEEP_MODEL` overrides the deep model.
4. **Kept from Phase 9:** other providers have no default model (we never guess a model name); a college with no key and no plan entitlement is _not configured_ (library, keyword search, passage answers); external providers stay off until the college's admin accepts the data notice (`AI_CONSENT_VERSION`); provider calls go through `guardedChat`/`guardedEmbeddings` and `callJson()`.
5. **Metering by feature:** every usage counter records its `feature` (`study_chat`, `embedding`, `transcription`, `rerank`, later `resume`, `interview`, `copilot`) and whether the platform's key served it. Billing shows a college its usage against the allowance; the platform console estimates its own cost per college from prices set once in env (`AI_PLATFORM_PRICE_*`).

## Consequences

- Every college gets answers out of the box within its plan, and the platform carries the provider cost, which the plan price is meant to cover. The platform owner checks that against real usage with the console's per-college cost estimate (prices entered from the provider's pricing page, never filled in by the app).
- Excerpts of a college's material now go to the platform's provider by default, but only after that college's admin accepts the data notice; nothing changes for colleges that use their own key.
- Usage recorded before B11 did not say whose key served it; it counts as the college's own (never against the allowance, never costed).
- `pnpm --filter @campuslink/api ai:smoke` runs one answer, one embedding and `/quiz` per configured provider with real keys (not in CI).
