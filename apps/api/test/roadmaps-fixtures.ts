import type { RoadmapContent } from '@campuslink/shared';

const src = (n: number) => ({ title: `Demo source ${n}`, url: `https://example.org/source-${n}` });

/** A small valid roadmap (fictional sources on example.org). */
export function demoContent(over: Partial<RoadmapContent> = {}): RoadmapContent {
  return {
    title: 'Zyxquark Engineer',
    summary: 'A demo roadmap used by the tests: three steps from basics to a project you can show.',
    category: 'software',
    branches: ['CSE', 'IT'],
    outcomes: ['Zyxquark Engineer'],
    sources: [src(1), src(2)],
    nodes: [
      {
        id: 'basics',
        title: 'Learn the basics',
        kind: 'skill',
        summary: 'Start with the fundamentals and practise a little every day.',
        prerequisites: [],
        estimateHours: [10, 20],
        resources: [src(3)],
        proof: 'Explain the basics to a friend.',
        sources: [src(3)],
        needsReview: false,
      },
      {
        id: 'practice',
        title: 'Practise problems',
        kind: 'milestone',
        summary: 'Solve a set of practice problems and review the ones you got wrong.',
        prerequisites: ['basics'],
        estimateHours: [20, 30],
        resources: [],
        proof: '',
        sources: [],
        needsReview: true,
      },
      {
        id: 'project',
        title: 'Build a project',
        kind: 'project',
        summary: 'Build something small that uses what you learned, and publish it.',
        prerequisites: ['practice'],
        estimateHours: [20, 40],
        resources: [],
        proof: 'A public repository with a README.',
        sources: [src(4)],
        needsReview: false,
      },
    ],
    ...over,
  };
}
