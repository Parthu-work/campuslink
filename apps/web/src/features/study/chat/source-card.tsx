import type { ChatCitation, CopilotCitation } from '@campuslink/shared';
import { useTranslation } from '../../../i18n/react';
import { buttonVariants } from '../../../components/ui/button-variants';
import { Sheet } from '../../../components/ui/dialog';
import { IntentLink } from '../../../components/ui/intent-link';
import { citationHref } from '../../../lib/chat';

export type Cited = ChatCitation | CopilotCitation;

/**
 * A numbered source, opened from its marker in an answer (prompt 3, U8): what it is, where it is
 * from, the passage the answer used, and a way to open it. The answer's text stays where it was.
 */
export function SourceCard({
  cited: c,
  q,
  origin,
  onClose,
}: {
  cited: Cited | null;
  q: string;
  origin: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={!!c}
      onOpenChange={(o) => !o && onClose()}
      title={c ? t('ask.source.title', { n: c.n }) : ''}
      history={false}
    >
      {c && (
        <div className="grid gap-3">
          <div className="grid gap-0.5">
            <p className="text-headline font-semibold text-pretty break-words">{c.title}</p>
            {origin && <p className="text-callout text-fg-2">{origin}</p>}
          </div>
          {c.snippet && (
            <blockquote className="border-l-2 border-line-strong pl-3 text-body text-pretty break-words text-fg-2">
              {c.snippet}
            </blockquote>
          )}
          <IntentLink
            to={'kind' in c ? c.href : citationHref(c, q)}
            onClick={onClose}
            className={buttonVariants({ variant: 'secondary', className: 'w-fit' })}
          >
            {t('ask.source.open')}
          </IntentLink>
        </div>
      )}
    </Sheet>
  );
}
