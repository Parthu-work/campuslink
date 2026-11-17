import type { ReactNode } from 'react';
import { useTranslation } from '../../i18n/react';
import type { RoadmapContent, RoadmapNode } from '@campuslink/shared';
import { Badge } from '../../components/ui/misc';
import { cn } from '../../lib/cn';
import { diffContent, type PathField, type StepField } from '../../lib/roadmaps';

/** One value as a reviewer reads it: text as written, lists one per line, hours as a range. */
function useValue() {
  const { t } = useTranslation();
  const titles = (content: RoadmapContent, ids: string[]) =>
    ids.map((id) => content.nodes.find((n) => n.id === id)?.title ?? id);
  const list = (items: string[]) =>
    items.length ? (
      <ul className="grid list-disc gap-0.5 pl-5">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    ) : (
      '—'
    );
  return {
    step: (node: RoadmapNode, field: StepField, content: RoadmapContent): ReactNode => {
      switch (field) {
        case 'kind':
          return t(`roadmaps.kind.${node.kind}`);
        case 'prerequisites':
          return list(titles(content, node.prerequisites));
        case 'estimateHours':
          return t('roadmaps.aboutHours', { min: node.estimateHours[0], max: node.estimateHours[1] });
        case 'resources':
        case 'sources':
          return list(node[field].map((s) => s.title));
        case 'needsReview':
          return node.needsReview ? t('roadmaps.needsReview') : t('roadmaps.review.cited');
        default:
          return node[field] || '—';
      }
    },
    path: (content: RoadmapContent, field: PathField): ReactNode => {
      switch (field) {
        case 'category':
          return t(`roadmaps.cat.${content.category}`);
        case 'branches':
          return content.branches.join(', ');
        case 'outcomes':
          return list(content.outcomes);
        case 'sources':
          return list(content.sources.map((s) => s.title));
        default:
          return content[field];
      }
    },
  };
}

/**
 * One changed value, before and after: two columns from tablet width, stacked on a phone. The old
 * value is a deletion and the new one an insertion, so a screen reader says which is which.
 */
function Change({ label, before, after }: { label: string; before: ReactNode; after: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-1.5">
      <h4 className="text-callout font-semibold text-fg-2">{label}</h4>
      <div className="grid gap-2 md:grid-cols-2">
        <del className="grid gap-0.5 rounded-[var(--radius-sm)] bg-danger-surface p-3 text-callout no-underline">
          <span className="text-caption font-semibold text-danger-ink">{t('roadmaps.review.before')}</span>
          <span className="text-fg [overflow-wrap:anywhere]">{before}</span>
        </del>
        <ins className="grid gap-0.5 rounded-[var(--radius-sm)] bg-success-surface p-3 text-callout no-underline">
          <span className="text-caption font-semibold text-success-ink">{t('roadmaps.review.after')}</span>
          <span className="text-fg [overflow-wrap:anywhere]">{after}</span>
        </ins>
      </div>
    </div>
  );
}

/**
 * What a new version changes, side by side (prompt 3, U3): the path's own details, then each step
 * added, removed or changed, with every changed value before and after. The first version has
 * nothing to compare with and says how many steps it starts with.
 */
export function VersionDiff({ before, after }: { before: RoadmapContent | null; after: RoadmapContent }) {
  const { t } = useTranslation();
  const value = useValue();
  if (!before)
    return (
      <p className="text-callout text-fg-2">{t('roadmaps.firstVersion', { count: after.nodes.length })}</p>
    );
  const d = diffContent(before, after);
  if (!d.roadmap.length && !d.nodes.length)
    return <p className="text-callout text-fg-2">{t('roadmaps.noChanges')}</p>;
  return (
    <div className="grid gap-6">
      {!!d.roadmap.length && (
        <section className="grid gap-3">
          <h3 className="text-headline font-semibold">{t('roadmaps.diff.roadmap')}</h3>
          {d.roadmap.map((f) => (
            <Change
              key={f}
              label={t(`roadmaps.field.${f}`)}
              before={value.path(before, f)}
              after={value.path(after, f)}
            />
          ))}
        </section>
      )}
      {d.nodes.map((c) => (
        <section
          key={`${c.kind}-${c.node.id}`}
          className={cn(
            'grid gap-3 border-l-4 pl-4',
            c.kind === 'added' && 'border-success',
            c.kind === 'removed' && 'border-danger',
            c.kind === 'changed' && 'border-warning',
          )}
        >
          <h3 className="flex flex-wrap items-center gap-2 text-headline font-semibold">
            <Badge tone={c.kind === 'added' ? 'success' : c.kind === 'removed' ? 'danger' : 'warning'}>
              {t(`roadmaps.diff.${c.kind}`)}
            </Badge>
            <span className="[overflow-wrap:anywhere]">{c.node.title}</span>
          </h3>
          {c.kind === 'changed' ? (
            c.fields.map((f) => (
              <Change
                key={f}
                label={t(`roadmaps.field.${f}`)}
                before={value.step(c.before, f, before)}
                after={value.step(c.node, f, after)}
              />
            ))
          ) : (
            <p className="text-callout text-fg-2">{c.node.summary}</p>
          )}
        </section>
      ))}
    </div>
  );
}
