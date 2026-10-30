# AI cost control (build B11)

Goal: the study assistant works for every college without them owning a provider account, at a cost the plan covers. The decisions are in ADR 0009 (D6), which overrides two Phase 9 decisions.

## Models

- `DEFAULT_CHAT_MODEL.anthropic` is `claude-haiku-5-5`: every study answer, summary, quiz and flashcard set.
- `DEEP_CHAT_MODEL.anthropic` is `claude-sonnet-5-5`, exposed as `ActiveChat.deepModel` for features that ask for "deep" work (Prompt 2's mock interviews and résumé rewrites). Nothing in this build uses it.
- Opus is used only when an admin picks it as the answer model.
- Other providers have no default (neither answer nor deep): the admin picks from the models "Test connection" reports, and the platform owner names `AI_DEFAULT_CHAT_MODEL`. For Anthropic it may be left unset; `AI_DEFAULT_DEEP_MODEL` overrides the deep model.

## The platform's provider and the plan's allowance

- A college with no key of its own answers on the platform's provider (`AI_DEFAULT_*`, `platformDefault`).
- Its monthly token budget is then the plan's allowance (B10: `aiTokensPerStudentMonthly` × the students the plan is sized for). In Admin › AI assistant the budget field shows the allowance; a budget above it is refused (`400`, field `monthlyTokenBudget`), a lower one applies, and 0 means "all of it" (`budgetLimit()`).
- Only tokens the platform's key served count against the allowance (`AiUsageService.monthTokens({ platformOnly })`). When it is used up, AI calls stop until the 1st and members get passages, as with any budget (Phase 9).
- A plan with no AI tokens (a custom deal can set 0) leaves the platform's provider off: the college is _not configured_ (library, keyword search, passage answers), exactly like a college with no key before.
- A college with its own provider keeps its own budget (0: none), as before; the plan's allowance does not apply.
- The data notice still gates every external call (`AI_CONSENT_VERSION`), whoever's key it is.

## Metering

`AiUsage` counters gain `feature` (`AI_USAGE_FEATURES`: `study_chat`, `embedding`, `transcription`, `rerank`, and for Prompt 2 `resume`, `interview`, `copilot`) and `platform` (the platform's key served it). The unique index includes both. Callers pass `platform` from the runtime (`ActiveChat.platform`, `ActiveEmbedding.platform`); the feature defaults from the kind (`USAGE_FEATURE_OF_KIND`). Migration `b11-ai-usage-feature` names the feature of older counters and marks them as the college's own key (whose key served them was not recorded).

- **Admin › Billing:** AI tokens on the platform's provider against the allowance, tokens on the college's own key beside it, and a table of this month's tokens by feature and key.
- **Platform › Billing › a college:** this month's platform tokens by price class (chat input, chat output, embeddings) and an estimate of what they cost, at the prices the platform owner sets once in env (`AI_PLATFORM_PRICE_INPUT`, `_OUTPUT`, `_EMBEDDING` per million tokens, `_CURRENCY`). No prices: no estimate.

## Live smoke test

`pnpm --filter @campuslink/api ai:smoke` runs, per provider configured in env (the platform default, plus `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` with their `*_MODEL` settings), one answer, one embedding and one `/quiz` over a fictional passage, and prints the token counts, time and stop reason. Keys are never printed (errors go through `redactSecrets`). It is not part of CI; it closes the "providers tested only against fakes" gap in `docs/phases/phase-9.md`.

## D7: faculty never read students' study chats

The unused `facultySeeChats` switch is gone from the model, service, shared schema, admin screen, strings and tests. Migration `b11-unset-faculty-see-chats` removes the stored field (`$unset`) from every college's settings, since the model is `strict: 'throw'`; a test proves an old document loads before the migration and loads and saves after it. `docs/privacy.md` says so.

## Tests

`test/ai-cost.test.ts`: the default and deep models (and no guessing for other providers); the platform default needing no model for Anthropic; the platform default used when a college has no key, with the allowance as its budget; the budget clamp (lower yes, higher refused); platform tokens counted against the allowance and the college's own not; a plan without AI tokens is not configured; a college's own provider keeps its own budget; usage by feature and key in billing and the console's cost estimate; the usage migration; D7's old settings document.
