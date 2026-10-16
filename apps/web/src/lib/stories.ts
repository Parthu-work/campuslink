import type { StoryView } from '@campuslink/shared';

export interface StoryGroup {
  authorId: string;
  author: StoryView['author'];
  stories: StoryView[];
  mine: boolean;
}

/** One ring per author, oldest story first inside a ring; my ring first, then newest activity. */
export function groupStories(stories: StoryView[]): StoryGroup[] {
  const map = new Map<string, StoryGroup>();
  for (const s of stories) {
    const g = map.get(s.author.userId) ?? {
      authorId: s.author.userId,
      author: s.author,
      stories: [],
      mine: s.isMine,
    };
    g.stories.push(s);
    map.set(s.author.userId, g);
  }
  const groups = [...map.values()];
  for (const g of groups) g.stories.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = (g: StoryGroup) => g.stories.at(-1)?.createdAt ?? '';
  return groups.sort((a, b) => Number(b.mine) - Number(a.mine) || latest(b).localeCompare(latest(a)));
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
