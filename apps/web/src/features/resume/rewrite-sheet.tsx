import { useEffect, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RewriteView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { Badge, Skeleton } from '../../components/ui/misc';
import { api } from '../../lib/api';
import { wordDiff } from './word-diff';

export interface RewriteTarget {
  section: 'work' | 'projects';
  entry: number;
  bullet: number;
}

/** A suggestion with the words it adds or changes marked. */
function Diffed({ original, next }: { original: string; next: string }) {
  return (
    <>
      {wordDiff(original, next)
        .map((part, i) =>
          part.added ? (
            <ins key={i} className="rounded-sm bg-success-surface px-0.5 text-success-ink no-underline">
              {part.text}
            </ins>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )
        .reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, ' ', el] : [el]), [])}
    </>
  );
}

/**
 * A tighter version of one saved bullet, right under it (prompt 2, G2; prompt 3, U7): the new or
 * changed words marked, then Use this, Another version, or Keep mine. The suggestions keep the facts
 * the member wrote: the model is told never to add a number or result, and the server drops any
 * that does.
 */
export function InlineRewrite({
  resumeId,
  target,
  onPick,
  onClose,
}: {
  resumeId: string;
  target: RewriteTarget;
  onPick: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const rewrite = useMutation({
    mutationFn: () => api.post<RewriteView>(`/resumes/${resumeId}/rewrite`, target),
  });
  const { mutate } = rewrite;
  useEffect(() => mutate(), [mutate]);
  const r = rewrite.data;
  const options = r?.alternatives ?? [];
  const current = options[index % Math.max(1, options.length)];
  return (
    <div
      role="group"
      aria-label={t('resume.rewrite.title')}
      aria-live="polite"
      className="grid gap-3 rounded-[var(--radius-md)] border border-line bg-surface-2 p-3"
    >
      {rewrite.isPending && <Skeleton className="h-16" />}
      {rewrite.isError && <ErrorState error={rewrite.error} onRetry={() => mutate()} />}
      {r && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-callout font-semibold">
              {options.length > 1
                ? t('resume.rewrite.suggestedN', { n: (index % options.length) + 1, total: options.length })
                : t('resume.rewrite.suggested')}
            </span>
            <Badge tone={r.source === 'ai' ? 'brand' : 'neutral'}>
              {t(`resume.rewrite.source.${r.source}`)}
            </Badge>
          </div>
          {current ? (
            <p className="text-callout text-pretty">
              <Diffed original={r.original} next={current} />
            </p>
          ) : (
            <p className="text-callout text-fg-2">{t('resume.rewrite.none')}</p>
          )}
          {!!r.tips.length && (
            <ul className="grid list-disc gap-1 pl-5 text-callout text-fg-2">
              {r.tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {current && (
              <Button size="sm" variant="primary" onClick={() => onPick(current)}>
                {t('resume.rewrite.use')}
              </Button>
            )}
            {options.length > 1 && (
              <Button size="sm" variant="secondary" onClick={() => setIndex((i) => i + 1)}>
                {t('resume.rewrite.another')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t('resume.rewrite.keep')}
            </Button>
          </div>
          <p className="text-caption text-fg-3">
            {t('resume.rewrite.diffNote')} {t('resume.rewrite.facts')}
          </p>
        </>
      )}
    </div>
  );
}
