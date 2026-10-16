import { createHash } from 'node:crypto';
import { z } from 'zod';
import { roadmapContent, type RoadmapContent } from '@campuslink/shared';
import backend from './backend.json' with { type: 'json' };
import dataAnalyst from './data-analyst.json' with { type: 'json' };
import dataEngineer from './data-engineer.json' with { type: 'json' };
import dataScience from './data-science.json' with { type: 'json' };
import devopsCloud from './devops-cloud.json' with { type: 'json' };
import ece from './ece.json' with { type: 'json' };
import eee from './eee.json' with { type: 'json' };
import frontend from './frontend.json' with { type: 'json' };
import mlAiEngineer from './ml-ai-engineer.json' with { type: 'json' };
import mobile from './mobile.json' with { type: 'json' };
import productManagement from './product-management.json' with { type: 'json' };
import qaSdet from './qa-sdet.json' with { type: 'json' };
import sdeDsa from './sde-dsa.json' with { type: 'json' };
import sre from './sre.json' with { type: 'json' };
import uiUx from './ui-ux.json' with { type: 'json' };
import webFullstack from './web-fullstack.json' with { type: 'json' };

/**
 * The researched roadmap library (docs/roadmap-sources.md). Every roadmap and node cites its
 * sources; nodes resting on editorial judgement are marked `needsReview`. Each college installs
 * copies and owns them from then on through the normal review workflow.
 */
const libraryRoadmap = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  lastReviewedAt: z.iso.date(),
});

export interface LibraryRoadmap {
  key: string;
  lastReviewedAt: string;
  content: RoadmapContent;
  /** Changes whenever the researched content changes (offers an update to installed copies). */
  hash: string;
}

function load(raw: unknown): LibraryRoadmap {
  const { key, lastReviewedAt } = libraryRoadmap.parse(raw);
  const rest: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  delete rest.key;
  delete rest.lastReviewedAt;
  const content = roadmapContent.parse(rest);
  const hash = createHash('sha256')
    .update(JSON.stringify({ lastReviewedAt, content }))
    .digest('hex')
    .slice(0, 16);
  return { key, lastReviewedAt, content, hash };
}

export const LIBRARY: readonly LibraryRoadmap[] = [
  backend,
  dataAnalyst,
  dataEngineer,
  dataScience,
  devopsCloud,
  ece,
  eee,
  frontend,
  mlAiEngineer,
  mobile,
  productManagement,
  qaSdet,
  sdeDsa,
  sre,
  uiUx,
  webFullstack,
].map(load);
export const LIBRARY_FILES = [
  'backend',
  'data-analyst',
  'data-engineer',
  'data-science',
  'devops-cloud',
  'ece',
  'eee',
  'frontend',
  'ml-ai-engineer',
  'mobile',
  'product-management',
  'qa-sdet',
  'sde-dsa',
  'sre',
  'ui-ux',
  'web-fullstack',
];
