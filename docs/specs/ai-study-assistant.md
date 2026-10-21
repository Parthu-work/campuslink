# APPENDIX A: FEATURE SPEC — Subject Content Library + AI Study Chatbot (RAG)

(Save this appendix verbatim as `docs/specs/ai-study-assistant.md` in Step 0.)

Read `CLAUDE.md`, the master specification and `docs/design/revamp/master-prompt.md` first. Everything there still applies: tenant isolation, security and privacy first, free and open-source tools only (paid providers behind adapters with stubs), no invented data, strict TypeScript, tests, and the design system. This spec adds one feature. Build it **completely**, so the only thing left to do afterwards is paste an LLM API key into Settings.

## 1. Feature summary

Faculty (and other permitted roles) upload study material for each **subject** (for example "FLAT: Formal Languages and Automata Theory"): PDFs, documents, slides, notes, videos, and video links. When material is uploaded, the system automatically processes it so a **study chatbot inside the app** can answer students' questions about any topic in the syllabus, using that material, with citations.

In the chat, students can also use **slash commands**. For example, `/videos pumping lemma` returns every related video in the portal for that topic, each with a thumbnail, duration, and a deep link to the exact timestamp where the topic is discussed.

### Important technical clarification (implement this, do not "train" anything)
The LLM is **not trained or fine-tuned** on uploaded content. Implement **Retrieval-Augmented Generation (RAG)**:
1. Extract text from uploaded content, split it into chunks, and create vector embeddings.
2. Store the chunks and embeddings in a vector index, scoped by tenant and subject.
3. At question time, retrieve the most relevant chunks, then send only those to the LLM with strict instructions to answer from them and cite them.

This is cheaper, updates instantly when content changes, can be deleted cleanly, and keeps colleges' content separate.

### Scope rule
Build **all** of the pipeline, UI, settings, APIs, background jobs, storage, search, security, analytics and tests. The **only** thing that is not wired to a real external service is the LLM and embedding provider: implement them as adapters, ship a working `mock` provider for local development and tests, and let a real key be attached from Settings. With no key configured, the app must still work gracefully (see section 8).

## 2. Roles and permissions

Add permissions to the shared permission map and the permission matrix doc:

- **Upload, edit and delete content:** `FACULTY`, `TPO`, `COLLEGE_ADMIN`; `ALUMNI` and `CERTIFIED_CONTRIBUTOR` only for subjects the admin has granted them. Contributor uploads go through a **review and publish** step.
- **Use the chatbot and library:** students enrolled in (or whose branch and semester maps to) the subject, plus faculty, alumni and admins in the tenant.
- **Configure AI settings:** `COLLEGE_ADMIN` (per tenant). `SUPER_ADMIN` can set an optional platform default and view usage, but **cannot read tenant API keys or chat content**.
- **View analytics:** faculty for their subjects, admins for the tenant.

Enforce on the backend with object-level checks. A student must never retrieve chunks from a subject they have no access to, even through crafted prompts or API calls.

## 3. Data model (Mongoose, all created through `defineTenantModel`)

