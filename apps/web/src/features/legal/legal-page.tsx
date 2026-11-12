import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ScrollText } from 'lucide-react';
import { LEGAL_DOCS, type LegalDoc } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { PageHeader } from '../../components/ui/page-header';
import { ErrorState } from '../../components/ui/error-state';
import { Card, Skeleton } from '../../components/ui/misc';
import * as q from '../../lib/queries';
import { useSession } from '../../lib/session';
import { DocText } from './doc-text';

/**
 * The college's privacy policy or terms (B14), public so they can be read before signing up. The
 * text is the platform's template with the college's details, in the member's language once that
 * translation has been reviewed and published (prompt 1b, R13), else in English; the page says which,
 * and that the English version is the legal reference.
 */
export function LegalPage() {
  const { t, i18n } = useTranslation();
  const { doc = 'privacy' } = useParams();
  const which: LegalDoc = (LEGAL_DOCS as readonly string[]).includes(doc) ? (doc as LegalDoc) : 'privacy';
  const page = useQuery(q.legalDoc(which, i18n.language));
  const signedIn = useSession((s) => s.status === 'signed-in');
  return (
    <main id="main" className="gutter mx-auto grid w-full max-w-[760px] gap-5 py-8">
      <PageHeader icon={<ScrollText />} title={t(`legal.${which}`)} intro={t('legal.intro')} />
      {page.data?.translated ? (
        <p className="text-callout text-fg-2">{t('legal.translatedNote')}</p>
      ) : (
        i18n.language !== 'en' && <p className="text-callout text-fg-2">{t('legal.englishOnly')}</p>
      )}
      {page.isLoading && <Skeleton className="h-96 rounded-[var(--radius-lg)]" />}
      {page.isError && <ErrorState error={page.error} onRetry={() => void page.refetch()} />}
      {page.data && (
        <Card className="grid gap-4 p-5" lang={page.data.language}>
          {!page.data.complete && (
            <p
              className="rounded-[var(--radius-md)] bg-warning-surface p-3 text-callout text-warning-ink"
              lang={i18n.language}
            >
              {t('legal.incomplete')}
            </p>
          )}
          <DocText text={page.data.body} />
        </Card>
      )}
      <nav aria-label={t('legal.other')} className="flex flex-wrap gap-4 text-callout">
        {LEGAL_DOCS.filter((d) => d !== which).map((d) => (
          <Link
            key={d}
            to={`/legal/${d}`}
            className="inline-flex min-h-11 items-center font-semibold text-brand-ink underline underline-offset-2"
          >
            {t(`legal.${d}`)}
          </Link>
        ))}
        <Link
          to={signedIn ? '/home' : '/'}
          className="inline-flex min-h-11 items-center font-semibold text-brand-ink underline underline-offset-2"
        >
          {t('errors.goHome')}
        </Link>
      </nav>
    </main>
  );
}
