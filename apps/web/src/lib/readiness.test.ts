import { describe, expect, it } from 'vitest';
import { READINESS_ACTIONS, READINESS_COMPONENTS, type ReadinessComponentView } from '@campuslink/shared';
import strings from '../i18n/packs/readiness.en.json';
import { readinessActionHref, readinessFactKey } from './readiness';

/** Prompt 2, G5: every next step has words (and a place to do it), every fact a sentence. */
const has = (group: Record<string, string>, key: string) =>
  key in group || `${key}_one` in group || `${key}_other` in group;

describe('readiness next steps', () => {
  it('every action has words and a link', () => {
    for (const id of READINESS_ACTIONS) {
      expect(has(strings.readiness.action, id), id).toBe(true);
      expect(readinessActionHref({ id }), id).toMatch(/^\//);
    }
    expect(readinessActionHref({ id: 'roadmap_steps', target: 'sde-path' })).toBe('/roadmaps/sde-path');
  });

  it('every component and status picks a sentence that exists', () => {
    const view = (over: Partial<ReadinessComponentView>): ReadinessComponentView => ({
      id: 'resume',
      status: 'scored',
      weight: 1,
      points: 0,
      max: 0,
      facts: {},
      next: null,
      ...over,
    });
    const keys = [
      ...READINESS_COMPONENTS.map((id) => readinessFactKey(view({ id }))),
      ...(['off', 'not_applicable', 'not_available'] as const).map((status) =>
        readinessFactKey(view({ status })),
      ),
      readinessFactKey(view({ id: 'resume', facts: { resumes: 1, ats: null } })),
      readinessFactKey(view({ id: 'resume', facts: { resumes: 1, ats: 70 } })),
      readinessFactKey(view({ id: 'interviews', facts: { mocks: 2, average: null } })),
      readinessFactKey(view({ id: 'interviews', facts: { mocks: 2, average: 3.5 } })),
      readinessFactKey(view({ id: 'roadmap', facts: { roadmap: 'SDE' } })),
      readinessFactKey(view({ id: 'eligibility', facts: { pending: 1 } })),
      readinessFactKey(view({ id: 'eligibility', facts: { cgpa: 7.5 } })),
    ];
    for (const k of keys) expect(has(strings.readiness.facts, k), k).toBe(true);
    for (const id of READINESS_COMPONENTS) expect(strings.readiness.component[id]).toBeTruthy();
  });
});
