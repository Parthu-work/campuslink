import { beforeEach, describe, expect, it } from 'vitest';
import { extractHashtags, plainText, snippet } from '../src/lib/text.js';
import { readMp4, stripMp4Metadata } from '../src/lib/mp4.js';
import { parseRobots, robotsAllows } from '../src/lib/robots.js';
import { linkPreview } from '../src/lib/link-preview.js';
import { parseFeed, FeedParseError } from '../src/modules/content-sources/rss.js';
import { canonicalUrl, contentHash, urlHash } from '../src/modules/content-sources/canonical.js';
import { judge } from '../src/modules/content-sources/quality.js';
import { autoTags } from '../src/modules/content-sources/tagging.js';
import { clearRobotsCache, fetchFeed } from '../src/modules/content-sources/fetch.js';
import { decodeCursor, encodeCursor, rankScore, type RankInput } from '../src/modules/feed/feed.service.js';
import { fakeFetcher, fakeMp4, rss } from './feed-fixtures.js';

describe('plain text and hashtags', () => {
  it('strips all markup with the allowlist sanitizer, dropping script contents', () => {
    expect(plainText('<b>Bold</b> and <script>alert(1)</script><img src=x onerror=alert(2)>text')).toBe(
      'Bold and text',
    );
    expect(plainText('a &amp; b &lt;tag&gt; &#x1F600; &rsquo;')).toBe('a & b <tag> 😀 ’');
    expect(plainText('rtl‮trick\u0000 and\r\n\n\n\nlines')).toBe('rtltrick and\n\nlines');
    expect(plainText('**bold** _md_ stays')).toBe('**bold** _md_ stays');
  });

  it('extracts at most 10 lowercase hashtags', () => {
    expect(extractHashtags('Try #DSA and #GATE-2027, not mid#word (#placements)')).toEqual([
      'dsa',
      'gate-2027',
      'placements',
    ]);
    expect(extractHashtags(Array.from({ length: 15 }, (_, i) => `#tag${i}`).join(' '))).toHaveLength(10);
  });

  it('snippets cut on a word boundary', () => {
    expect(snippet('one two three four five', 13)).toBe('one two three…');
    expect(snippet('short', 20)).toBe('short');
  });
});

describe('MP4 reels', () => {
  it('reads duration and size from the header', () => {
    expect(readMp4(fakeMp4(42.5))).toMatchObject({
      brand: 'isom',
      durationSec: 42.5,
      width: 1080,
      height: 1920,
    });
    expect(readMp4(Buffer.from('not a video at all'))).toBeNull();
    const noMoov = fakeMp4(1).subarray(0, 24);
    expect(readMp4(noMoov)).toBeNull();
  });

  it('neutralises metadata boxes in place (same length, offsets intact)', () => {
    const src = fakeMp4(10);
    const out = stripMp4Metadata(src);
    expect(out.length).toBe(src.length);
    expect(src.toString('latin1')).toContain('GPS-SECRET');
    expect(out.toString('latin1')).not.toContain('GPS-SECRET');
    expect(out.toString('latin1')).not.toContain('TRACK-SECRET-NAME');
    expect(readMp4(out)?.durationSec).toBe(10);
  });
});

describe('robots.txt (RFC 9309)', () => {
  const r = parseRobots(`
User-agent: *
Disallow: /private/
Allow: /private/feed.xml
Disallow: /*.json$

User-agent: CampusLinkBot
User-agent: OtherBot
Disallow: /bots-out
`);
  it('applies the most specific group and the longest matching rule', () => {
    expect(robotsAllows(r, 'SomeBot', '/private/x')).toBe(false);
    expect(robotsAllows(r, 'SomeBot', '/private/feed.xml')).toBe(true);
    expect(robotsAllows(r, 'SomeBot', '/data.json')).toBe(false);
    expect(robotsAllows(r, 'SomeBot', '/data.json?x=1')).toBe(true);
    expect(robotsAllows(r, 'CampusLinkBot', '/private/x')).toBe(true); // own group replaces *
    expect(robotsAllows(r, 'CampusLinkBot', '/bots-out/feed')).toBe(false);
    expect(robotsAllows(parseRobots(''), 'Any', '/x')).toBe(true);
  });
});

