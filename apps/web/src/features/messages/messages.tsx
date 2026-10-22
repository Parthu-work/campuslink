import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import {
  Check,
  CheckCheck,
  Clock,
  FileText,
  Lock,
  MessagesSquare,
  Paperclip,
  SendHorizontal,
} from 'lucide-react';
import { MESSAGE_MAX, type MessageView } from '@campuslink/shared';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { IntentLink } from '../../components/ui/intent-link';
import { PageHeader } from '../../components/ui/page-header';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { SafetyMenu } from '../../components/layout/safety-menu';
import { api, apiBlob, apiRequest, ApiError, saveBlob } from '../../lib/api';
import { conversation, conversations } from '../../lib/queries';
import { useFileUrl } from '../../lib/files';
import { useMe } from '../../lib/me';
import { emitTyping, useTyping } from '../../lib/realtime';
import { appendMessage } from '../../lib/use-realtime-bridge';
import { formatDay, formatRelative, formatTime, localDateKey, newIdempotencyKey } from '../../lib/format';
import { cn } from '../../lib/cn';

/** The list of conversations: the Messages screen on phones, the left pane on desktop (IA-12). */
function ConversationList({ activeId }: { activeId?: string }) {
  const { t } = useTranslation();
  const list = useQuery(conversations());
  if (list.isLoading)
    return (
      <div className="grid gap-2" aria-hidden>
        {[0, 1, 2].map((k) => (
          <Skeleton key={k} className="h-[68px] rounded-[var(--radius-lg)]" />
        ))}
      </div>
    );
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />;
  if (!list.data?.length)
    return (
      <EmptyState
        art={<Illustration kind="people" />}
        title={t('messages.empty')}
        action={
          <Link to="/mentors" className={buttonVariants({ variant: 'primary' })}>
            {t('request.findMentor')}
          </Link>
        }
      >
        {t('messages.emptyBody')}
      </EmptyState>
    );
  return (
    <ul className="grid gap-1.5">
      {list.data.map((c) => {
        const active = c.id === activeId;
        return (
          <li key={c.id}>
            <IntentLink
              to={`/messages/${c.id}`}
              aria-current={active ? 'page' : undefined}
              className="block rounded-[var(--radius-lg)]"
            >
              <Card
                variant={active ? 'flat' : 'interactive'}
                className={cn('flex items-center gap-3 p-3', active && 'border-brand bg-brand-surface')}
              >
                <PersonAvatar name={c.other.name} fileId={c.other.avatarFileId} />
                <div className="min-w-0 flex-1">
                  <b className={cn('block truncate', c.unread > 0 && 'text-fg')}>{c.other.name}</b>
                  <p className="text-caption text-fg-3">
                    {c.lastMessageAt ? formatRelative(c.lastMessageAt) : t('messages.new')}
                  </p>
                </div>
                {c.status === 'blocked' && <Badge>{t('messages.closed')}</Badge>}
                {c.unread > 0 && (
                  <span className="grid min-w-6 place-items-center rounded-full bg-brand px-1.5 text-caption leading-6 font-bold text-on-brand tabular-nums">
                    <span aria-hidden>{c.unread}</span>
                    <span className="sr-only">{t('messages.unread', { count: c.unread })}</span>
                  </span>
                )}
              </Card>
            </IntentLink>
          </li>
        );
      })}
    </ul>
  );
}

export function MessagesPage() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:items-start">
      <div className="grid content-start gap-4">
        <PageHeader title={t('nav.messages')} intro={t('messages.intro')} />
        <ConversationList />
      </div>
      {/* Desktop: the right pane waits for a conversation. */}
      <div className="hidden min-h-[60vh] place-items-center rounded-[var(--radius-xl)] border border-dashed border-line-strong lg:grid">
        <EmptyState art={<Illustration kind="empty" />} title={t('messages.pick')} />
      </div>
    </div>
  );
}

