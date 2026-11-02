import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Sparkles } from 'lucide-react';
import type { RequestView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Sheet } from '../../components/ui/dialog';
import { EmptyState, Skeleton } from '../../components/ui/misc';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';
import { newIdempotencyKey } from '../../lib/format';
import { firstName } from '../../lib/names';
import { requestAlternatives } from '../../lib/queries';
import { MentorStatsLine } from '../mentors/mentor-stats';

/**
 * B5: two days without a reply. Three mentors likely to reply; one tap withdraws the waiting
 * request and sends them the same message (it does not count against the weekly limit).
 */
export function RematchSheet({
  r,
  open,
  onOpenChange,
}: {
  r: RequestView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [key] = useState(newIdempotencyKey);
  const alts = useQuery({ ...requestAlternatives(r.id), enabled: open });
  const send = useMutation({
    mutationFn: (mentorId: string) =>
      api.postOnce<RequestView>(`/mentorship/requests/${r.id}/rematch`, { mentorId }, `${key}-${mentorId}`),
    onSuccess: (next) => {
      toast.success(t('rematch.sent', { name: firstName(next.mentor.name) }));
      void qc.invalidateQueries({ queryKey: ['requests'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('rematch.title')}
      description={t('rematch.intro', { name: firstName(r.mentor.name) })}
    >
      {alts.isLoading && <Skeleton className="h-64" />}
      {alts.isError && <ErrorState error={alts.error} onRetry={() => void alts.refetch()} compact />}
      {alts.isSuccess && !alts.data.length && (
        <EmptyState art={<Illustration kind="people" />} title={t('rematch.none')}>
          {t('rematch.noneBody')}
        </EmptyState>
      )}
      {alts.isSuccess && alts.data.length > 0 && (
        <ul className="grid gap-3">
          {alts.data.map(({ mentor: m, reasons }) => (
            <li key={m.userId} className="grid gap-3 rounded-[var(--radius-md)] border border-line p-4">
              <div className="flex items-center gap-3">
                <PersonAvatar name={m.name} fileId={m.avatarFileId} size={48} verified />
                <div className="min-w-0">
                  <b className="block truncate">{m.name}</b>
                  {(m.jobTitle || m.company) && (
                    <p className="truncate text-meta text-fg-2">
                      {[m.jobTitle, m.company].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
              {m.stats && <MentorStatsLine stats={m.stats} />}
              {reasons.some((x) => x.kind === 'fast_reply') && (
                <p className="flex items-center gap-1.5 text-meta text-brand-ink">
                  <Sparkles className="size-4" aria-hidden /> {t('match.reason.fast_reply')}
                </p>
              )}
              <Button
                variant="primary"
                loading={send.isPending && send.variables === m.userId}
                disabled={send.isPending}
                onClick={() => send.mutate(m.userId)}
              >
                <Send className="size-4" aria-hidden /> {t('rematch.send', { name: firstName(m.name) })}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
