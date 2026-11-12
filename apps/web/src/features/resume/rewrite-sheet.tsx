import { useEffect, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RewriteView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Sheet } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { api } from '../../lib/api';
import { wordDiff } from './word-diff';

export interface RewriteTarget {
  section: 'work' | 'projects';
  entry: number;
  bullet: number;
}

/**
 * Tighter versions of one saved bullet (prompt 2, G2). They keep the facts the member wrote: the
 * model is told never to add a number or result, and the server drops any that does.
 */
export function RewriteSheet({
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
  const rewrite = useMutation({
    mutationFn: () => api.post<RewriteView>(`/resumes/${resumeId}/rewrite`, target),
  });
  const { mutate } = rewrite;
  useEffect(() => mutate(), [mutate]);
  const r = rewrite.data;
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('resume.rewrite.title')}
      description={t('resume.rewrite.body')}
    >
      <div className="grid gap-4" aria-live="polite">
        {rewrite.isPending && <Skeleton className="h-40 rounded-[var(--radius-lg)]" />}
        {rewrite.isError && <ErrorState error={rewrite.error} onRetry={() => mutate()} />}
        {r && (
          <>
            <div className="grid gap-1">
              <p className="text-caption text-fg-3">{t('resume.rewrite.yours')}</p>
              <p className="rounded-[var(--radius-md)] bg-surface-2 p-3 text-callout">{r.original}</p>
            </div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{t('resume.rewrite.options')}</h3>
              <Badge tone={r.source === 'ai' ? 'brand' : 'neutral'}>
                {t(`resume.rewrite.source.${r.source}`)}
              </Badge>
            </div>
            {r.alternatives.length ? (
              <ul className="grid gap-2">
                {r.alternatives.map((a) => (
                  <li key={a}>
                    <Card variant="raised" className="grid gap-2 p-3">
                      <p className="text-callout">
                        {wordDiff(r.original, a)
                          .map((part, i) =>
                            part.added ? (
                              <ins
                                key={i}
                                className="rounded-sm bg-success-surface px-0.5 text-success-ink no-underline"
                              >
                                {part.text}
                              </ins>
                            ) : (
                              <span key={i}>{part.text}</span>
                            ),
                          )
                          .reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, ' ', el] : [el]), [])}
                      </p>
                      <div>
                        <Button size="sm" onClick={() => onPick(a)}>
                          {t('resume.rewrite.use')}
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-callout text-fg-2">{t('resume.rewrite.none')}</p>
            )}
            {!!r.tips.length && (
              <div className="grid gap-1.5">
                <h3 className="font-semibold">{t('resume.rewrite.tips')}</h3>
                <ul className="grid list-disc gap-1 pl-5 text-callout">
                  {r.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-caption text-fg-3">{t('resume.rewrite.diffNote')}</p>
            <p className="text-caption text-fg-3">{t('resume.rewrite.facts')}</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