- `subjects`: name, code, branch, semester, regulation/year, description, faculty owners, status.
- `syllabusUnits` and `syllabusTopics`: ordered hierarchy (Subject → Unit → Topic) with keywords. Support **syllabus import**: paste text, upload a PDF, or enter manually. When AI is configured, offer "auto-extract units and topics from the syllabus PDF" as a suggestion the faculty reviews before saving.
- `enrollments` or a rule mapping students to subjects by branch, semester and batch, with an admin override.
- `materials`: subject, optional unit and topic tags, title, type (`pdf`, `doc`, `slides`, `notes`, `image`, `video_file`, `video_link`, `audio`), file reference or URL, uploader, version, visibility (`draft`, `in_review`, `published`, `archived`), rights attestation (checkbox: "I have the right to share this"), size, checksum, page count or duration, language.
- `materialProcessingJobs`: stage (`uploaded`, `scanning`, `extracting`, `ocr`, `transcribing`, `chunking`, `embedding`, `indexed`, `failed`), progress, error details, attempts, timestamps.
- `contentChunks`: tenantId, subjectId, materialId, unit/topic tags, text, page number or start and end timestamp, chunk index, token count, content hash, embedding status, embedding model ID and version.
- `videoSegments`: for videos, transcript segments with timestamps, chapter titles and topic tags.
- `chatSessions` and `chatMessages`: user, subject scope, messages, citations (chunk IDs), command used, token counts, latency, feedback (thumbs up or down and an optional reason), flags.
- `aiSettings` (per tenant): provider, model names (chat and embedding), API key encrypted with the existing `FieldCipher` (field `apiKeyEnc`, listed in `ENCRYPTED_COLLECTIONS`), base URL (for OpenAI-compatible endpoints), temperature and limits, monthly token budget, per-user daily limits, feature toggles (chatbot on or off, external video suggestions on or off, allow students to upload), data-processing consent record, and key status (`not_set`, `valid`, `invalid`, last validated).
- `aiUsage`: per tenant, user and day token counts and estimated cost, for budgets and the admin dashboard.
- `unansweredQuestions`: questions where retrieval confidence was low, for faculty gap analytics.

## 4. Ingestion pipeline (background jobs through `JobQueue`, resumable and idempotent)

On upload, create a job and move through these stages, with progress shown live in the UI (service-emitted Socket.io events):

1. **Validate and scan through `FilesService`:** add new upload purposes for study materials and use its existing sniffing (MIME sniffing, not just the extension), configurable size caps, allowed types, random storage names, `claim()`, `deleteAfter` and purpose-based access. Add archive and zip-bomb protection and a checksum for **duplicate detection**. The antivirus scan keeps the existing **fail-closed** behaviour; never add a fallback that lets unscanned files through.
2. **Extract text:**
   - PDF: text layer extraction (pdf.js or pdf-parse), preserving page numbers; headings and tables where feasible.
   - **Scanned or image PDFs and images:** OCR with Tesseract (free) behind an `OcrProvider` adapter, with English and Telugu language packs configurable.
   - DOCX (mammoth), PPTX (slide text and speaker notes), TXT, MD, CSV.
3. **Video and audio:**
   - Accept uploaded transcripts (`.vtt`, `.srt`) and use them directly.
   - Otherwise use a `TranscriptionProvider` adapter: local Whisper (faster-whisper or whisper.cpp, optional Docker service) and a cloud adapter that uses the API key from Settings. If no provider is available, mark the video as "no transcript" and still index its title, description, chapters and manual tags so `/videos` can find it.
   - Extract duration, thumbnail (ffmpeg), and auto-generate chapter markers from transcript segments when AI is available.
   - **Video links (YouTube and others):** store metadata through official oEmbed or the official API only, via the SSRF-safe fetcher. **Do not scrape** and do not download copyrighted video. Faculty can paste or upload a transcript and add timestamps and topic tags manually. Embed with the official player behind a click-to-load facade (section 14).
4. **Clean and chunk:** remove headers, footers and page numbers, normalize whitespace, keep structure. Use **structure-aware chunking** (by heading, paragraph and sentence boundaries; roughly 300 to 800 tokens with 10 to 15 percent overlap), and attach metadata (subject, unit, topic, page or timestamp, material title). Keep code blocks, formulas and tables intact where possible.
5. **Auto-tag** chunks to syllabus topics: first by keyword and heading match, and additionally by embedding similarity when AI is configured.
6. **Embed:** batch embeddings through the `EmbeddingProvider` adapter with retries, rate-limit backoff and cost tracking. Store the embedding model ID and version on each chunk so a model change triggers a **re-index job** instead of silent mixing.
7. **Index:** write to the vector store (section 5) and to the keyword index. Mark the material `indexed`, and notify the uploader through `NotificationsService.notify()` (ids only).

