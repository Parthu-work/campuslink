import type { Branch, Topic } from '@campuslink/shared';

/**
 * Curated starter feeds (free, official RSS/Atom from reputable publishers). Each entry is checked by
 * `pnpm --filter @campuslink/api feeds:verify` (GitHub Actions: .github/workflows/feeds.yml):
 * reachable, allowed by robots.txt, parses as RSS/Atom, has recent items. `verifiedAt` is set only
 * from a passing run; unverified entries cannot be enabled. We show snippets and link out only.
 */
export interface StarterSource {
  key: string;
  name: string;
  publisher: string;
  url: string;
  topics: Topic[];
  branches: Branch[];
  intervalMin: number;
  /** YYYY-MM-DD of the last passing verification, or null. */
  verifiedAt: string | null;
}

export const STARTER_SOURCES: StarterSource[] = [
  {
    key: 'github-blog',
    name: 'The GitHub Blog',
    publisher: 'GitHub',
    url: 'https://github.blog/feed/',
    topics: ['tech-news', 'web-dev'],
    branches: ['CSE', 'IT'],
    intervalMin: 360,
    verifiedAt: null,
  },
  {
    key: 'stackoverflow-blog',
    name: 'Stack Overflow Blog',
    publisher: 'Stack Overflow',
    url: 'https://stackoverflow.blog/feed/',
    topics: ['tech-news'],
    branches: ['CSE', 'IT'],
    intervalMin: 360,
    verifiedAt: null,
  },
  {
    key: 'freecodecamp-news',
    name: 'freeCodeCamp News',
    publisher: 'freeCodeCamp',
    url: 'https://www.freecodecamp.org/news/rss/',
    topics: ['web-dev', 'dsa'],
    branches: ['CSE', 'IT'],
    intervalMin: 360,
    verifiedAt: null,
  },
  {
    key: 'mozilla-hacks',
    name: 'Mozilla Hacks',
    publisher: 'Mozilla',
    url: 'https://hacks.mozilla.org/feed/',
    topics: ['web-dev'],
    branches: ['CSE', 'IT'],
    intervalMin: 720,
    verifiedAt: null,
  },
  {
    key: 'aws-news-blog',
    name: 'AWS News Blog',
    publisher: 'Amazon Web Services',
    url: 'https://aws.amazon.com/blogs/aws/feed/',
    topics: ['cloud-devops'],
    branches: ['CSE', 'IT'],
    intervalMin: 720,
    verifiedAt: null,
  },
  {
    key: 'ieee-spectrum',
    name: 'IEEE Spectrum',
    publisher: 'IEEE',
    url: 'https://spectrum.ieee.org/feeds/feed.rss',
    topics: ['tech-news', 'electronics'],
    branches: ['ECE', 'EEE', 'CSE'],
    intervalMin: 360,
    verifiedAt: null,
  },
  {
    key: 'mit-news-engineering',
    name: 'MIT News: Engineering',
    publisher: 'Massachusetts Institute of Technology',
    url: 'https://news.mit.edu/rss/topic/engineering',
    topics: ['tech-news', 'higher-studies'],
    branches: [],
    intervalMin: 720,
    verifiedAt: null,
  },
  {
    key: 'sciencedaily-computers',
    name: 'ScienceDaily: Computers & Math',
    publisher: 'ScienceDaily',
    url: 'https://www.sciencedaily.com/rss/computers_math.xml',
    topics: ['tech-news', 'ai-ml'],
    branches: ['CSE'],
    intervalMin: 720,
    verifiedAt: null,
  },
  {
    key: 'nasa-news',
    name: 'NASA News Releases',
    publisher: 'NASA',
    url: 'https://www.nasa.gov/news-release/feed/',
    topics: ['tech-news'],
    branches: ['MECH', 'ECE', 'EEE'],
    intervalMin: 720,
    verifiedAt: null,
  },
  {
    key: 'pib-releases',
    name: 'PIB: Press Releases',
    publisher: 'Press Information Bureau, Government of India',
    url: 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3',
    topics: ['govt-schemes'],
    branches: [],
    intervalMin: 180,
    verifiedAt: null,
  },
  {
    key: 'the-hindu-education',
    name: 'The Hindu: Education',
    publisher: 'The Hindu',
    url: 'https://www.thehindu.com/education/feeder/default.rss',
    topics: ['education-news'],
    branches: [],
    intervalMin: 180,
    verifiedAt: null,
  },
  {
    key: 'indian-express-education',
    name: 'The Indian Express: Education',
    publisher: 'The Indian Express',
    url: 'https://indianexpress.com/section/education/feed/',
    topics: ['education-news'],
    branches: [],
    intervalMin: 180,
    verifiedAt: null,
  },
];
