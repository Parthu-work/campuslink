import { describe, expect, it } from 'vitest';
import { browserWantsLessData, dataSaverOn, persistable, stripContacts, toSaved } from './offline-rules';

describe('the offline copy (B13)', () => {
  it('keeps only the member’s own reads', () => {
    for (const key of [
      ['tenant'],
      ['me'],
      ['conversations'],
      ['job-tracker'],
      ['bookings', 'upcoming'],
      ['bookings', 'past'],
      ['roadmaps', 'following'],
      ['placement-drives', 'registered'],
      ['feed', 'for_you'],
      ['messages', 'c1'],
      ['conversation', 'c1'],
      ['roadmap', 'backend'],
      ['material', 'm1'],
      ['placement-drive', 'd1'],
    ])
      expect(persistable(key), JSON.stringify(key)).toBe(true);
    for (const key of [
      ['profile', 'u1'],
      ['people', ''],
      ['mentor', 'u1'],
      ['feed', 'following'],
      ['placement-drives', 'all'],
      ['roadmaps', 'list', ''],
      ['admin-overview'],
      ['analytics', ''],
      ['me', 'extra'],
      ['messages', 1],
    ])
      expect(persistable(key), JSON.stringify(key)).toBe(false);
  });

  it('strips contact details at any depth, except from the member’s own profile', () => {
    const booking = {
      id: 'b1',
      other: { name: 'Asha', email: 'asha@example.com', phone: '+919000000000', profile: { mobile: '1' } },
    };
    expect(stripContacts(booking)).toEqual({ id: 'b1', other: { name: 'Asha', profile: {} } });
    expect(toSaved(['bookings', 'upcoming'], [booking])).toEqual([
      { id: 'b1', other: { name: 'Asha', profile: {} } },
    ]);
    const me = { id: 'u1', email: 'me@example.com' };
    expect(toSaved(['me'], me)).toEqual(me);
  });

  it('keeps the first feed page only', () => {
    const feed = { pages: [{ rows: [1] }, { rows: [2] }], pageParams: ['', 'c2'] };
    expect(toSaved(['feed', 'for_you'], feed)).toEqual({ pages: [{ rows: [1] }], pageParams: [''] });
  });

  it('keeps a conversation’s newest 50 messages', () => {
    const msgs = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${from + i}` }));
    // Pages run newest first; each lists its messages oldest first.
    const data = {
      pages: [
        { data: msgs(61, 30), meta: { nextCursor: 'a' } },
        { data: msgs(31, 30), meta: { nextCursor: 'b' } },
        { data: msgs(1, 30), meta: { nextCursor: null } },
      ],
      pageParams: ['', 'a', 'b'],
    };
    const saved = toSaved(['messages', 'c1'], data) as typeof data;
    expect(saved.pages).toHaveLength(2);
    expect(saved.pageParams).toEqual(['', 'a']);
    expect(saved.pages[0]?.data).toHaveLength(30);
    // The older page keeps its newest 20, and has nothing older to load offline.
    expect(saved.pages[1]?.data.map((m) => m.id)).toEqual(msgs(41, 20).map((m) => m.id));
    expect(saved.pages[1]?.meta.nextCursor).toBeNull();
    expect(saved.pages.flatMap((p) => p.data)).toHaveLength(50);
  });
});

describe('data saver (B13)', () => {
  const nav = (connection: object | undefined) => ({ connection }) as unknown as Navigator;

  it('follows the browser when automatic', () => {
    expect(browserWantsLessData(nav({ saveData: true }))).toBe(true);
    expect(browserWantsLessData(nav({ effectiveType: '2g' }))).toBe(true);
    expect(browserWantsLessData(nav({ effectiveType: 'slow-2g' }))).toBe(true);
    expect(browserWantsLessData(nav({ effectiveType: '4g' }))).toBe(false);
    expect(browserWantsLessData(nav(undefined))).toBe(false);
    expect(browserWantsLessData(undefined)).toBe(false);
  });

  it('on and off override the browser', () => {
    expect(dataSaverOn('auto', true)).toBe(true);
    expect(dataSaverOn('auto', false)).toBe(false);
    expect(dataSaverOn('on', false)).toBe(true);
    expect(dataSaverOn('off', true)).toBe(false);
  });
});