Also implement: **re-process** (manual and on new version), **delete** (removes the file, chunks, vectors and transcripts everywhere), **versioning**, retry with backoff, a dead-letter queue, and a clear failure message in the UI. If no API key is set when a material is uploaded, the pipeline completes everything except embeddings, marks chunks `embedding_pending`, and **automatically back-fills embeddings the moment a valid key is saved**.

## 5. Retrieval design

- **Vector store behind a `VectorStore` interface.** Default implementation: **Qdrant** (free, open source) added to `docker-compose.yml` under a profile. Every point carries `tenantId`, `subjectId`, `materialId`, `unitId`, `topicId`, `visibility`. **Every query must include a mandatory `tenantId` filter plus the user's allowed `subjectIds`**, applied inside the repository layer, never by the caller. A query without a `tenantId` filter must throw. Provide an in-memory implementation for tests, and a documented alternative adapter stub (for example pgvector or MongoDB Atlas Vector Search).
- **Hybrid retrieval:** combine vector similarity with keyword search (`$text` only through `db/search.ts`, or optional Meilisearch) using reciprocal rank fusion, then an optional re-ranking step (a `Reranker` adapter that can use the LLM, with a no-op default). Use metadata filters (subject, unit, topic, only `published`).
- **Query handling:** rewrite follow-up questions into standalone queries using chat history, detect language (English and Telugu), and support multi-subject search when the user has not scoped one.
- **Confidence threshold:** if the best retrieved chunks are below the threshold, do not guess. Say the material does not cover it, suggest related topics, and log it in `unansweredQuestions`.
- **Keyword-only fallback:** when no embeddings exist (no key yet), search and chat retrieval still work through keyword search, and the UI shows a small notice that AI answers are not enabled.

## 6. Chatbot behavior

**Answer generation**
- Build the prompt server-side: a system prompt defining a helpful study assistant, rules to **answer only from the provided context**, to say so when the context is insufficient, to cite sources as `[1]`, `[2]` mapped to chunk IDs, to match the student's language, and to explain step by step at a student level (with a "simple / detailed / exam-style" mode toggle).
- **Streaming responses** over an authenticated SSE route (CSRF-protected where cookies are used), with a stop button, regenerate, copy, and thumbs up or down with an optional reason.
- **Citations UI:** source chips under every answer showing material title, page number or timestamp. Clicking a PDF citation opens the in-app viewer **at that page** with the passage highlighted. Clicking a video citation opens the player **at that timestamp**.
- Store answers as plain text and render them with the existing markdown subset as React elements (ADR 0007), extended for code, tables and math (self-hosted, lazily loaded KaTeX). Never store or render HTML. Handle automata diagrams in text gracefully (for example, transition tables).
- Conversation memory limited to the last few turns for context, with a per-session summary to control tokens.
- Chat scopes: current subject (default when opened from a subject page), a chosen subject, or all enrolled subjects. Show the scope clearly and let the user change it.
- Suggested questions per subject (generated from syllabus topics) and "Ask about this page" from inside the PDF viewer (selected text becomes the question context).

