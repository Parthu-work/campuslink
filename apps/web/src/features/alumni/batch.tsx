import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Share2, Users } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { BackLink } from '../../components/ui/back-link';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { IntentLink } from '../../components/ui/intent-link';
import { Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { formatDateTime } from '../../lib/format';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

/** A batch page (prompt 2, G6): "Class of 2018, CSE". */
export function BatchPage() {
  const { t } = useTranslation();
  const { gradYear = '', branch = '' } = useParams();
  const b = useQuery({ ...SCREEN, ...q.batch(gradYear, branch) });
  const invite = async () => {
    const url = `${window.location.origin}/sign-up`;
    const text = t('batch.inviteText', { year: gradYear, branch });
    try {
      if (navigator.share) await navigator.share({ text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast.success(t('batch.copied'));
      }
    } catch {
      /* the member closed the share sheet */
    }
  };
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-6">
      <BackLink to="/alumni">{t('nav.alumni')}</BackLink>
      <PageHeader
        icon={<Users />}
        title={t('batch.title', { year: gradYear, branch })}
        intro={t('batch.intro')}
      />
      {b.isLoading && <Skeleton className="h-64" />}
      {b.isError && <ErrorState error={b.error} onRetry={() => void b.refetch()} />}
      {b.data && (
        <>
          <StatGrid>
            <StatCard label={t('batch.here')} value={b.data.total} />
            <StatCard label={t('batch.notJoined')} value={b.data.notJoined} />
          </StatGrid>
          {b.data.notJoined !== 0 && (
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <p className="min-w-0 flex-1 text-fg-2">{t('batch.findBody')}</p>
              <Button onClick={() => void invite()}>
                <Share2 className="size-4" aria-hidden /> {t('batch.find')}
              </Button>
            </Card>
          )}
          <section aria-labelledby="batch-work" className="grid gap-3">
            <h2 id="batch-work" className="text-title font-semibold">
              {t('batch.work')}
            </h2>
            {b.data.companies.length ? (
              <ul className="flex flex-wrap gap-2">
                {b.data.companies.map((c) => (
                  <li key={c.company}>
                    <Card className="px-3 py-2 text-meta">
                      <b>{c.company}</b> · {c.count}
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-meta text-fg-2">{t('batch.workFew')}</p>
            )}
          </section>
          {b.data.reunions.length > 0 && (
            <section aria-labelledby="batch-reunions" className="grid gap-3">
              <h2 id="batch-reunions" className="text-title font-semibold">
                {t('batch.reunions')}
              </h2>
              <ul className="grid gap-2">
                {b.data.reunions.map((r) => (
                  <li key={r.id}>
                    <IntentLink to={`/events/${r.id}`} className="block rounded-[var(--radius-lg)]">
                      <Card variant="interactive" className="flex items-center gap-3 p-4">
                        <CalendarDays className="size-5 text-brand-ink" aria-hidden />
                        <span className="font-semibold">{r.title}</span>
                        <span className="ml-auto text-meta text-fg-2">{formatDateTime(r.startsAt)}</span>
                      </Card>
                    </IntentLink>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="batch-people" className="grid gap-3">
            <h2 id="batch-people" className="text-title font-semibold">
              {t('batch.people')}
            </h2>
            {b.data.members.length ? (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {b.data.members.map((m) => (
                  <li key={m.userId}>
                    <IntentLink
                      to={`/people/${m.userId}`}
                      className="block h-full rounded-[var(--radius-lg)]"
                    >
                      <Card variant="interactive" className="flex h-full items-center gap-3 p-4">
                        <PersonAvatar name={m.name} fileId={m.avatarFileId} size={48} />
                        <span className="min-w-0">
                          <b className="block truncate">{m.name}</b>
                          <span className="block truncate text-meta text-fg-2">
                            {[m.jobTitle, m.company].filter(Boolean).join(' · ') || m.headline}
                          </span>
                        </span>
                      </Card>
                    </IntentLink>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState art={<Illustration kind="people" />} title={t('batch.empty')} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
