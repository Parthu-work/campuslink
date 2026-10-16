import type { Branch } from '@campuslink/shared';

/**
 * Candidate public job boards of employers that hire in India. Each is checked by
 * `pnpm --filter @campuslink/api jobs:verify` in GitHub Actions (.github/workflows/feeds.yml):
 * the board exists, answers on its documented public API, and lists at least one opening in India.
 * `verifiedAt` is set only from a passing run; unverified boards cannot be added.
 */
export interface StarterBoard {
  key: string;
  kind: 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters';
  board: string;
  company: string;
  branches: Branch[];
  verifiedAt: string | null;
}

const software: Branch[] = ['CSE', 'IT', 'AIML', 'DS'];

export const STARTER_BOARDS: StarterBoard[] = [
  {
    key: 'gh-rubrik',
    kind: 'greenhouse',
    board: 'rubrik',
    company: 'Rubrik',
    branches: software,
    verifiedAt: '2026-10-16',
  },
  {
    key: 'gh-druva',
    kind: 'greenhouse',
    board: 'druva',
    company: 'Druva',
    branches: software,
    verifiedAt: '2026-10-16',
  },
  {
    key: 'lv-cred',
    kind: 'lever',
    board: 'cred',
    company: 'CRED',
    branches: software,
    verifiedAt: '2026-10-16',
  },
  {
    key: 'lv-meesho',
    kind: 'lever',
    board: 'meesho',
    company: 'Meesho',
    branches: software,
    verifiedAt: '2026-10-16',
  },
  {
    key: 'lv-zeta',
    kind: 'lever',
    board: 'zeta',
    company: 'Zeta',
    branches: software,
    verifiedAt: '2026-10-16',
  },
  {
    key: 'ab-atlan',
    kind: 'ashby',
    board: 'atlan',
    company: 'Atlan',
    branches: software,
    verifiedAt: '2026-10-16',
  },
  {
    key: 'sr-servicenow',
    kind: 'smartrecruiters',
    board: 'ServiceNow',
    company: 'ServiceNow',
    branches: software,
    verifiedAt: '2026-10-16',
  },
  {
    key: 'sr-bosch',
    kind: 'smartrecruiters',
    board: 'BoschGroup',
    company: 'Bosch',
    branches: ['MECH', 'EEE', 'ECE', 'CSE'],
    verifiedAt: '2026-10-16',
  },
];