**Slash commands** (typing `/` opens an autocomplete menu with descriptions; fully keyboard accessible; also available from the command palette):
- `/videos <topic>`: returns **all related videos** in the portal for that topic as a swipeable list of cards (thumbnail, title, subject and unit, duration, uploader, and **the best matching timestamps** from the transcript, each a deep link). Ranking is by semantic and keyword relevance to the topic's chunks and tags. Group results as "Exact topic" and "Related." If the optional external-suggestions toggle is on and a YouTube Data API key exists in Settings, append a clearly separated "From the web" group (links only, using the official API). If none are found, say so and suggest nearby topics.
- `/notes <topic>`: list and open the notes, slides and PDFs for a topic, with page references.
- `/summary <topic or material>`: concise structured summary with citations.
- `/explain <topic>`: step-by-step explanation with an example, with a difficulty selector.
- `/quiz <topic> [n]`: generate multiple-choice and short-answer questions **from the material only**, with answers and explanations, scored in the UI, with results saved as a progress signal (XP only through the `award` callback).
- `/flashcards <topic>`: flip cards exportable to a deck inside the app.
- `/important <unit>`: frequently covered concepts based on emphasis in the material (clearly labeled as derived from the uploaded material, not as exam predictions).
- `/syllabus`: show the syllabus tree and jump to any topic.
- `/subject <name>`: change chat scope.
- `/help`: list all commands.

Commands that don't need generation (`/videos`, `/notes`, `/syllabus`) must work using retrieval and metadata even **without** an LLM key. Commands that need generation (`/summary`, `/explain`, `/quiz`, `/flashcards`, `/important`) show a friendly "AI is not enabled for your college yet" state, and tell admins where to enable it.

## 7. Settings (the only step left for the college admin)

Admin settings page **"AI Assistant"** (tenant-level):
- Provider dropdown: Anthropic (Claude), OpenAI, Google Gemini, and **OpenAI-compatible custom endpoint**, plus `mock`. Implement `LLMProvider` and `EmbeddingProvider` interfaces with working adapters for each, so adding a provider is one file. Separate model selectors for chat and for embeddings (the embedding provider can differ from the chat provider, and the UI must explain that some providers do not offer embeddings).
- **Custom endpoints and SSRF:** every provider call goes through the SSRF-safe fetcher. Tenant admins may only enter public HTTPS endpoints. Private-network endpoints (such as a local Ollama or LM Studio) are allowed only through a platform-owner environment allowlist, never through tenant settings.
- API key input with **Test connection** (makes a tiny request, shows valid or invalid and the detected models). The key is **encrypted at rest with `FieldCipher`** (covered by `rotate-field-key`), **never returned to the client** (show only the last 4 characters), never logged, and redacted from errors. Only `COLLEGE_ADMIN` can set or replace it.
- Limits and budgets: monthly token budget, per-user daily message limit, max tokens per answer, max retrieved chunks, temperature, and a kill switch. Show current usage with a chart and estimated cost. Behavior when the budget is hit: friendly message, and keyword-only mode remains.
- Toggles: enable chatbot, allow student uploads (with review), enable external video suggestions, enable OCR and transcription, and data retention for chat history.
- **Consent and transparency:** before enabling, show an explicit notice that **excerpts of uploaded content and student questions are sent to the selected third-party provider**; the admin must accept, and the acceptance is versioned and audit-logged. Students see a short notice in the chat ("Answers are generated by AI from your college's material and may contain mistakes. Check the sources.").
- A first-run checklist: "1. Choose provider, 2. Paste key, 3. Test connection, 4. Backfill embeddings (progress shown)". Saving a valid key triggers the automatic back-fill and re-index.

