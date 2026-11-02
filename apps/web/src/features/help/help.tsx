import { lazy, Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { BookOpenText, LifeBuoy, MessageSquarePlus } from 'lucide-react';
import { HELP_ARTICLES, toLocale, type SupportTicketView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { PageHeader } from '../../components/ui/page-header';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { useFileUrl } from '../../lib/files';
import { formatRelative } from '../../lib/format';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { isHelpArticle, loadHelpArticle, SUPPORT_STATUS_TONE } from '../../lib/support';
import { toast } from '../../lib/toast';
import { DocText } from '../legal/doc-text';
import { TicketThread } from './ticket-thread';

const ReportProblemDialog = lazy(() =>
  import('./report-dialog').then((m) => ({ default: m.ReportProblemDialog })),
);

/** Help centre (B14): short guides, "Report a problem", and the member's own reports. */
export function HelpPage() {
  const { t } = useTranslation();
  const [reporting, setReporting] = useState(false);
  const mine = useQuery(q.supportTickets());
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-6">
      <PageHeader icon={<LifeBuoy />} title={t('help.title')} intro={t('help.intro')} />
      <section aria-labelledby="help-guides" className="grid gap-3">
        <h2 id="help-guides" className="text-title font-semibold">
          {t('help.guides')}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {HELP_ARTICLES.map((id) => (
            <li key={id}>
              <IntentLink to={`/help/articles/${id}`} className="block h-full rounded-[var(--radius-lg)]">
                <Card variant="interactive" className="grid h-full gap-1 p-4">
                  <span className="flex items-center gap-2 font-semibold">
                    <BookOpenText className="size-4 text-brand-ink" aria-hidden />
                    {t(`help.article.${id}.title`)}
                  </span>
                  <span className="text-meta text-fg-2">{t(`help.article.${id}.summary`)}</span>
                </Card>
              </IntentLink>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="help-reports" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-1">
            <h2 id="help-reports" className="text-title font-semibold">
              {t('help.reports')}
            </h2>
            <p className="max-w-[60ch] text-meta text-fg-2">{t('help.reportsIntro')}</p>
          </div>
          <Button variant="primary" onClick={() => setReporting(true)}>
            <MessageSquarePlus className="size-4" aria-hidden /> {t('help.report')}
          </Button>
        </div>
        {mine.isLoading && <Skeleton className="h-24 rounded-[var(--radius-lg)]" />}
        {mine.isError && <ErrorState error={mine.error} onRetry={() => void mine.refetch()} />}
        {mine.isSuccess && !mine.data.length && <p className="text-meta text-fg-3">{t('help.noReports')}</p>}
        {!!mine.data?.length && (
          <ul className="grid gap-2">
            {mine.data.map((tk) => (
              <li key={tk.id}>
                <IntentLink to={`/help/reports/${tk.id}`} className="block rounded-[var(--radius-lg)]">
                  <Card variant="interactive" className="flex items-center justify-between gap-3 p-4">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{tk.subject}</span>
                      <span className="text-meta text-fg-2">
                        {t(`help.category.${tk.category}`)} · {formatRelative(tk.updatedAt)}
                      </span>
                    </span>
                    <Badge tone={SUPPORT_STATUS_TONE[tk.status]}>{t(`help.status.${tk.status}`)}</Badge>
                  </Card>
                </IntentLink>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="flex flex-wrap gap-4 text-meta">
        <Link
          to="/legal/privacy"
          className="inline-flex min-h-11 items-center font-semibold text-brand-ink underline underline-offset-2"
        >
          {t('legal.privacy')}
        </Link>
        <Link
          to="/legal/terms"
          className="inline-flex min-h-11 items-center font-semibold text-brand-ink underline underline-offset-2"
        >
          {t('legal.terms')}
        </Link>
      </p>
      {reporting && (
        <Suspense fallback={null}>
          <ReportProblemDialog onClose={() => setReporting(false)} />
        </Suspense>
      )}
    </div>
  );
}

/** One help article, in the member's language. */
export function HelpArticlePage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const known = isHelpArticle(id);
  const lang = toLocale(i18n.language);
  const article = useQuery({
    ...SCREEN,
    queryKey: ['help-article', id, lang],
    queryFn: () => (known ? loadHelpArticle(id, lang) : Promise.resolve('')),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-5">
      <BackLink to="/help">{t('help.title')}</BackLink>
      {known ? (
        <>
          <PageHeader icon={<BookOpenText />} title={t(`help.article.${id}.title`)} />
          {article.isLoading && <Skeleton className="h-64 rounded-[var(--radius-lg)]" />}
          {article.data && (
            <Card className="p-5">
              <DocText text={article.data} />
            </Card>
          )}
        </>
      ) : (
        <EmptyState icon={<BookOpenText className="size-6" />} title={t('errors.notFound')} />
      )}
    </div>
  );
}

/** One of my problem reports, with its replies. */
export function ReportPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const ticket = useQuery({ ...SCREEN, ...q.supportTicket(id) });
  const shot = useFileUrl(ticket.data?.screenshotFileId);
  const update = (tk: SupportTicketView) => {
    qc.setQueryData(['support-ticket', id], tk);
    void qc.invalidateQueries({ queryKey: ['support-tickets'] });
  };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const reply = useMutation({
    mutationFn: (body: string) => api.post<SupportTicketView>(`/support/tickets/${id}/replies`, { body }),
    onSuccess: update,
    onError: fail,
  });
  const status = useMutation({
    mutationFn: (s: 'open' | 'closed') =>
      api.patch<SupportTicketView>(`/support/tickets/${id}`, { status: s }),
    onSuccess: update,
    onError: fail,
  });
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-5">
      <BackLink to="/help">{t('help.title')}</BackLink>
      {ticket.data && (
        <>
          <PageHeader icon={<LifeBuoy />} title={ticket.data.subject} />
          <TicketThread
            ticket={ticket.data}
            screenshotUrl={shot}
            replying={reply.isPending}
            onReply={(b) => reply.mutateAsync(b)}
            onStatus={(s) => status.mutate(s)}
          />
        </>
      )}
    </div>
  );
}
