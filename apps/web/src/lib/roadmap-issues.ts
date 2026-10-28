import type { TFunction } from 'i18next';

/** The editor's names for the roadmap's fields (i18n keys under roadmaps.editor). */
const FIELD: Record<string, string> = {
  title: 'title',
  summary: 'summary',
  category: 'kind',
  branches: 'branches',
  outcomes: 'outcomes',
  sources: 'sources',
  resources: 'resources',
  nodes: 'steps',
  id: 'stepId',
  kind: 'kind',
  estimateHours: 'hoursMin',
};

interface Issue {
  path: readonly PropertyKey[];
  code: string;
  message: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  origin?: string;
}

/**
 * One line for the publish checklist: where ("Step 2 · Step title") and what it needs ("needs at
 * least 10 characters"), in the member's language, instead of the validator's own wording. Messages
 * the schema writes for people (the step graph's problems) pass through unchanged.
 */
export function roadmapIssueText(t: TFunction, issue: Issue): string {
  const path = issue.path.map(String);
  const isIndex = (p: string) => /^\d+$/.test(p);
  const step = path[0] === 'nodes' && isIndex(path[1] ?? '') ? Number(path[1]) : null;
  // A link's title or address names the list it is in (sources, resources).
  const named = [...path].reverse().find((p) => !isIndex(p) && (p in FIELD || p === 'url'));
  const list = path.find((p) => p === 'sources' || p === 'resources');
  const key = FIELD[list ?? named ?? ''] ?? 'roadmap';
  const field = t(`roadmaps.editor.${key === 'roadmap' ? 'roadmap' : key}`);
  const where =
    step !== null && named !== 'nodes' ? `${t('roadmaps.editor.step', { n: step + 1 })} · ${field}` : field;
  const n = (v: number | bigint | undefined) => Number(v ?? 0);
  const what =
    issue.code === 'too_small'
      ? issue.origin === 'array'
        ? t('roadmaps.editor.issue.few', { count: n(issue.minimum) })
        : t('roadmaps.editor.issue.short', { count: n(issue.minimum) })
      : issue.code === 'too_big'
        ? issue.origin === 'array'
          ? t('roadmaps.editor.issue.many', { count: n(issue.maximum) })
          : t('roadmaps.editor.issue.long', { count: n(issue.maximum) })
        : issue.code === 'invalid_value'
          ? t('roadmaps.editor.issue.choose')
          : issue.code === 'invalid_type'
            ? t('roadmaps.editor.issue.missing')
            : issue.message;
  return `${where}: ${what}`;
}
