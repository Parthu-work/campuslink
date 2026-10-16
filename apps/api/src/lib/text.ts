import sanitizeHtml from 'sanitize-html';

/**
 * User text is stored as plain text. Formatting (a small markdown subset) is rendered by the web app
 * into React elements, never as HTML. This allowlist sanitizer (empty allowlist) removes any markup
 * people paste, keeping the text inside tags; script and style contents are dropped entirely.
 */
export function plainText(input: string): string {
  const stripped = sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object'],
  });
  return (
    decodeEntities(stripped)
      // Control characters and bidi overrides (Trojan Source) never belong in user text.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
  reg: '®',
  trade: '™',
  rupee: '₹',
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** `#tags` in text: lowercase, letters/digits/_/-, at most 10. */
export function extractHashtags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_-]{2,30})/gu)) {
    out.add((m[1] ?? '').toLowerCase());
    if (out.size >= 10) break;
  }
  return [...out];
}

/** Plain-text snippet: whitespace collapsed, cut at a word boundary. */
export function snippet(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}
