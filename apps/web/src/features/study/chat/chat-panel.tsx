import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Copy, RefreshCw, Sparkles, Square, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import {
  ANSWER_MODES,
  CHAT_FEEDBACK_REASONS,
  type AnswerMode,
  type ChatCitation,
  type ChatMessageView,
  type ChatSessionDetail,
  type ChatStreamEvent,
  type SlashCommand,
} from '@campuslink/shared';
import { Button } from '../../../components/ui/button';
import { Select, Textarea } from '../../../components/ui/field';
import { Badge, Chip, Skeleton } from '../../../components/ui/misc';
import { Segmented } from '../../../components/ui/tab-nav';
import { ApiError, api } from '../../../lib/api';
import { answerPlain } from '../../../lib/answer-markdown';
import {
  commandMatches,
  explainArgs,
  isServerCommand,
  matchSubject,
  parseCommand,
  quizArgs,
  suggestionsFor,
  type AskContext,
} from '../../../lib/chat';
import { streamChat } from '../../../lib/chat-stream';
import { useCan } from '../../../lib/me';
import { aiStatus, chatSession, subjects as subjectsQuery, syllabus } from '../../../lib/queries';
import { formatDuration } from '../../../lib/study';
import { toast } from '../../../lib/toast';
import { cn } from '../../../lib/cn';
import { AnswerText } from './answer-text';
import { HelpCard, ResultCard, SourceChips, SyllabusCard } from './result-cards';

type Local =
  | { kind: 'help' }
  | { kind: 'syllabus'; subjectId: string | null }
  | { kind: 'scope'; name: string | null }
  | { kind: 'note'; text: string };
type Item =
  | { key: string; kind: 'message'; m: ChatMessageView }
  | { key: string; kind: 'local'; input: string; card: Local }
  | {
      key: string;
      kind: 'pending';
      question: string | null;
      answer: string;
      citations: ChatCitation[];
      state: 'waiting' | 'streaming' | 'stopped' | 'error';
      error?: string;
    };

const NEAR_BOTTOM = 160;

function UserBubble({ text }: { text: string }) {
  const command = /^\/[a-z]+/i.exec(text)?.[0];
  return (
    <div className="ms-auto max-w-[85%] rounded-[var(--radius-lg)] rounded-ee-[var(--radius-xs)] bg-brand-surface px-4 py-2.5 break-words whitespace-pre-wrap">
      {command ? (
        <>
          <span className="font-mono font-semibold text-brand-ink">{command}</span>
          {text.slice(command.length)}
        </>
      ) : (
        text
      )}
    </div>
  );
}

