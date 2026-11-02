import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { SUPPORT_STATUSES, type SupportStatus, type SupportTicketView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Segmented } from '../../components/ui/tab-nav';
import { Sheet } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { useFileUrl } from '../../lib/files';
import { formatRelative } from '../../lib/format';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { SUPPORT_STATUS_TONE } from '../../lib/support';
import { toast } from '../../lib/toast';
import { TicketThread } from '../help/ticket-thread';

type Filter = SupportStatus | 'all';

/** Admin › Support (B14): problem reports members sent to the college; bugs go to the platform. */
export function SupportAdmin() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const filter: Filter =
    raw === 'all'
      ? 'all'
      : (SUPPORT_STATUSES as readonly string[]).includes(raw ?? '')
        ? (raw as SupportStatus)
        : 'open';
  const list = useQuery({ ...SCREEN, ...q.adminSupport(filter === 'all' ? '' : filter) });
  const openId = params.get('report');
  const setParam = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v === null) n.delete(k);
        else n.set(k, v);
        return n;
      },
      { replace: k === 'status' },
    );
  return (
    <div className="grid gap-5">
      <p className="text-meta text-fg-2">{t('help.adminIntro')}</p>
      <Segmented<Filter>
        label={t('help.filter')}
        value={filter}
        options={[
          ...SUPPORT_STATUSES.map((s) => [s, t(`help.status.${s}`)] as const),
          ['all', t('help.all')],
        ]}
        onChange={(v) => setParam('status', v)}
      />
      {list.isLoading && <Skeleton className="h-40 rounded-[var(--radius-lg)]" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.isSuccess && !list.data.length && (
        <EmptyState art={<Illustration kind="empty" />} title={t('help.queueEmpty')} />
      )}
      {!!list.data?.length && (
        <ul className="grid gap-2">
          {list.data.map((tk) => (
            <li key={tk.id}>
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => setParam('report', tk.id)}
              >
                <Card variant="interactive" className="flex items-center justify-between gap-3 p-4">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{tk.subject}</span>
                    <span className="text-meta text-fg-2">
                      {tk.reporter?.name ?? t('placements.admin.formerMember')} ·{' '}
                      {t(`help.category.${tk.category}`)} · {formatRelative(tk.updatedAt)}
                    </span>
                  </span>
                  <Badge tone={SUPPORT_STATUS_TONE[tk.status]}>{t(`help.status.${tk.status}`)}</Badge>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openId && <AdminTicket id={openId} onClose={() => setParam('report', null)} />}
    </div>
  );
}

function AdminTicket({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ticket = useQuery(q.supportTicket(id));
  const shot = useFileUrl(ticket.data?.screenshotFileId);
  const done = (tk: SupportTicketView) => {
    qc.setQueryData(['support-ticket', id], tk);
    void qc.invalidateQueries({ queryKey: ['admin-support'] });
  };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const reply = useMutation({
    mutationFn: (body: string) => api.post<SupportTicketView>(`/support/tickets/${id}/replies`, { body }),
    onSuccess: done,
    onError: fail,
  });
  const status = useMutation({
    mutationFn: (s: 'open' | 'closed') =>
      api.patch<SupportTicketView>(`/support/tickets/${id}`, { status: s }),
    onSuccess: done,
    onError: fail,
  });
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={ticket.data?.subject ?? t('help.report')}
      history={false}
    >
      {ticket.isLoading && <Skeleton className="h-40 rounded-[var(--radius-lg)]" />}
      {ticket.isError && <ErrorState error={ticket.error} onRetry={() => void ticket.refetch()} />}
      {ticket.data && (
        <TicketThread
          ticket={ticket.data}
          screenshotUrl={shot}
          replying={reply.isPending}
          onReply={(b) => reply.mutateAsync(b)}
          onStatus={(s) => status.mutate(s)}
        />
      )}
    </Sheet>
  );
}