function Attachment({ m, mine }: { m: MessageView; mine: boolean }) {
  const { t } = useTranslation();
  const a = m.attachment;
  const isImage = a?.mime.startsWith('image/');
  const url = useFileUrl(isImage ? a?.fileId : null);
  if (!a) return null;
  if (isImage)
    return url ? (
      // Same box while loading and loaded, so the thread never jumps (master prompt §7b).
      <img
        src={url}
        alt={t('messages.imageFrom', { name: a.name })}
        width={224}
        height={168}
        className="h-[168px] w-56 rounded-[var(--radius-sm)] bg-surface-2 object-contain"
      />
    ) : (
      <Skeleton className="h-[168px] w-56" />
    );
  return (
    <button
      type="button"
      onClick={async () => saveBlob(await apiBlob(`/files/${a.fileId}`), a.name)}
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] border px-3 text-left text-sm',
        mine ? 'border-[color-mix(in_srgb,var(--on-brand)_35%,transparent)]' : 'border-line-strong',
      )}
    >
      <FileText className="size-5 flex-none" aria-hidden />
      <span className="truncate">{a.name}</span>
      <span className="sr-only">{t('messages.download')}</span>
    </button>
  );
}

type Page = { data: MessageView[]; meta?: { nextCursor?: string | null } };

/** "Today", "Yesterday" or the date, between days in a thread. */
function dayLabel(t: TFunction, iso: string) {
  const key = localDateKey(iso);
  if (key === localDateKey(new Date())) return t('messages.today');
  if (key === localDateKey(new Date(Date.now() - 86_400_000))) return t('messages.yesterday');
  return formatDay(iso);
}