/** One assistant answer: the text, its result card, sources, and actions. */
function Answer({
  m,
  question,
  last,
  busy,
  isAdmin,
  onAsk,
  onRegenerate,
  onUpdated,
}: {
  m: ChatMessageView;
  question: string;
  last: boolean;
  busy: boolean;
  isAdmin: boolean;
  onAsk: (input: string) => void;
  onRegenerate: () => void;
  onUpdated: (m: ChatMessageView) => void;
}) {
  const { t } = useTranslation();
  const [reasons, setReasons] = useState(false);
  const rate = useMutation({
    mutationFn: (v: { rating: 'up' | 'down' | null; reason?: string | null }) =>
      api.post<ChatMessageView>(`/study/chat/messages/${m.id}/feedback`, {
        rating: v.rating,
        reason: v.reason ?? null,
      }),
    onSuccess: (v, vars) => {
      onUpdated(v);
      setReasons(vars.rating === 'down' && !vars.reason);
      if (vars.reason || vars.rating === 'up') toast.success(t('study.chat.thanks'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const written = !!m.text;
  return (
    <div className="grid max-w-full gap-3">
      {written && <AnswerText text={m.text} citations={m.citations} q={question} />}
      <ResultCard m={m} onAsk={onAsk} onUpdated={onUpdated} isAdmin={isAdmin} />
      {m.status === 'stopped' && <p className="text-caption text-fg-3">{t('study.chat.stopped')}</p>}
      {m.status === 'refused' && <p className="text-meta text-fg-2">{t('study.chat.refused')}</p>}
      {m.status === 'failed' && !m.result && <p className="text-meta text-fg-2">{t('study.chat.failed')}</p>}
      {(written || m.result?.kind === 'passages') && (
        <SourceChips citations={written ? m.citations : []} q={question} />
      )}
      <div className="flex flex-wrap items-center gap-1">
        {written && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('study.chat.copy')}
            onClick={() =>
              void navigator.clipboard
                ?.writeText(answerPlain(m.text))
                .then(() => toast.success(t('study.chat.copied')))
                .catch(() => undefined)
            }
          >
            <Copy className="size-4" aria-hidden />
          </Button>
        )}
        {last && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('study.chat.regenerate')}
            disabled={busy}
            onClick={onRegenerate}
          >
            <RefreshCw className="size-4" aria-hidden />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('study.chat.helpful')}
          aria-pressed={m.feedback === 'up'}
          className="aria-pressed:text-brand-ink"
          onClick={() => rate.mutate({ rating: m.feedback === 'up' ? null : 'up' })}
        >
          <ThumbsUp className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('study.chat.notHelpful')}
          aria-pressed={m.feedback === 'down'}
          className="aria-pressed:text-brand-ink"
          onClick={() => rate.mutate({ rating: m.feedback === 'down' ? null : 'down' })}
        >
          <ThumbsDown className="size-4" aria-hidden />
        </Button>
        {!m.grounded && written && <Badge tone="warning">{t('study.chat.ungrounded')}</Badge>}
      </div>
      {reasons && (
        <div className="grid gap-2">
          <p className="text-meta text-fg-2">{t('study.chat.whyNot')}</p>
          <div className="flex flex-wrap gap-2">
            {CHAT_FEEDBACK_REASONS.map((r) => (
              <Chip key={r} pressed={false} onClick={() => rate.mutate({ rating: 'down', reason: r })}>
                {t(`study.chat.reason.${r}`)}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The study assistant (spec §6, §10): a thread that streams answers with citation chips, slash
 * commands with a keyboard-first menu, a subject scope, an answer mode, suggestions, stop,
 * regenerate, copy and thumbs feedback. Used full screen (/study/chat) and in a sheet from subject
 * and material pages. Nothing here decides access: the API answers only from what the member reads.
 */
export function ChatPanel({
  sessionId: initialSession = null,
  subjectId: initialSubject = null,
  context: initialContext = null,
  onSession,
}: {
  sessionId?: string | null;
  subjectId?: string | null;
  context?: AskContext | null;
  /** A new conversation got its id (the page puts it in the URL). */
  onSession?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isAdmin = useCan('ai:settings');
  const status = useQuery(aiStatus());
  // Every subject the member reads (for students, the ones they take).
  const readable = useQuery(subjectsQuery('all'));
  const [sessionId, setSessionId] = useState<string | null>(initialSession);
  const detail = useQuery({ ...chatSession(sessionId ?? ''), enabled: !!sessionId });
  const [scope, setScope] = useState<string | null>(initialSubject);
  const [mode, setMode] = useState<AnswerMode>('simple');
  const [context, setContext] = useState<AskContext | null>(initialContext);
  const [input, setInput] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [announce, setAnnounce] = useState('');
  const stop = useRef<AbortController | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const pendingText = useRef('');
  const frame = useRef(0);
  const menuId = useId();
  const tree = useQuery(syllabus(scope ?? ''));
  const busy = items.some((i) => i.kind === 'pending' && (i.state === 'waiting' || i.state === 'streaming'));

  // A conversation opened from the list: show its messages once they load.
  if (sessionId && detail.data && loadedFor !== sessionId && !busy) {
    setLoadedFor(sessionId);
    setItems(detail.data.messages.map((m) => ({ key: m.id, kind: 'message', m })));
    if (detail.data.subjectId !== undefined) setScope(detail.data.subjectId);
    setMode(detail.data.mode);
  }
  useEffect(() => {
    if (initialSession !== sessionId && initialSession !== null) {
      setSessionId(initialSession);
      setLoadedFor(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the route, not our own updates
  }, [initialSession]);

  // Follow new text while the member is at the bottom; leave them be once they scroll up to read.
  const pinned = useRef(true);
  useEffect(() => {
    const el = thread.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items]);
  useEffect(() => () => stop.current?.abort(), []);

  const matches = useMemo(() => commandMatches(input), [input]);
  const menuOpen = matches.length > 0;
  const lastAnswer = [...items].reverse().find((i) => i.kind === 'message' && i.m.role === 'assistant');
  const questionOf = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      const it = items[i];
      if (it?.kind === 'message' && it.m.role === 'user') return it.m.text.replace(/^\/[a-z]+\s*/i, '');
    }
    return '';
  };

  const update = (m: ChatMessageView) => {
    setItems((xs) => xs.map((x) => (x.kind === 'message' && x.m.id === m.id ? { ...x, m } : x)));
    if (sessionId)
      qc.setQueryData<ChatSessionDetail>(['chat-session', sessionId], (d) =>
        d ? { ...d, messages: d.messages.map((x) => (x.id === m.id ? m : x)) } : d,
      );
  };

  const local = (raw: string, card: Local) =>
    setItems((xs) => [...xs, { key: `local-${Date.now()}-${xs.length}`, kind: 'local', input: raw, card }]);

  async function run(
    body: Parameters<typeof streamChat>[0],
    question: string | null,
    replacing: string | null,
  ) {
    const key = `pending-${Date.now()}`;
    setItems((xs) => [
      ...xs.filter((x) => !(x.kind === 'message' && x.m.id === replacing)),
      { key, kind: 'pending', question, answer: '', citations: [], state: 'waiting' },
    ]);
    setAnnounce(t('study.chat.answering'));
    pendingText.current = '';
    const ac = new AbortController();
    stop.current = ac;
    const patch = (fn: (p: Extract<Item, { kind: 'pending' }>) => Extract<Item, { kind: 'pending' }>) =>
      setItems((xs) => xs.map((x) => (x.key === key && x.kind === 'pending' ? fn(x) : x)));
    let sid = sessionId;
    const onEvent = (e: ChatStreamEvent) => {
      if (e.type === 'start') {
        sid = e.sessionId;
        if (!sessionId) {
          setSessionId(e.sessionId);
          setLoadedFor(e.sessionId);
          onSession?.(e.sessionId);
        }
        if (question !== null)
          setItems((xs) => {
            const at = xs.findIndex((x) => x.key === key);
            const user: Item = { key: e.question.id, kind: 'message', m: e.question };
            return at < 0 ? xs : [...xs.slice(0, at), user, ...xs.slice(at)];
          });
        patch((p) => ({ ...p, question: null }));
      } else if (e.type === 'sources') patch((p) => ({ ...p, citations: e.citations }));
      else if (e.type === 'delta' || e.type === 'replace') {
        pendingText.current = e.type === 'delta' ? pendingText.current + e.text : e.text;
        // One state update per frame keeps streaming smooth.
        if (!frame.current)
          frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            const text = pendingText.current;
            patch((p) => ({ ...p, answer: text, state: 'streaming' }));
          });
      } else if (e.type === 'done') {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        setItems((xs) =>
          xs.map((x) => (x.key === key ? { key: e.message.id, kind: 'message', m: e.message } : x)),
        );
        setAnnounce(t('study.chat.answered'));
        if (sid) void qc.invalidateQueries({ queryKey: ['chat-session', sid] });
        void qc.invalidateQueries({ queryKey: ['chat-sessions'] });
      } else if (e.type === 'error') patch((p) => ({ ...p, state: 'error', error: e.message }));
    };
    try {
      await streamChat(body, onEvent, ac.signal);
      if (ac.signal.aborted) {
        patch((p) => ({ ...p, state: 'stopped', answer: pendingText.current }));
        setAnnounce(t('study.chat.stopped'));
        if (sid) void qc.invalidateQueries({ queryKey: ['chat-session', sid] });
      }
    } catch (e) {
      patch((p) => ({
        ...p,
        state: 'error',
        error: e instanceof ApiError ? e.message : t('errors.generic'),
      }));
    } finally {
      stop.current = null;
    }
  }

  function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setInput('');
    pinned.current = true;
    const { command, arg, unknown } = parseCommand(text);
    if (unknown)
      return local(text, { kind: 'note', text: t('study.chat.unknownCommand', { name: unknown }) });
    if (command === 'help') return local(text, { kind: 'help' });
    if (command === 'syllabus') return local(text, { kind: 'syllabus', subjectId: scope });
    if (command === 'subject') {
      const s = matchSubject(readable.data ?? [], arg);
      if (s) setScope(s.id);
      else if (!arg) setScope(null);
      return local(text, { kind: 'scope', name: s ? s.name : arg ? null : '' });
    }
    if (command && !isServerCommand(command)) return;
    const quiz = command === 'quiz' ? quizArgs(arg) : null;
    const explain = command === 'explain' ? explainArgs(arg) : null;
    const question = quiz?.topic ?? explain?.topic ?? (command ? arg : text);
    void run(
      {
        sessionId: sessionId ?? undefined,
        subjectId: scope,
        question: question || text,
        mode,
        ...(command && isServerCommand(command) ? { command } : {}),
        ...(quiz?.count ? { count: quiz.count } : {}),
        ...(explain?.difficulty ? { difficulty: explain.difficulty } : {}),
        ...(context && !command
          ? {
              context: {
                materialId: context.materialId,
                page: context.page,
                startSec: context.startSec,
                text: context.text.slice(0, 1500),
              },
            }
          : {}),
      },
      text,
      null,
    );
    if (context && !command) setContext(null);
  }

  function regenerate(id: string) {
    if (!sessionId) return;
    void run({ sessionId, subjectId: scope, question: '…', mode, regenerate: id }, null, id);
  }

  const pick = (c: SlashCommand) => {
    setInput(`/${c} `);
    setActive(0);
    box.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        const c = matches[Math.min(active, matches.length - 1)];
        if (c) pick(c);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setInput((v) => `${v} `);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const scopeName = (readable.data ?? []).find((s) => s.id === scope)?.name ?? null;
  const topics = (tree.data?.units ?? []).flatMap((u) => u.topics.map((x) => x.title));
  const suggestions = suggestionsFor(topics);
  const loading = !!sessionId && detail.isLoading && loadedFor !== sessionId;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
        <Select
          size="sm"
          aria-label={t('study.chat.scope')}
          value={scope ?? ''}
          onChange={(e) => setScope(e.target.value || null)}
          className="min-w-0 flex-1 basis-48"
        >
          <option value="">{t('study.chat.allSubjects')}</option>
          {(readable.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
        </Select>
        <Segmented<AnswerMode>
          label={t('study.chat.mode')}
          value={mode}
          onChange={setMode}
          options={ANSWER_MODES.map((m) => [m, t(`study.chat.modes.${m}`)] as const)}
        />
      </div>

      <div
        ref={thread}
        role="log"
        aria-label={t('study.chat.thread')}
        aria-busy={busy}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
        }}
        className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto overscroll-contain py-4"
      >
        {loading ? (
          <Skeleton className="h-40" />
        ) : items.length === 0 ? (
          <div className="grid gap-4 py-4">
            <p className="flex items-center gap-2 text-title font-semibold">
              <Sparkles className="size-5 text-brand-ink" aria-hidden /> {t('study.chat.hello')}
            </p>
            <p className="text-fg-2">
              {scopeName ? t('study.chat.introSubject', { name: scopeName }) : t('study.chat.intro')}
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.length
                ? suggestions.map((s) => {
                    const q =
                      s.kind === 'explain'
                        ? t('study.chat.explainTopic', { topic: s.topic })
                        : `/${s.kind} ${s.topic}`;
                    return (
                      <Chip key={q} pressed={false} onClick={() => send(q)}>
                        {q}
                      </Chip>
                    );
                  })
                : (['/help', '/videos ', '/notes '] as const).map((q) => (
                    <Chip key={q} pressed={false} onClick={() => (q === '/help' ? send(q) : setInput(q))}>
                      {q.trim()}
                    </Chip>
                  ))}
            </div>
          </div>
        ) : (
          items.map((it, index) => {
            if (it.kind === 'message')
              return it.m.role === 'user' ? (
                <UserBubble key={it.key} text={it.m.text} />
              ) : (
                <Answer
                  key={it.key}
                  m={it.m}
                  question={questionOf(index)}
                  last={it === lastAnswer && !it.m.command}
                  busy={busy}
                  isAdmin={isAdmin}
                  onAsk={send}
                  onRegenerate={() => regenerate(it.m.id)}
                  onUpdated={update}
                />
              );
            if (it.kind === 'local')
              return (
                <div key={it.key} className="grid gap-3">
                  <UserBubble text={it.input} />
                  <div className="grid gap-2">
                    {it.card.kind === 'help' && <HelpCard onPick={(v) => setInput(v)} />}
                    {it.card.kind === 'syllabus' &&
                      (it.card.subjectId ? (
                        <SyllabusCard tree={tree.data ?? null} onAsk={send} />
                      ) : (
                        <p>{t('study.chat.chooseSubject')}</p>
                      ))}
                    {it.card.kind === 'scope' && (
                      <p>
                        {it.card.name === null
                          ? t('study.chat.noSuchSubject')
                          : it.card.name
                            ? t('study.chat.nowSubject', { name: it.card.name })
                            : t('study.chat.nowAll')}
                      </p>
                    )}
                    {it.card.kind === 'note' && <p>{it.card.text}</p>}
                  </div>
                </div>
              );
            return (
              <div key={it.key} className="grid gap-3">
                {it.question !== null && <UserBubble text={it.question} />}
                {it.state === 'waiting' && (
                  <div className="flex items-center gap-1.5 py-2" aria-hidden>
                    {[0, 1, 2].map((d) => (
                      <span
                        key={d}
                        className="size-2 rounded-full bg-fg-3 motion-safe:animate-pulse"
                        style={{ animationDelay: `${d * 160}ms` }}
                      />
                    ))}
                  </div>
                )}
                {it.answer && <AnswerText text={it.answer} citations={it.citations} q={it.question ?? ''} />}
                {it.state === 'stopped' && (
                  <p className="text-caption text-fg-3">{t('study.chat.stopped')}</p>
                )}
                {it.state === 'error' && (
                  <p className="rounded-[var(--radius-md)] bg-danger-surface p-3 text-meta" role="alert">
                    {it.error}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <div className="grid gap-2 border-t border-line pt-3">
        {context && (
          <span className="flex w-fit max-w-full items-center gap-2 rounded-full bg-brand-surface py-1 ps-3 pe-1 text-caption">
            <span className="truncate">
              {t('study.chat.about', {
                title: context.title,
                where:
                  context.startSec !== null
                    ? formatDuration(context.startSec)
                    : context.page
                      ? t('study.pageN', { n: context.page })
                      : '',
              })}
            </span>
            <button
              type="button"
              onClick={() => setContext(null)}
              className="grid size-8 place-items-center rounded-full hover:bg-hover"
              aria-label={t('study.chat.removeContext')}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        )}
        <div className="relative">
          {menuOpen && (
            <ul
              id={menuId}
              role="listbox"
              aria-label={t('study.chat.commands')}
              className="absolute inset-x-0 bottom-full z-10 mb-2 grid max-h-72 gap-0.5 overflow-y-auto rounded-[var(--radius-lg)] border border-line bg-surface-1 p-1 shadow-elev-3"
            >
              {matches.map((c, i) => (
                <li
                  key={c}
                  id={`${menuId}-${c}`}
                  role="option"
                  aria-selected={i === Math.min(active, matches.length - 1)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(c);
                  }}
                  className="grid cursor-pointer gap-0.5 rounded-[var(--radius-sm)] px-3 py-2 aria-selected:bg-brand-surface"
                >
                  <span className="font-mono text-meta font-semibold text-brand-ink">/{c}</span>
                  <span className="text-caption text-fg-2">{t(`study.chat.cmd.${c}`)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              ref={box}
              rows={1}
              value={input}
              maxLength={2000}
              onChange={(e) => {
                setInput(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              placeholder={t('study.chat.placeholder')}
              aria-label={t('study.chat.ask')}
              role="combobox"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={
                menuOpen ? `${menuId}-${matches[Math.min(active, matches.length - 1)] ?? ''}` : undefined
              }
              className={cn('max-h-40 min-h-12 resize-none py-3 text-base')}
            />
            {busy ? (
              <Button
                variant="outline"
                size="icon"
                aria-label={t('study.chat.stop')}
                onClick={() => stop.current?.abort()}
              >
                <Square className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button
                variant="primary"
                size="icon"
                aria-label={t('study.chat.send')}
                disabled={!input.trim()}
                onClick={() => send(input)}
              >
                <ArrowUp className="size-5" aria-hidden />
              </Button>
            )}
          </div>
        </div>
        <p className="text-caption text-fg-3">
          {status.data?.answers ? t('study.chat.disclaimer') : t('study.chat.passagesOnly')}
        </p>
      </div>
    </div>
  );
}
