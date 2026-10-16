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
