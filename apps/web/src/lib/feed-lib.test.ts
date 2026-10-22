import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { PostView, StoryView } from '@campuslink/shared';
import { parseBlocks, parseInline, safeHref } from './markdown';
import { patchPost, withReaction } from './feed';
import { groupStories } from './stories';

describe('markdown subset', () => {
  it('parses emphasis, code, links and hashtags', () => {
    expect(parseInline('**Bold** and *it* with `x<y` #GATE2027 https://example.org/a.')).toEqual([
      { t: 'bold', v: [{ t: 'text', v: 'Bold' }] },
      { t: 'text', v: ' and ' },
      { t: 'italic', v: [{ t: 'text', v: 'it' }] },
      { t: 'text', v: ' with ' },
      { t: 'code', v: 'x<y' },
      { t: 'text', v: ' ' },
      { t: 'tag', v: 'GATE2027' },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://example.org/a', v: 'https://example.org/a' },
      { t: 'text', v: '.' },
    ]);
  });

  it('keeps a Telugu hashtag whole (vowel signs are combining marks)', () => {
    expect(parseInline('#తెలుగు notes')).toEqual([
      { t: 'tag', v: 'తెలుగు' },
      { t: 'text', v: ' notes' },
    ]);
  });

  it('never produces non-https links', () => {
    const nodes = parseInline('javascript:alert(1) http://plain.example data:text/html,x');
    expect(nodes.every((n) => n.t === 'text')).toBe(true);
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('https://ok.example/x')).toBe('https://ok.example/x');
  });

  it('keeps HTML as literal text', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
      { t: 'text', v: '<img src=x onerror=alert(1)>' },
    ]);
  });

  it('splits paragraphs, line breaks and lists', () => {
    const b = parseBlocks('One\ntwo\n\n- a\n- b\n\nEnd');
    expect(b.map((x) => x.t)).toEqual(['p', 'ul', 'p']);
    expect(b[0]?.t === 'p' && b[0].lines).toHaveLength(2);
    expect(b[1]?.t === 'ul' && b[1].items).toHaveLength(2);
  });

  it('a lone asterisk or unclosed marker is just text', () => {
    expect(parseInline('5 * 3 and **open')).toEqual([{ t: 'text', v: '5 * 3 and **open' }]);
  });
});

const post = (over: Partial<PostView> = {}): PostView => ({
  id: 'p1',
  kind: 'text',
  author: {
    userId: 'u',
    name: 'A',
    avatarFileId: null,
    roles: [],
    headline: '',
    branch: null,
    gradYear: null,
  },
  body: 'x',
  topics: [],
  hashtags: [],
  media: [],
  poll: null,
  link: null,
  announcement: false,
  counts: { reactions: { helpful: 2, insightful: 0, celebrate: 0 }, comments: 0, saves: 0, shares: 0 },
  myReaction: 'helpful',
  saved: false,
  isMine: false,
  status: 'published',
  removal: null,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('optimistic post updates', () => {
  it('switching a reaction moves one count', () => {
    const p = withReaction(post(), 'celebrate');
    expect(p.counts.reactions).toEqual({ helpful: 1, insightful: 0, celebrate: 1 });
    expect(withReaction(p, null).counts.reactions).toEqual({ helpful: 1, insightful: 0, celebrate: 0 });
  });

  it('patches every cached copy and rolls back', () => {
    const qc = new QueryClient();
    qc.setQueryData(['feed', 'for_you'], {
      pages: [{ rows: [{ type: 'post', post: post() }] }],
      pageParams: [''],
    });
    qc.setQueryData(['post', 'p1'], post());
    qc.setQueryData(['post', 'p2'], post({ id: 'p2' }));
    const rollback = patchPost(qc, 'p1', (p) => ({ ...p, saved: true }));
    expect(qc.getQueryData<PostView>(['post', 'p1'])?.saved).toBe(true);
    expect(qc.getQueryData<PostView>(['post', 'p2'])?.saved).toBe(false);
    const feed = qc.getQueryData<{ pages: { rows: { post: PostView }[] }[] }>(['feed', 'for_you']);
    expect(feed?.pages[0]?.rows[0]?.post.saved).toBe(true);
    rollback();
    expect(qc.getQueryData<PostView>(['post', 'p1'])?.saved).toBe(false);
  });
});

describe('story rings', () => {
  const story = (id: string, author: string, at: string, isMine = false) =>
    ({ id, author: { userId: author, name: author }, isMine, createdAt: at }) as unknown as StoryView;
  it('groups by author, mine first, oldest story first within a ring', () => {
    const g = groupStories([
      story('a2', 'ann', '2026-01-01T03:00:00Z'),
      story('b1', 'bob', '2026-01-01T05:00:00Z'),
      story('a1', 'ann', '2026-01-01T01:00:00Z'),
      story('m1', 'me', '2026-01-01T00:00:00Z', true),
    ]);
    expect(g.map((x) => x.authorId)).toEqual(['me', 'bob', 'ann']);
    expect(g[2]?.stories.map((s) => s.id)).toEqual(['a1', 'a2']);
  });
  it('puts rings with something new before rings already watched on this device', () => {
    const g = groupStories(
      [
        story('b1', 'bob', '2026-01-01T05:00:00Z'),
        story('a1', 'ann', '2026-01-01T01:00:00Z'),
        story('a2', 'ann', '2026-01-01T03:00:00Z'),
      ],
      new Set(['b1', 'a1']),
    );
    expect(g.map((x) => [x.authorId, x.seen])).toEqual([
      ['ann', false],
      ['bob', true],
    ]);
  });
});
