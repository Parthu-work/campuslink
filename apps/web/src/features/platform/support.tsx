import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy } from 'lucide-react';
import { SUPPORT_STATUSES, type SupportStatus, type SupportTicketView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { PageHeader } from '../../components/ui/page-header';
import { Segmented } from '../../components/ui/tab-nav';
import { Sheet } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { api, apiBlob, ApiError } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { SUPPORT_STATUS_TONE } from '../../lib/support';
import { toast } from '../../lib/toast';
import { TicketThread } from '../help/ticket-thread';

type Filter = SupportStatus | 'all';

/** Platform › Support (B14): bug reports from every college. Opening one is audited. */
export function PlatformSupport() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('open');
  const list = useQuery({ ...SCREEN, ...q.platformSupport(filter === 'all' ? '' : filter) });
  const [open, setOpen] = useState<SupportTicketView | null>(null);
  return (
    <div className="grid gap-5">
      <PageHeader icon={<LifeBuoy />} title={t('nav.platformSupport')} intro={t('help.platformIntro')} />
      <Segmented<Filter>
        label={t('help.filter')}
        value={filter}
        options={[
          ...SUPPORT_STATUSES.map((s) => [s, t(`help.status.${s}`)] as const),
          ['all', t('help.all')],
        ]}
        onChange={setFilter}
      />
      {list.isLoading && <Skeleton className="h-40 rounded-[var(--radius-lg)]" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.isSuccess && !list.data.length && (
        <EmptyState art={<Illustration kind="empty" />} title={t('help.queueEmpty')} />
      )}
      {!!list.data?.length && (
        <ul className="grid gap-2">
          {list.data.map((tk) => (
            <li key={`${tk.college?.id}-${tk.id}`}>
              <button type="button" className="block w-full text-left" onClick={() => setOpen(tk)}>
                <Card variant="interactive" className="flex items-center justify-between gap-3 p-4">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{tk.subject}</span>
                    <span className="text-callout text-fg-2">
                      {tk.college?.name} · {formatRelative(tk.updatedAt)}
                    </span>
                  </span>
                  <Badge tone={SUPPORT_STATUS_TONE[tk.status]}>{t(`help.status.${tk.status}`)}</Badge>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open?.college && (
        <PlatformTicket
          collegeId={open.college.id}
          id={open.id}
          title={open.subject}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function PlatformTicket({
  collegeId,
  id,
  title,
  onClose,
}: {
  collegeId: string;
  id: string;
  title: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['platform-ticket', collegeId, id];
  const base = `/platform/support/tickets/${collegeId}/${id}`;
  const ticket = useQuery({ queryKey: key, queryFn: () => api.get<SupportTicketView>(base) });
  const shot = useQuery({
    queryKey: [...key, 'screenshot'],
    queryFn: async () => URL.createObjectURL(await apiBlob(`${base}/screenshot`)),
    enabled: !!ticket.data?.hasScreenshot,
    staleTime: 10 * 60_000,
  });
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const reply = useMutation({
    mutationFn: (body: string) => api.post<SupportTicketView>(`${base}/replies`, { body }),
    onSuccess: (tk) => {
      qc.setQueryData(key, tk);
      void qc.invalidateQueries({ queryKey: ['platform-support'] });
    },
    onError: fail,
  });
  const status = useMutation({
    mutationFn: (s: 'open' | 'closed') => api.patch(base, { status: s }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['platform-support'] });
    },
    onError: fail,
  });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={title}>
      {ticket.isLoading && <Skeleton className="h-40 rounded-[var(--radius-lg)]" />}
      {ticket.isError && <ErrorState error={ticket.error} onRetry={() => void ticket.refetch()} />}
      {ticket.data && (
        <TicketThread
          ticket={ticket.data}
          screenshotUrl={shot.data}
          replying={reply.isPending}
          onReply={(b) => reply.mutateAsync(b)}
          onStatus={(s) => status.mutate(s)}
        />
      )}
    </Sheet>
  );
}
