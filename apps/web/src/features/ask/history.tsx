import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Skeleton } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { formatRelative, newIdempotencyKey } from '../../lib/format';
import { chatSessions } from '../../lib/queries';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';
import { copilotHome } from '../copilot/queries';
import { careerSaid, studySaid } from './said';

export type AskScope = 'study' | 'career';
interface Row {
  scope: AskScope;
  id: string;
  title: string;
  at: string;
}

/**
 * One list of the member's conversations, study and career together, newest first (prompt 3, U8).
 * Each opens in its own scope; each, or all, can be deleted. The two kinds stay on their own
 * servers (X8): only the list is shared.
 */
export function AskHistory({
  scopes,
  current,
  replace = false,
}: {
  scopes: readonly AskScope[];
  current: string | null;
  replace?: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const study = useQuery({ ...chatSessions(), enabled: scopes.includes('study') });
  const career = useQuery({ ...copilotHome(), enabled: scopes.includes('career') });
  const [confirm, setConfirm] = useState(false);
  // A conversation is titled by its first question: a command there reads as words too.
  const rows: Row[] = [
    ...(study.data ?? []).map((s) => ({
      scope: 'study' as const,
      id: s.id,
      title: studySaid(t, s.title),
      at: s.lastMessageAt,
    })),
    ...(career.data?.sessions ?? []).map((s) => ({
      scope: 'career' as const,
      id: s.id,
      title: careerSaid(t, s.title),
      at: s.lastMessageAt,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['chat-sessions'] });
    void qc.invalidateQueries({ queryKey: ['copilot'] });
  };
  const remove = useMutation({
    mutationFn: (r: Row) =>
      api.delete(r.scope === 'study' ? `/study/chat/sessions/${r.id}` : `/copilot/sessions/${r.id}`),
    onSuccess: (_v, r) => {
      refresh();
      if (r.id === current)
        void navigate(`/ask?scope=${r.scope}`, { replace: true, state: { fresh: newIdempotencyKey() } });
      toast.success(t('ask.deleted'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const clear = useMutation({
    mutationFn: async () => {
      if (scopes.includes('study')) await api.delete('/study/chat/sessions');
      for (const r of rows.filter((x) => x.scope === 'career')) await api.delete(`/copilot/sessions/${r.id}`);
    },
    onSuccess: () => {
      refresh();
      setConfirm(false);
      void navigate('/ask', { replace: true, state: { fresh: newIdempotencyKey() } });
      toast.success(t('ask.cleared'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  if (study.isLoading || career.isLoading) return <Skeleton className="h-40" />;
  return (
    <div className="grid content-start gap-2">
      {rows.length === 0 ? (
        <p className="text-callout text-fg-3">{t('ask.noHistory')}</p>
      ) : (
        <ul className="grid gap-1">
          {rows.map((r) => (
            <li key={`${r.scope}-${r.id}`} className="flex items-center gap-1">
              <IntentLink
                to={`/ask?scope=${r.scope}&s=${r.id}`}
                replace={replace}
                // A new panel for this conversation, with the address (see AskPage).
                state={{ fresh: `${r.scope}-${r.id}` }}
                aria-current={r.id === current ? 'page' : undefined}
                className={cn(
                  'grid min-w-0 flex-1 gap-1 rounded-[var(--radius-md)] px-3 py-2 hover:bg-hover',
                  'aria-[current=page]:bg-brand-surface',
                )}
              >
                <span className="text-callout font-semibold text-pretty break-words">{r.title}</span>
                <span className="flex flex-wrap items-center gap-2 text-caption text-fg-3">
                  {scopes.length > 1 && <Badge>{t(`ask.kind.${r.scope}`)}</Badge>}
                  {formatRelative(r.at)}
                </span>
              </IntentLink>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('ask.deleteOne', { title: r.title })}
                loading={remove.isPending && remove.variables?.id === r.id}
                onClick={() => remove.mutate(r)}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <Button variant="ghost" size="sm" className="w-fit text-danger-ink" onClick={() => setConfirm(true)}>
          {t('ask.clearAll')}
        </Button>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('ask.clearTitle')}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={clear.isPending} onClick={() => clear.mutate()}>
              {t('ask.clearYes')}
            </Button>
          </div>
        }
      >
        <p className="text-fg-2">{t('ask.clearBody')}</p>
      </Dialog>
    </div>
  );
}
