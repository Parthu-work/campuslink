import { describe, expect, it } from 'vitest';
import type { TFunction } from '../i18n/core';
import { roadmapContent } from '@campuslink/shared';
import { roadmapIssueText } from './roadmap-issues';

// Keys and options, so the test reads what the member would be told without loading strings.
const t = ((k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k)) as TFunction;

describe('roadmapIssueText', () => {
  const issues = () => {
    const r = roadmapContent.safeParse({
      title: 'ab',
      summary: 'short',
      category: 'software',
      branches: [],
      nodes: [{ id: 'x', title: 'A', kind: 'skill', summary: 'tiny', estimateHours: [1, 2] }],
    });
    if (r.success) throw new Error('expected problems');
    return r.error.issues.map((i) => roadmapIssueText(t, i));
  };

  it('names the field and what it needs, never the validator wording', () => {
    const lines = issues();
    expect(lines).toContain('roadmaps.editor.title: roadmaps.editor.issue.short{"count":3}');
    expect(lines).toContain('roadmaps.editor.branches: roadmaps.editor.issue.few{"count":1}');
    expect(lines.join('\n')).not.toMatch(/Too small|expected/);
  });

  it('places a step problem on its step', () => {
    expect(issues()).toContain(
      'roadmaps.editor.step{"n":1} · roadmaps.editor.title: roadmaps.editor.issue.short{"count":2}',
    );
  });
});
