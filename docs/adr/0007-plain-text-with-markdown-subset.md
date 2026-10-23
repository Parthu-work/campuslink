# ADR 0007: Store user text as plain text; render a markdown subset as React elements

- Status: accepted
- Date: 2026-10-16

## Context

Posts, comments, questions and answers need light formatting: emphasis, lists, links and hashtags. Storing HTML would make every reader of the database (web, email templates, exports and future apps) responsible for sanitising it, and one missed path means stored XSS across a whole college.

## Decision

1. **The server stores plain text only.** `lib/text.ts › plainText()` runs `sanitize-html` with an **empty allowlist**: every tag and attribute is dropped, the contents of `script`, `style`, `iframe` and similar tags are discarded, entities are decoded, and control and bidi-override characters are removed (Trojan Source). Hashtags are extracted on the server.
2. **The client renders a small markdown subset** (`apps/web/src/lib/markdown.ts`): paragraphs, line breaks, `- ` lists, `**bold**`, `*italic*`, `` `code` ``, `#hashtags` and `https://` links. The parser returns tokens, and `components/ui/rich-text.tsx` turns them into React elements. Nothing is ever set through `innerHTML`, so React escapes all text.
3. **Links:** only `https:` URLs that `new URL()` accepts become links, with `target="_blank" rel="noopener noreferrer nofollow ugc"`. `javascript:`, `data:` and `http:` stay text.
4. **News items** from feeds go through the same plain-text step and are shown as text with a link to the publisher.

## Consequences

- No stored HTML exists, so there is no sanitiser drift between server and client.
- Formatting is limited on purpose. Tables, images in text and headings are not supported; photos are attached as media with required alt text.
- Email and push notifications never contain user text at all (payloads carry ids and names only).
- Tests: `test/feed-lib.test.ts` (sanitiser edge cases) and `apps/web/src/lib/feed-lib.test.ts` (parser, unsafe links, literal HTML).

## Addendum (Phase 9): study assistant answers

The study assistant's answers are written by a language model from the college's material, so they need a little more structure than member posts: headings, numbered lists, fenced code, tables and maths. They follow the same rule.

- Answers are stored as **text, exactly as written** (`modelText()`: control characters and bidi overrides removed). They are never HTML and never interpreted as HTML; `<` in an answer about code (`vector<int>`) is just a character, so the tag-stripping `plainText()` would damage them.
- The web app parses them with an extended subset (`apps/web/src/lib/answer-markdown.ts`): the subset above plus `#` headings, `1.` lists, fenced code, `|` tables, `$…$` and `$$…$$` maths, and `[n]` citations that become links to the cited page or moment. Hashtags stay text in answers. Tokens become React elements in `features/study/chat/answer-text.tsx`; no HTML string is ever inserted.
- **Maths** is drawn by KaTeX (self-hosted, loaded only when an answer contains maths) with MathML output and `trust: false`, which refuses links and raw HTML commands. KaTeX builds the DOM nodes itself into an empty element React never fills, so the "nothing through `innerHTML`" rule holds.
- Tests: `apps/web/src/lib/answer-markdown.test.ts`.
