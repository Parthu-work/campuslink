import { z } from 'zod';
import type { AiTask } from '../ai-tasks/ai-tasks.service.js';
import { ruleRewrites } from './ats.js';

/** Prompt 2, G2: the résumé's AI tasks, run only through `AiTasksService` (E1). */

export interface RewriteInput {
  bullet: string;
  position: string;
  organisation: string;
}

/** Three tighter versions of one bullet that keep every fact and never add an achievement. */
export const rewriteTask: AiTask<RewriteInput, { alternatives: string[] }> = {
  id: 'resume_rewrite',
  feature: 'resume',
  tier: 'deep',
  system: [
    'You help a student improve one bullet on their résumé.',
    'Write three alternative versions of the bullet in source 1, each one line, starting with a strong verb.',
    'Keep every fact the student wrote and nothing else: never add a number, tool, result, company or achievement that is not in the bullet. If the bullet has no number, do not invent one.',
    'Return {"alternatives":["…","…","…"]}.',
  ].join('\n'),
  buildUser: (i) => ({
    ask: `Rewrite the bullet below. It describes their time as ${i.position || 'a member'}${i.organisation ? ` at ${i.organisation}` : ''}.`,
    member: [{ label: 'bullet', text: i.bullet }],
  }),
  output: z.strictObject({ alternatives: z.array(z.string().trim().min(3).max(240)).min(1).max(3) }),
  maxTokens: 400,
  // The demo: the offline rewrites, or the bullet itself tidied, never a new fact.
  mock: (i) => ({
    alternatives: ruleRewrites(i.bullet).length
      ? ruleRewrites(i.bullet)
      : [i.bullet.trim().replace(/\.$/, '')],
  }),
  fallback: (i) => {
    const r = ruleRewrites(i.bullet);
    return r.length ? { alternatives: r } : null;
  },
};

export interface GapsInput {
  jobDescription: string;
  resume: string;
  missing: string[];
}

/** A short list of gaps between a résumé and a role, from both texts only. */
export const gapsTask: AiTask<GapsInput, { gaps: string[] }> = {
  id: 'resume_ats_gaps',
  feature: 'resume',
  tier: 'fast',
  system: [
    'Compare the résumé (source 1) with the job description (source 2).',
    'List at most five short, concrete gaps the student could close or show better, each under 15 words, in plain English.',
    'Only name skills, tools or experience the job description asks for. Never claim what any employer\x27s system will do.',
    'Return {"gaps":["…"]}.',
  ].join('\n'),
  buildUser: (i) => ({
    ask: `Keywords the job description uses that the résumé does not: ${i.missing.slice(0, 15).join(', ') || 'none'}.`,
    documents: [
      { label: 'résumé', text: i.resume },
      { label: 'job description', text: i.jobDescription },
    ],
  }),
  output: z.strictObject({ gaps: z.array(z.string().trim().min(3).max(140)).max(5) }),
  maxTokens: 300,
  mock: (i) => ({ gaps: missingGaps(i.missing) }),
  fallback: (i) => ({ gaps: missingGaps(i.missing) }),
};

export const missingGaps = (missing: string[]) =>
  missing.slice(0, 5).map((k) => `Show “${k}” if you have used it: the role asks for it.`);
