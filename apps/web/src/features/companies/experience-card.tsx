import type { ReactNode } from 'react';
import type { ExperienceView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Badge, Card } from '../../components/ui/misc';
import { ContentMenu } from '../feed/content-menu';

/**
 * One Interview Experience Bank write-up (prompt 2, G10): who wrote it (a first name only if they
 * chose, with their branch and batch), the rounds with the questions in their words, and tips.
 */
export function ExperienceCard({
  e,
  reviewer = false,
  actions,
  questionAction,
}: {
  e: ExperienceView;
  /** Reviewers and the author see where each question was sent. */
  reviewer?: boolean;
  actions?: ReactNode;
  questionAction?: (round: number, question: number, kind: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const who = e.author.name ?? t('moat.card.byAnon');
  const batch =
    e.author.branch || e.author.gradYear
      ? t('moat.card.batchOf', { branch: e.author.branch ?? '', batch: e.author.gradYear ?? '' })
      : '';
  return (
    <Card variant="raised" className="grid gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 className="font-semibold">
            {e.role} · {e.company.name} · {e.year}
          </h3>
          <p className="flex flex-wrap items-center gap-2 text-meta text-fg-2">
            <span>{batch ? `${who}, ${batch}` : who}</span>
            <Badge tone="brand">{t(`moat.basis.${e.author.basis}`)}</Badge>
            <Badge>{t(`moat.result.${e.result}`)}</Badge>
            <span>{t('moat.card.difficulty', { level: t(`moat.difficulty.${e.difficulty}`) })}</span>
          </p>
        </div>
        {!e.mine && !reviewer && e.status === 'published' && !e.removed && (
          <ContentMenu
            targetType="experience"
            targetId={e.id}
            authorId=""
            authorName={who}
            isMine={false}
            blockable={false}
          />
        )}
      </div>
      <ol className="grid gap-3">
        {e.rounds.map((r, ri) => (
          <li key={ri} className="grid gap-1.5 border-l-2 border-line pl-3">
            <p className="text-meta font-semibold">
              {t('moat.form.round', { n: ri + 1 })} · {r.name || t(`placements.roundKind.${r.kind}`)}
            </p>
            {!!r.questions.length && (
              <ul className="grid gap-1 text-body">
                {r.questions.map((q, qi) => (
                  <li key={qi} className="grid gap-1">
                    <span>{q.text}</span>
                    {(reviewer || e.mine) && q.sent && (
                      <span className="text-meta text-fg-3">
                        {t(q.sent === 'bank' ? 'moat.card.sentBank' : 'moat.card.sentPractice')}
                      </span>
                    )}
                    {questionAction?.(ri, qi, r.kind)}
                  </li>
                ))}
              </ul>
            )}
            {r.notes && <p className="text-meta text-fg-2">{r.notes}</p>}
          </li>
        ))}
      </ol>
      {e.tips && (
        <div className="grid gap-1">
          <p className="text-meta font-semibold">{t('moat.card.tips')}</p>
          <p className="text-meta whitespace-pre-line text-fg-2">{e.tips}</p>
        </div>
      )}
      {actions}
    </Card>
  );
}