An environment-level default provider (for the platform owner's own deployment) is optional and tenant settings override it.

## 8. Graceful degradation (must all work and be tested)

- No key set → library, upload, extraction, chunking, keyword search, `/videos`, `/notes`, `/syllabus` all work; AI answers are replaced by retrieved passages (extractive answer) plus a notice.
- Invalid or expired key → clear admin alert and fallback to keyword mode, with no crash.
- Provider outage, rate limit or timeout → retries with backoff, circuit breaker, user-friendly message.
- Budget exceeded → fallback as above.

## 9. Security and privacy (non-negotiable)

- **Prompt-injection defense:** treat all uploaded content as untrusted data. Place it in clearly delimited context blocks, instruct the model never to follow instructions found inside the context, strip or neutralize suspicious instruction patterns at ingestion, never give the model tools or secrets, and cap output length. Add tests with malicious PDFs ("ignore previous instructions…").
- **Isolation:** tenant and subject filters enforced in the retrieval layer; tests prove a student cannot retrieve another tenant's or an unenrolled subject's chunks via the API, chat, `/videos`, citations, file URLs or signed links.
- **Access to files:** short-lived signed URLs, authorization re-checked per request, no public buckets, and no directory listing.
- **Data minimization to the LLM:** send only retrieved chunks and the question. **Never** send names, emails, roll numbers or other profile data. Redact obvious personal data (phone numbers, emails, ID numbers) in questions before sending.
- Rate limits and abuse controls on chat, uploads and commands; message and upload size caps; output moderation hook; per-user quotas.
- Safe rendering: model output goes only through the ADR 0007 markdown subset (no raw HTML ever), with link targets validated against injection.
- Copyright: require rights attestation on upload, keep an audit trail (who uploaded what), provide a takedown flow for admins, and show the uploader and source on every material.
- Audit-log: key set, replaced or removed, provider changes, consent acceptance, bulk deletes, re-index runs.
- Privacy: chat history is private to the student by default; faculty see only **aggregated and anonymized** question analytics (through `suppress()`), not individual conversations, unless the college policy toggle explicitly allows it and students are told. Students can delete their chat history. Honor deletion requests across chats, vectors and files.
- Update `docs/threat-model.md`, `docs/privacy.md` and the permission matrix for this feature.

## 10. UI/UX

Follow the Campus Aurora design system (light, dark and system themes) and section 8b of `docs/design/revamp/master-prompt.md`, using the rebuilt `components/ui/` primitives. Mobile-first, fluid and accessible.

- **Subject Library:** subject cards (progress and last activity), a subject page with a syllabus tree, tabs for Notes, Slides, Videos, PYQs and Other, filters by unit and topic, search, and per-material status chips for faculty (`processing`, `indexed`, `failed`).
- **Upload experience:** drag and drop with multi-file queue, per-file progress, tagging to unit and topic (with smart suggestions), a rights checkbox, live processing stages, and clear errors. Works on mobile, including camera capture.
- **In-app viewers:** PDF viewer with page navigation, text search, highlight-from-citation, and "Ask about this" on selection. Video player with transcript side panel, clickable timestamps, chapters, playback speed, and "jump to where this topic is discussed."
- **Chatbot:** a floating launcher on subject pages plus a full-screen chat page; streaming, citation chips, slash-command menu, command result cards (video carousel, quiz player, flashcard deck), suggestion chips, scope selector, answer-mode toggle, and thumbs feedback. Smooth micro-interactions, skeleton and typing states, reduced-motion support, and keyboard-first operation. Telugu and English UI strings.
- **Empty and error states** for everything, including "AI not enabled yet" states that feel intentional, not broken.
- **Faculty analytics:** most asked topics, unanswered questions (content gaps with an "Upload material for this" action), most used materials, helpful versus unhelpful answer rates, and student engagement per unit.
- **Admin AI dashboard:** usage, cost estimate, failures, queue health, and indexing coverage per subject.

## 11. Seed data and local development

- Add Qdrant (and optional Meilisearch, whisper service) to `docker-compose.yml` with profiles so the base stack stays light.
- Seed a demo subject (**FLAT: Formal Languages and Automata Theory**) with a syllabus tree, a few small **self-authored or openly licensed** sample documents and a short sample video with a transcript, all clearly labelled as demo. **Do not include copyrighted textbooks or fabricated claims.**
- The `mock` provider returns deterministic embeddings and canned but context-grounded answers so the whole flow (upload → index → ask → cite → `/videos`) is demonstrable end to end with no key.
- Document everything in `docs/ai-assistant.md`: architecture diagram (Mermaid), pipeline stages, how to add a provider, how to switch the vector store, cost-control tips, and the exact steps for an admin to attach a key.

## 12. Testing and acceptance criteria

- Upload PDF/DOCX/PPTX/scanned PDF/video+VTT → reaches `indexed` with correct chunk counts, page numbers and timestamps.
- Duplicate upload detected; re-upload creates a new version; delete removes chunks, vectors, files and transcripts.
- With `mock` provider: asking a question about an uploaded topic returns an answer with correct citations, and clicking a citation opens the right page or timestamp.
- `/videos <topic>` returns all relevant videos ranked, with working timestamp deep links, with and without an LLM key.
- Out-of-scope question returns "not covered" and is logged as unanswered.
- **Isolation suite (blocks CI):** cross-tenant and cross-subject retrieval, file access, citations and analytics all denied, for MongoDB collections and Qdrant alike.
- **Injection suite:** malicious document content does not change model behavior or leak data (verified against the mock with instruction-following traps).
- Key handling: key never appears in API responses, logs or errors; encryption round-trip and rotation work; only admins can set it.
- SSRF: tenant settings reject private-network and non-HTTPS endpoints.
- Degradation paths in section 8 behave as specified.
- Back-fill: saving a valid key after uploads triggers embedding of all pending chunks and updates the UI progress.
- Privacy: export and erasure cover every new collection and the vectors.
- Performance: p95 retrieval under 300 ms locally with 50,000 chunks; chat streaming starts under 1.5 s with the mock; the UI stays at 60fps while streaming; the initial JS budget is unchanged.
- Accessibility: chat, slash menu, viewers and upload flow pass axe checks and are keyboard-operable.

## 13. Delivery order (stop for review after each step)

1. Data model, permissions, subjects and syllabus management, and settings skeleton with encrypted key storage and provider interfaces (with the mock provider).
2. Material upload, storage, validation, processing pipeline, and viewers (PDF and video), working with keyword search only.
3. Chunking, embeddings, the vector store, hybrid retrieval, and the back-fill job.
4. Chatbot (streaming, citations, scopes, modes) and all slash commands, with `/videos` and the video segment index.
5. Analytics, admin AI dashboard, budgets and limits, plus degradation handling.
6. Security hardening, injection and isolation tests, docs, and a final end-to-end demo with the seeded FLAT subject.

## 14. Repository integration rules

1. **Phase:** this is Phase 9. Document it in `docs/phases/` like earlier phases. Use `APP_NAME` from `packages/shared/src/brand.ts`; never hard-code the product name.
2. **Tenancy:** every new collection's compound indexes lead with `tenantId`, and each gets cross-tenant read, write, update, delete and search tests.
3. **Privacy rights:** chats, materials, chunks, transcripts and usage records expose `exportFor` and `eraseFor`, are registered with `PrivacyService`, and get cases in `test/privacy.test.ts`. Erasure removes the vectors too.
4. **Shared mechanisms:** background work on a member's behalf uses `backgroundAuth()`. Points go only through the `award` callback, with rules and caps in `packages/shared`.
5. **Realtime:** Socket.io stays as it is. Clients only send `typing`, and services emit everything else; new events get isolation tests in `test/realtime.test.ts`.
6. **CSP:** YouTube needs new sources (`frame-src` for `youtube-nocookie.com`, `img-src` for its thumbnails). Add them only in `deploy/nginx/security-headers.conf` with its test, and use a click-to-load facade so no request reaches YouTube until the student taps play.
7. **Performance:** the 170 KB initial JS budget does not change. PDF.js (with its worker), KaTeX, the video player, the markdown extensions and the chat UI are all lazy-loaded.
8. **Deployment:** ffmpeg, Tesseract and Whisper go in a separate worker image in `deploy/`, not the API image. Update `docs/deployment.md` and the staging smoke test.
9. **Paid providers:** Anthropic, OpenAI and Gemini are allowed under the `CLAUDE.md` rule that paid providers sit behind an adapter with a stub. The `mock` provider is that stub and must cover every code path.
