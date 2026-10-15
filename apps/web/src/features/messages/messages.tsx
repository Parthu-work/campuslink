import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Lock, MessagesSquare, Paperclip, SendHorizontal } from 'lucide-react';
import { MESSAGE_MAX, type ConversationView, type MessageView } from '@campuslink/shared';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PersonAvatar } from '../../components/ui/person-avatar';
import { SafetyMenu } from '../../components/layout/safety-menu';
import { api, apiBlob, apiRequest, ApiError, saveBlob } from '../../lib/api';
import { useFileUrl } from '../../lib/files';
import { useMe } from '../../lib/me';
import { emitTyping, useTyping } from '../../lib/realtime';
import { appendMessage } from '../../lib/use-realtime-bridge';
import { formatRelative, formatTime, newIdempotencyKey } from '../../lib/format';
import { cn } from '../../lib/cn';

export function MessagesPage() {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get<ConversationView[]>('/conversations'),
  });
  return (
    <>
      <h1 className="text-[clamp(26px,4vw,34px)] font-bold">{t('nav.messages')}</h1>
      <p className="-mt-3 text-sm text-fg-2">{t('messages.intro')}</p>
      {list.isLoading && <Skeleton className="h-40" />}
      {list.isSuccess && !list.data.length && (
        <EmptyState
          icon={<MessagesSquare className="size-6" />}
          title={t('messages.empty')}
          action={
            <Link to="/mentors" className={buttonVariants({ variant: 'primary' })}>
              {t('request.findMentor')}
            </Link>
          }
        >
          {t('messages.emptyBody')}
        </EmptyState>
      )}
      <ul className="grid gap-2">
        {list.data?.map((c) => (
          <li key={c.id}>
            <Link to={`/messages/${c.id}`} className="block rounded-[var(--radius-md)]">
              <Card className="flex items-center gap-3 p-3.5 transition-colors hover:border-line-strong">
                <PersonAvatar name={c.other.name} fileId={c.other.avatarFileId} />
                <div className="min-w-0 flex-1">
                  <b className="block truncate">{c.other.name}</b>
                  <p className="text-xs text-fg-3">
                    {c.lastMessageAt ? formatRelative(c.lastMessageAt) : t('messages.new')}
                  </p>
                </div>
                {c.status === 'blocked' && <Badge>{t('messages.closed')}</Badge>}
                {c.unread > 0 && (
                  <Badge tone="brand" aria-label={t('messages.unread', { count: c.unread })}>
                    {c.unread}
                  </Badge>
                )}
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
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
      <img
        src={url}
        alt={t('messages.imageFrom', { name: a.name })}
        className="max-h-64 rounded-[var(--radius-sm)] object-contain"
      />
    ) : (
      <Skeleton className="h-40 w-56" />
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

export function ConversationPage() {
  const { conversationId = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const valid = /^[a-f0-9]{24}$/.test(conversationId);
  const conv = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<ConversationView>(`/conversations/${conversationId}`),
    enabled: valid,
    retry: false,
  });
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
  const send = useMutation({
    mutationFn: (body: string) =>
      api.postOnce<MessageView>(`/conversations/${conversationId}/messages`, { body }, key),
    onSuccess: (m) => {
      appendMessage(qc, m);
      setDraft('');
      setKey(newIdempotencyKey());
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
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

  const back = (
    <Link
      to="/messages"
      className="inline-flex items-center gap-1.5 justify-self-start rounded-full px-2 py-1 text-sm font-semibold text-fg-2 hover:text-fg"
    >
      <ArrowLeft className="size-4" aria-hidden /> {t('messages.back')}
    </Link>
  );
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
    <>
      {back}
      <Card className="grid gap-0 overflow-hidden">
        <header className="flex items-center gap-3 border-b border-line p-3.5">
          <PersonAvatar name={c.other.name} fileId={c.other.avatarFileId} />
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{c.other.name}</h1>
          <SafetyMenu userId={c.other.userId} name={c.other.name} />
        </header>
        <div
          ref={scroller}
          role="log"
          aria-label={t('messages.history', { name: c.other.name })}
          aria-live="polite"
          tabIndex={0}
          className="grid max-h-[calc(100dvh-330px)] min-h-[40vh] content-start gap-2 overflow-y-auto p-3.5"
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
            <p className="py-8 text-center text-sm text-fg-3">
              {t('messages.start', { name: c.other.name.split(' ')[0] })}
            </p>
          )}
          {items.map((m) => {
            const mine = m.senderId === me?.id;
            return (
              <div
                key={m.id}
                className={cn('group flex items-end gap-1', mine ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'grid max-w-[78%] gap-1.5 rounded-[18px] px-3.5 py-2 text-[15px] leading-snug',
                    mine ? 'rounded-br-md bg-brand text-on-brand' : 'rounded-bl-md bg-surface-2',
                  )}
                >
                  <Attachment m={m} mine={mine} />
                  {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
                  <span className={cn('text-[11px]', mine ? 'text-on-brand/75' : 'text-fg-3')}>
                    {formatTime(m.createdAt)}
                  </span>
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
            );
          })}
          {seen && <p className="justify-self-end text-[11px] text-fg-3">{t('messages.seen')}</p>}
        </div>
        <p aria-live="polite" className="min-h-5 px-3.5 text-xs text-fg-3">
          {typing ? t('messages.typing', { name: c.other.name.split(' ')[0] }) : ''}
        </p>
        {closed ? (
          <p className="flex items-center gap-2 border-t border-line p-3.5 text-sm text-fg-2">
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
                rows={1}
                maxLength={MESSAGE_MAX}
                placeholder={t('messages.write')}
                className="max-h-36 min-h-11 w-full resize-none rounded-[22px] border border-line-strong bg-surface-1 px-4 py-2.5 text-base focus:border-brand focus:outline-none"
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
    </>
  );
}
