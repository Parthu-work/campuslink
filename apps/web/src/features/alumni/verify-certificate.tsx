import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, ShieldX } from 'lucide-react';
import type { VerifiedCertificateView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { ErrorState } from '../../components/ui/error-state';
import { Card, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { api } from '../../lib/api';
import { formatDay } from '../../lib/format';

/** The public check of a certificate of mentorship (prompt 2, G6): no sign-in, by its code. */
export function VerifyCertificatePage() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  // Not a screen read: an unknown code shows its own message, not the route's error page.
  const r = useQuery({
    queryKey: ['verify-certificate', code],
    queryFn: ({ signal }) => api.get<VerifiedCertificateView>(`/verify/certificates/${code}`, signal),
    retry: false,
  });
  const c = r.data;
  return (
    <main className="mx-auto grid w-full max-w-[640px] gap-6 px-4 py-10">
      <PageHeader title={t('verifyCert.title')} intro={t('verifyCert.intro')} />
      {r.isLoading && <Skeleton className="h-48" />}
      {r.isError && <ErrorState error={r.error} title={t('verifyCert.notFound')} />}
      {c && (
        <Card className="grid gap-3 p-5">
          <p
            className={
              c.valid
                ? 'flex items-center gap-2 font-semibold text-success-ink'
                : 'flex items-center gap-2 font-semibold text-danger-ink'
            }
          >
            {c.valid ? (
              <BadgeCheck className="size-5" aria-hidden />
            ) : (
              <ShieldX className="size-5" aria-hidden />
            )}
            {c.valid ? t('verifyCert.valid') : t('verifyCert.revoked')}
          </p>
          <p className="text-headline font-bold">{c.name}</p>
          <p className="text-fg-2">{t('verifyCert.what', { college: c.college, year: c.academicYear })}</p>
          <p className="text-meta">
            {t('verifyCert.counts', {
              sessions: c.sessions,
              mentees: c.mentees,
              asks: c.asks,
              events: c.events,
            })}
          </p>
          <p className="text-caption text-fg-3">{t('verifyCert.issued', { date: formatDay(c.issuedAt) })}</p>
        </Card>
      )}
    </main>
  );
}