describe('feed parsing', () => {
  it('reads RSS and keeps snippets only', () => {
    const f = parseFeed(
      rss([
        {
          title: 'Scholarship &amp; fellowships open',
          link: 'https://news.example/a',
          description: '<p>Apply <b>now</b> &mdash; deadline soon</p>',
        },
        { title: 'No link item', link: 'javascript:alert(1)' },
      ]),
    );
    expect(f.format).toBe('rss');
    expect(f.items).toHaveLength(1);
    expect(f.items[0]).toMatchObject({
      title: 'Scholarship & fellowships open',
      url: 'https://news.example/a',
      snippet: 'Apply now — deadline soon',
    });
  });

  it('reads Atom', () => {
    const f = parseFeed(
      `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom demo</title><entry><title>GATE notice</title><link rel="alternate" href="https://gate.example/n1"/><updated>2026-10-01T10:00:00Z</updated><summary>Exam dates</summary><category term="exams"/></entry></feed>`,
    );
    expect(f).toMatchObject({ format: 'atom', title: 'Atom demo' });
    expect(f.items[0]).toMatchObject({
      title: 'GATE notice',
      url: 'https://gate.example/n1',
      categories: ['exams'],
    });
    expect(f.items[0]?.publishedAt.toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });

  it('refuses DTDs (XXE, entity bombs) and non-feeds', () => {
    expect(() =>
      parseFeed(
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><rss><channel><title>&a;</title></channel></rss>',
      ),
    ).toThrow(FeedParseError);
    expect(() => parseFeed('<html><body>hi</body></html>')).toThrow(/not an RSS or Atom/);
  });
});

describe('de-duplication, quality and tagging', () => {
  it('canonicalises URLs', () => {
    expect(canonicalUrl('https://News.Example:443/a/b/?utm_source=x&b=2&a=1&fbclid=z#top')).toBe(
      'https://news.example/a/b?a=1&b=2',
    );
    expect(urlHash('https://x.example/p?utm_medium=y')).toBe(urlHash('https://x.example/p'));
    expect(contentHash('Big News!', 'Same text')).toBe(contentHash('big news', 'same  text'));
  });

  it('rejects spam, holds low quality, publishes the rest', () => {
    expect(judge({ title: 'Win big at the online casino today', snippet: '' }).status).toBe('rejected');
    expect(judge({ title: 'Short', snippet: 'x' }).status).toBe('rejected');
    expect(judge({ title: 'YOU WILL NOT BELIEVE THIS EXAM NEWS', snippet: 'x' })).toMatchObject({
      status: 'held',
      reasons: ['all_caps'],
    });
    expect(judge({ title: 'Results announced!!!', snippet: 'x' }).reasons).toContain('punctuation');
    expect(
      judge({ title: 'GATE 2027 registration opens on the official site', snippet: 'Details inside' }).status,
    ).toBe('published');
  });

  it('tags topics and branches by keyword', () => {
    const t = autoTags('GATE 2027 notification for VLSI and semiconductor roles; scholarship details', {
      topics: ['education-news'],
      branches: [],
    });
    expect(t.topics).toEqual(
      expect.arrayContaining(['education-news', 'gate', 'scholarships', 'electronics']),
    );
    expect(t.branches).toContain('ECE');
  });
});

describe('ranking', () => {
  const asOf = new Date('2026-10-16T12:00:00Z');
  const base: RankInput = {
    createdAt: asOf,
    followedAuthor: false,
    followedSource: false,
    topicMatches: 0,
    branchMatch: false,
    alumniAuthor: false,
    announcement: false,
    engagement: 0,
  };
  it('halves with each day, and boosts follows, topics, branch, alumni and engagement', () => {
    expect(rankScore(base, asOf)).toBe(1);
    expect(rankScore({ ...base, createdAt: new Date(asOf.getTime() - 24 * 3600_000) }, asOf)).toBeCloseTo(
      0.5,
    );
    expect(rankScore({ ...base, followedAuthor: true }, asOf)).toBe(2);
    expect(rankScore({ ...base, topicMatches: 5 }, asOf)).toBeCloseTo(1.9);
    expect(
      rankScore({ ...base, branchMatch: true, alumniAuthor: true, announcement: true }, asOf),
    ).toBeCloseTo(2.05);
    expect(rankScore({ ...base, engagement: Math.E - 1 }, asOf)).toBeCloseTo(1.15);
    // A followed alumnus' post from yesterday still beats a fresh unknown one.
    expect(
      rankScore(
        {
          ...base,
          createdAt: new Date(asOf.getTime() - 20 * 3600_000),
          followedAuthor: true,
          alumniAuthor: true,
        },
        asOf,
      ),
    ).toBeGreaterThan(1);
  });

  it('round-trips the cursor and rejects junk', () => {
    expect(decodeCursor(encodeCursor({ a: 123, o: 15 }))).toEqual({ a: 123, o: 15 });
    expect(decodeCursor('not-base64-json')).toBeNull();
    expect(decodeCursor(encodeCursor({ a: 1, o: 99_999 }))).toBeNull();
  });
});

describe('polite fetching', () => {
  beforeEach(() => clearRobotsCache());
  const feedUrl = 'https://news.example/feed.xml';

  it('checks robots.txt first and sends conditional headers', async () => {
    const f = fakeFetcher({
      'https://news.example/robots.txt': { body: 'User-agent: *\nAllow: /', contentType: 'text/plain' },
      [feedUrl]: {
        body: rss([{ title: 'A real headline here', link: 'https://news.example/1' }]),
        headers: { etag: '"v1"', 'cache-control': 'max-age=7200' },
      },
    });
    const r = await fetchFeed(feedUrl, f.fn, { etag: '"v0"', lastModified: 'Tue, 13 Oct 2026 10:00:00 GMT' });
    expect(r).toMatchObject({ kind: 'ok', etag: '"v1"', maxAgeSec: 7200 });
    expect(f.calls[1]?.headers).toMatchObject({
      'if-none-match': '"v0"',
      'if-modified-since': 'Tue, 13 Oct 2026 10:00:00 GMT',
    });
    expect(f.calls[1]?.headers['user-agent']).toMatch(/Bot\/1\.0/);
  });

  it('obeys robots.txt, 304s, Retry-After and content types', async () => {
    const deny = fakeFetcher({
      'https://news.example/robots.txt': {
        body: 'User-agent: *\nDisallow: /feed',
        contentType: 'text/plain',
      },
    });
    expect((await fetchFeed(feedUrl, deny.fn)).kind).toBe('blocked');
    expect(deny.calls).toHaveLength(1);
    clearRobotsCache();
    const down = fakeFetcher({ 'https://news.example/robots.txt': { status: 503 } });
    expect((await fetchFeed(feedUrl, down.fn)).kind).toBe('blocked'); // 5xx robots: assume disallow
    clearRobotsCache();
    const missing = { 'https://news.example/robots.txt': { status: 404 } };
    expect((await fetchFeed(feedUrl, fakeFetcher({ ...missing, [feedUrl]: { status: 304 } }).fn)).kind).toBe(
      'not_modified',
    );
    clearRobotsCache();
    const slow = await fetchFeed(
      feedUrl,
      fakeFetcher({ ...missing, [feedUrl]: { status: 429, headers: { 'retry-after': '7200' } } }).fn,
    );
    expect(slow).toMatchObject({ kind: 'error', retryAfterSec: 7200 });
    clearRobotsCache();
    const html = await fetchFeed(
      feedUrl,
      fakeFetcher({ ...missing, [feedUrl]: { body: '<html></html>', contentType: 'text/html' } }).fn,
    );
    expect(html).toMatchObject({ kind: 'error' });
  });

  it('link previews read title, description and site name only', async () => {
    const f = fakeFetcher({
      'https://blog.example/post': {
        contentType: 'text/html; charset=utf-8',
        body: '<html><head><title>Fallback</title><meta property="og:title" content="Five GATE tips &amp; tricks"><meta content="From a topper" name="description"><meta property="og:site_name" content="Demo Blog"><meta property="og:image" content="https://tracker.example/pixel.gif"></head></html>',
      },
    });
    const p = await linkPreview('https://blog.example/post', f.fn);
    expect(p).toEqual({
      url: 'https://blog.example/post',
      host: 'blog.example',
      title: 'Five GATE tips & tricks',
      description: 'From a topper',
      siteName: 'Demo Blog',
    });
    expect(f.calls.map((c) => c.url)).toEqual(['https://blog.example/post']); // the image is never fetched
    expect(await linkPreview('https://down.example/x', f.fn)).toMatchObject({
      host: 'down.example',
      title: '',
    });
  });
});
