import type { StoryView } from '@campuslink/shared';
import { prefs } from './storage';

export interface StoryGroup {
  authorId: string;
  author: StoryView['author'];
  stories: StoryView[];
  mine: boolean;
  /** Every story in the ring was opened on this device. */
  seen: boolean;
}

/**
 * Story ids opened on this device, so rings dim once watched (a per-device convenience, like a read
 * marker; stories expire in a day, so the list stays short).
 */
const SEEN_KEY = 'stories-seen';
export function seenStories(): Set<string> {
  try {
    return new Set(JSON.parse(prefs.get(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
export function markStorySeen(id: string) {
  const seen = seenStories();
  if (seen.has(id)) return;
  prefs.set(SEEN_KEY, JSON.stringify([...seen, id].slice(-300)));
}

/** One ring per author, oldest story first inside a ring; my ring first, then newest activity. */
export function groupStories(stories: StoryView[], seen: Set<string> = new Set()): StoryGroup[] {
  const map = new Map<string, StoryGroup>();
  for (const s of stories) {
    const g = map.get(s.author.userId) ?? {
      authorId: s.author.userId,
      author: s.author,
      stories: [],
      mine: s.isMine,
      seen: true,
    };
    g.stories.push(s);
    if (!seen.has(s.id)) g.seen = false;
    map.set(s.author.userId, g);
  }
  const groups = [...map.values()];
  for (const g of groups) g.stories.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = (g: StoryGroup) => g.stories.at(-1)?.createdAt ?? '';
  // Mine first, then rings with something new, newest activity first.
  return groups.sort(
    (a, b) =>
      Number(b.mine) - Number(a.mine) ||
      Number(a.seen) - Number(b.seen) ||
      latest(b).localeCompare(latest(a)),
  );
}

export const STORY_MS = 6000;

export const storyBackground: Record<string, string> = {
  brand: 'linear-gradient(150deg, var(--brand-2), color-mix(in srgb, var(--brand-2) 55%, black))',
  accent:
    'linear-gradient(150deg, color-mix(in srgb, var(--accent) 45%, black), color-mix(in srgb, var(--accent) 25%, black))',
  sunset: 'var(--story-sunset)',
  ocean: 'var(--story-ocean)',
  forest: 'var(--story-forest)',
};