export function ConversationPage() {
  const { conversationId = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const valid = /^[a-f0-9]{24}$/.test(conversationId);
  const conv = useQuery(conversation(conversationId));
  const msgs = useInfiniteQuery({
    queryKey: ['messages', conversationId],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<MessageView[]>(
        `/conversations/${conversationId}/messages?limit=30${pageParam ? `&before=${pageParam}` : ''}`,
      ) as Promise<Page>,
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
    enabled: valid && conv.isSuccess,
  });
  const items = [...(msgs.data?.pages ?? [])].reverse().flatMap((p) => p.data);
  const last = items.at(-1);
  const lastTheirs = [...items].reverse().find((m) => m.senderId !== me?.id);

  // Read receipts: tell the server when the newest message from the other person is on screen.
  useEffect(() => {
    if (!lastTheirs) return;
    void api.post(`/conversations/${conversationId}/read`, { messageId: lastTheirs.id }).then(() => {
      void qc.invalidateQueries({ queryKey: ['unread-messages'] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    });
  }, [lastTheirs?.id, conversationId, qc, lastTheirs]);

  // Keep the newest message in view.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last?.id]);

  // "typing…" shows for 4 s after the last typing event.
  const typingAt = useTyping((s) => s.at[conversationId] ?? 0);
  const [typingUntil, setTypingUntil] = useState(0);
  useEffect(() => {
    if (!typingAt) return;
    const show = setTimeout(() => setTypingUntil(typingAt + 4000), 0);
    const hide = setTimeout(() => setTypingUntil(0), 4000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [typingAt]);
  const typing = typingUntil > 0;

  const [draft, setDraft] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  // Optimistic: the message shows at once as "Sending…", then becomes the real one; on failure it
  // is removed and the text goes back into the box (audit ST-4, B8).
  const removePending = (id: string) =>
    qc.setQueryData<InfiniteData<Page>>(['messages', conversationId], (old) =>
      old
        ? { ...old, pages: old.pages.map((p) => ({ ...p, data: p.data.filter((m) => m.id !== id) })) }
        : old,
    );
  const send = useMutation({
    mutationFn: (body: string) =>
      api.postOnce<MessageView>(`/conversations/${conversationId}/messages`, { body }, key),
    onMutate: (body) => {
      const pendingId = `pending-${key}`;
      appendMessage(qc, {
        id: pendingId,
        conversationId,
        senderId: me?.id ?? '',
        body,
        attachment: null,
        createdAt: new Date().toISOString(),
      });
      setDraft('');
      return { pendingId, body };
    },
    onSuccess: (m, _body, ctx) => {
      removePending(ctx.pendingId);
      appendMessage(qc, m);
      setKey(newIdempotencyKey());
    },
    onError: (e, _body, ctx) => {
      if (ctx) {
        removePending(ctx.pendingId);
        setDraft((d) => d || ctx.body);
      }
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
    },
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const attach = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('body', draft.trim());
      form.append('file', file);
      return api.upload<MessageView>(`/conversations/${conversationId}/attachments`, form);
    },
    onSuccess: (m) => {
      appendMessage(qc, m);
      setDraft('');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const submit = () => {
    const body = draft.trim();
    if (body && !send.isPending) send.mutate(body);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const back = <BackLink to="/messages">{t('messages.back')}</BackLink>;
  if (conv.isLoading) return <Skeleton className="h-96" />;
  if (!conv.data)
    return (
      <>
        {back}
        <EmptyState icon={<MessagesSquare className="size-6" />} title={t('messages.notFound')} />
      </>
    );
  const c = conv.data;
  const closed = c.status !== 'open';
  const seen = !!(last && last.senderId === me?.id && c.otherReadAt && c.otherReadAt >= last.createdAt);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:items-start">
      <aside aria-label={t('nav.messages')} className="hidden content-start gap-3 lg:grid">
        <h2 className="text-title font-semibold">{t('nav.messages')}</h2>
        <ConversationList activeId={conversationId} />
      </aside>
      <div className="grid min-w-0 content-start gap-3">
        <div className="lg:hidden">{back}</div>
        <Card variant="raised" className="grid gap-0 overflow-hidden">
          <header className="flex items-center gap-3 border-b border-line p-3.5">
            <PersonAvatar name={c.other.name} fileId={c.other.avatarFileId} />
            <h1 className="min-w-0 flex-1 truncate text-title font-bold">{c.other.name}</h1>
            <SafetyMenu userId={c.other.userId} name={c.other.name} />
          </header>
          <div
            ref={scroller}
            role="log"
            aria-label={t('messages.history', { name: c.other.name })}
            aria-live="polite"
            tabIndex={0}
            className="grid max-h-[calc(100dvh-330px)] min-h-[40vh] content-start overflow-y-auto p-3.5"
          >
            {msgs.hasNextPage && (
              <Button
                size="sm"
                variant="ghost"
                className="justify-self-center"
                loading={msgs.isFetchingNextPage}
                onClick={() => void msgs.fetchNextPage()}
              >
                {t('messages.older')}
              </Button>
            )}
            {msgs.isLoading && <Skeleton className="h-24" />}
            {msgs.isSuccess && !items.length && (
              <p className="mx-auto max-w-[40ch] py-8 text-center text-meta text-fg-3">
                {t('messages.start', { name: c.other.name.split(' ')[0] })}
              </p>
            )}
            {items.map((m, i) => {
              const mine = m.senderId === me?.id;
              const prev = items[i - 1];
              const next = items[i + 1];
              const newDay = !prev || localDateKey(prev.createdAt) !== localDateKey(m.createdAt);
              // Messages from one person within five minutes read as one group: one time, tight gaps.
              const joinsNext =
                !!next &&
                next.senderId === m.senderId &&
                localDateKey(next.createdAt) === localDateKey(m.createdAt) &&
                Date.parse(next.createdAt) - Date.parse(m.createdAt) < 5 * 60_000;
              const pending = m.id.startsWith('pending-');
              const isLast = m.id === last?.id;
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <p
                      role="separator"
                      className="my-2 flex items-center gap-3 text-caption font-semibold text-fg-3"
                    >
                      <span aria-hidden className="h-px flex-1 bg-line" />
                      {dayLabel(t, m.createdAt)}
                      <span aria-hidden className="h-px flex-1 bg-line" />
                    </p>
                  )}
                  <div
                    className={cn(
                      'group flex items-end gap-1',
                      mine ? 'justify-end' : 'justify-start',
                      joinsNext ? 'mb-0.5' : 'mb-2',
                    )}
                  >
                    <div
                      className={cn(
                        'grid max-w-[78%] gap-1.5 rounded-[20px] px-3.5 py-2 text-body leading-snug',
                        mine ? 'bg-brand text-on-brand' : 'bg-surface-2',
                        !joinsNext && (mine ? 'rounded-br-md' : 'rounded-bl-md'),
                        pending && 'opacity-80',
                      )}
                    >
                      <Attachment m={m} mine={mine} />
                      {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
                      {!joinsNext && (
                        <span
                          className={cn(
                            'flex items-center justify-end gap-1 text-caption',
                            mine ? 'text-on-brand' : 'text-fg-3',
                          )}
                        >
                          {pending ? t('messages.sending') : formatTime(m.createdAt)}
                          {mine &&
                            (pending ? (
                              <Clock className="size-3.5" aria-hidden />
                            ) : isLast && seen ? (
                              <CheckCheck className="size-3.5" aria-label={t('messages.seen')} />
                            ) : (
                              <Check className="size-3.5" aria-label={t('messages.sent')} />
                            ))}
                        </span>
                      )}
                    </div>
                    {!mine && (
                      <span className="opacity-60 focus-within:opacity-100 group-hover:opacity-100">
                        <SafetyMenu
                          userId={c.other.userId}
                          name={c.other.name}
                          target={{ type: 'message', id: m.id }}
                        />
                      </span>
                    )}
                  </div>
                </Fragment>
              );
            })}
            {seen && <p className="-mt-1 justify-self-end text-caption text-fg-3">{t('messages.seen')}</p>}
            {typing && (
              <div className="flex items-end gap-2" aria-hidden>
                <span className="typing-dots flex gap-1 rounded-[20px] rounded-bl-md bg-surface-2 px-4 py-3">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            )}
          </div>
          <p aria-live="polite" className="min-h-5 px-3.5 text-caption text-fg-3">
            {typing ? t('messages.typing', { name: c.other.name.split(' ')[0] }) : ''}
          </p>
          {closed ? (
            <p className="flex items-center gap-2 border-t border-line p-3.5 text-meta text-fg-2">
              <Lock className="size-4" aria-hidden /> {t('messages.closedBody')}
            </p>
          ) : (
            <form
              className="flex items-end gap-2 border-t border-line p-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="sr-only"
                tabIndex={-1}
                aria-label={t('messages.attach')}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) attach.mutate(f);
                  e.target.value = '';
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('messages.attach')}
                loading={attach.isPending}
                onClick={() => fileInput.current?.click()}
              >
                {!attach.isPending && <Paperclip className="size-5" aria-hidden />}
              </Button>
              <label className="min-w-0 flex-1">
                <span className="sr-only">{t('messages.write')}</span>
                <textarea
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    emitTyping(conversationId);
                  }}
                  onKeyDown={onKey}
                  enterKeyHint="send"
                  rows={1}
                  maxLength={MESSAGE_MAX}
                  placeholder={t('messages.write')}
                  className="max-h-36 min-h-11 w-full resize-none rounded-[22px] border border-line-strong bg-surface-2 px-4 py-2.5 text-base transition-[border-color,background-color] focus:border-brand focus:bg-surface-1 focus:outline-none"
                />
              </label>
              <Button
                type="submit"
                variant="primary"
                size="icon"
                aria-label={t('messages.send')}
                loading={send.isPending}
                disabled={!draft.trim()}
              >
                {!send.isPending && <SendHorizontal className="size-5" aria-hidden />}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
