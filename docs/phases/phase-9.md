# Phase 9: Subject library and AI study assistant

Phase 9 builds `docs/specs/ai-study-assistant.md` (Appendix A of the revamp master prompt) in the six steps of its §13, each one gated, pushed and recorded separately. The full design and the admin's set-up steps are in `docs/ai-assistant.md`.

Phase 9 is done when everything in the spec's §12 has a passing test, the only thing left for a college is to paste an API key in **Admin › AI assistant**, and every path works without one.

## Steps

| Step | Scope                                                                                                                                                                                                                       | Status |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1    | Data model, permissions, subjects and syllabus (with paste import), who takes a subject, the AI settings page, encrypted key storage, provider interfaces and adapters (Anthropic, OpenAI, Gemini, OpenAI-compatible, mock) | Done   |
| 2    | Material upload, storage, validation, the processing pipeline, PDF and video viewers, keyword search                                                                                                                        |        |
| 3    | Chunking, embeddings, the vector store (Qdrant and in-memory), hybrid retrieval, back-fill and re-index                                                                                                                     |        |
| 4    | The chatbot (streaming, citations, scopes, modes) and every slash command, with the video segment index                                                                                                                     |        |
| 5    | Analytics, the admin AI dashboard, budgets and limits, degradation                                                                                                                                                          |        |
| 6    | Hardening, injection and isolation suites, docs, seeded FLAT demo and the end-to-end demo                                                                                                                                   |        |

## Step 1 in detail

- **Permissions** (`packages/shared/src/roles.ts`): `study:read` (every verified member), `study:contribute` (alumni and certified contributors, per subject an admin grants), `study:upload`, `study:manage` and `study:analytics` (faculty, placement, admins), `ai:settings` (college admins). The navigation's Study tab (students) and Subjects tab (staff) now ship.
- **API** (`apps/api/src/modules/study/`): subjects (create, edit, archive, search), the syllabus tree (replace with id-keeping, paste-to-suggest that only reuses words from the text), per-student overrides, contributors, `GET /study/ai-status`, and `/admin/ai` (settings, keys, test connection, consent).
- **Keys:** encrypted with `FieldCipher` (`keys.*.apiKeyEnc`, in `ENCRYPTED_COLLECTIONS`), never returned (last four characters only), never logged or audited, and redacted from provider errors. Saving a key tests it at once.
- **SSRF:** a college may only enter a public `https` endpoint; private or plain-http origins need the platform owner's `AI_PRIVATE_ENDPOINTS`. `safeFetch` gained `allowPrivateNetwork` for exactly those.
- **Web:** the Study library, the subject page (syllabus tree, people sheet for owners, overrides and contributors), the subject form, the syllabus editor (paste, review, re-order with buttons, keywords), and Admin › AI assistant (checklist, provider and models, masked key with Save and test, embeddings, data notice, limits, switches, kill switch).
- **Tests:** `test/study.test.ts`, `test/ai-providers.test.ts`, `test/isolation/study.test.ts`, the privacy suite (subjects and AI settings), the field-rotation coverage test, `safe-fetch.test.ts`, `lib/study.test.ts` and `e2e/study.spec.ts`.
