import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from '../../../i18n/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, MessageSquarePlus, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Dialog, Sheet } from '../../../components/ui/dialog';
import { IntentLink } from '../../../components/ui/intent-link';
import { Skeleton } from '../../../components/ui/misc';
import { PageHeader } from '../../../components/ui/page-header';
import { api, ApiError } from '../../../lib/api';
import { formatRelative } from '../../../lib/format';
import { chatSessions } from '../../../lib/queries';
import { toast } from '../../../lib/toast';
import { useUrlOverlay } from '../../../lib/use-url-overlay';
import { cn } from '../../../lib/cn';
import { ChatPanel } from './chat-panel';

/** My conversations, newest first; each opens, and each (or all) can be deleted. */
function SessionList({
  current,
  onOpen,
  replace = false,
}: {
  current: string | null;
  onOpen: () => void;
  replace?: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery(chatSessions());
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string | null) => api.delete(id ? `/study/chat/sessions/${id}` : '/study/chat/sessions'),
    onSuccess: (_v, id) => {
      void qc.invalidateQueries({ queryKey: ['chat-sessions'] });
      if (!id || id === current) void navigate('/study/chat', { replace: true });
      setConfirm(false);
      toast.success(id ? t('study.chat.deleted') : t('study.chat.cleared'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  if (q.isLoading) return <Skeleton className="h-40" />;
  const rows = q.data ?? [];
  return (
    <div className="grid content-start gap-2">
      {rows.length === 0 ? (
        <p className="text-meta text-fg-3">{t('study.chat.noHistory')}</p>
      ) : (
        <ul className="grid gap-1">
          {rows.map((s) => (
            <li key={s.id} className="group flex items-center gap-1">
              <IntentLink
                to={`/study/chat/${s.id}`}
                replace={replace}
                onClick={onOpen}
                aria-current={s.id === current ? 'page' : undefined}
                className={cn(
                  'grid min-w-0 flex-1 gap-0.5 rounded-[var(--radius-md)] px-3 py-2 hover:bg-hover',
                  'aria-[current=page]:bg-brand-surface',
                )}
              >
                <span className="truncate text-meta font-semibold">{s.title}</span>
                <span className="text-caption text-fg-3">{formatRelative(s.lastMessageAt)}</span>
              </IntentLink>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('study.chat.deleteOne', { title: s.title })}
                loading={remove.isPending && remove.variables === s.id}
                onClick={() => remove.mutate(s.id)}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <Button variant="ghost" size="sm" className="w-fit text-danger-ink" onClick={() => setConfirm(true)}>
          {t('study.chat.clearAll')}
        </Button>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('study.chat.clearTitle')}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(null)}>
              {t('study.chat.clearYes')}
            </Button>
          </div>
        }
      >
        <p className="text-fg-2">{t('study.chat.clearBody')}</p>
      </Dialog>
    </div>
  );
}

/**
 * The study assistant, full screen (`/study/chat`, `/study/chat/:sessionId`): the conversation
 * list beside the thread from 1024px, in a sheet on phones. `?subject=` starts scoped to a subject.
 */
export function ChatPage() {
  const { t } = useTranslation();
  const { sessionId = null } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const history = useUrlOverlay('history');
  // A fresh panel for "New chat" and for another conversation, never for our own new id.
  const [panel, setPanel] = useState(0);
  const fresh = () => setPanel((n) => n + 1);
  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="hidden content-start gap-3 lg:grid" aria-label={t('study.chat.history')}>
        <h2 className="eyebrow">{t('study.chat.history')}</h2>
        <SessionList current={sessionId} onOpen={fresh} />
      </aside>
      <section className="grid min-w-0 content-start gap-3">
        <PageHeader
          title={t('study.chat.title')}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="lg:hidden" onClick={() => history.open('1')}>
                <History className="size-4" aria-hidden /> {t('study.chat.history')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  fresh();
                  void navigate('/study/chat');
                }}
              >
                <MessageSquarePlus className="size-4" aria-hidden /> {t('study.chat.newChat')}
              </Button>
            </div>
          }
        />
        <div className="flex h-[calc(100dvh-15rem)] min-h-[26rem] flex-col lg:h-[calc(100dvh-11rem)]">
          <ChatPanel
            key={panel}
            sessionId={sessionId}
            subjectId={params.get('subject')}
            onSession={(id) => void navigate(`/study/chat/${id}`, { replace: true })}
          />
        </div>
      </section>
      <Sheet
        open={history.value === '1'}
        onOpenChange={(o) => !o && history.close()}
        title={t('study.chat.history')}
        history={false}
      >
        {/* Opening a conversation replaces the sheet's history entry, so Back does not reopen it. */}
        <SessionList current={sessionId} onOpen={fresh} replace />
      </Sheet>
    </div>
  );
}
