import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Sparkles, Trash2, UserRound } from 'lucide-react';
import {
  COPILOT_COMMANDS,
  COPILOT_QUESTION_MAX,
  type CopilotHandoff,
  type CopilotMessageView,
  type CopilotResult,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Textarea } from '../../components/ui/field';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { AnswerText } from '../study/chat/answer-text';
import { copilotHome, copilotSession } from './queries';
import { streamCopilot } from './stream';

/** Opening a human next step is recorded (`copilot_handoff`); the link opens either way. */
function Handoffs({ message }: { message: CopilotMessageView }) {
  const { t } = useTranslation();
  if (!message.handoffs.length) return null;
  const label = (h: CopilotHandoff) =>
    h.kind === 'ask_alumnus'
      ? h.replyHours
        ? t('copilot.handoff.ask_alumnusReply', {
            name: h.name,
            company: h.detail,
            hours: Math.round(h.replyHours),
          })
        : t('copilot.handoff.ask_alumnus', { name: h.name, company: h.detail })
      : h.kind === 'drive'
        ? t('copilot.handoff.drive', { company: h.name, date: h.at ? formatDay(h.at) : '' })
        : t('copilot.handoff.office_hours', { title: h.name, date: h.at ? formatDateTime(h.at) : '' });
  return (
    <div className="grid gap-2">
      <p className="text-callout font-semibold">{t('copilot.next')}</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {message.handoffs.map((h) => (
          <li key={h.kind}>
            <Link
              to={h.href}
              onClick={() =>
                void api
                  .post('/copilot/handoff', { messageId: message.id, kind: h.kind })
                  .catch(() => undefined)
              }
              className="flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] border border-line bg-surface-1 px-3 py-2 text-callout font-semibold text-brand-ink hover:border-line-strong"
            >
              <UserRound className="size-4 flex-none" aria-hidden />
              <span className="flex-1">{label(h)}</span>
              <ArrowRight className="size-4 flex-none" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Result({ result }: { result: CopilotResult }) {
  const { t } = useTranslation();
  switch (result.kind) {
    case 'refusal':
      return <p className="text-body">{t(`copilot.refusal.${result.reason}`)}</p>;
    case 'sources_only':
      return <p className="text-callout text-fg-2">{t('copilot.sourcesOnly')}</p>;
    case 'drives':
      return (
        <div className="grid gap-2">
          <p className="font-semibold">{t('copilot.drives')}</p>
          {!result.drives.length ? (
            <p className="text-callout text-fg-2">{t('copilot.noDrives')}</p>
          ) : (
            <ul className="grid gap-1">
              {result.drives.map((d) => (
                <li key={d.id}>
                  <Link
                    to={`/placements/${d.id}`}
                    className="inline-flex min-h-11 items-center font-semibold text-brand-ink hover:underline"
                  >
                    {d.company}: {d.title}
                  </Link>
                  <span className="text-callout text-fg-2">
                    {' '}
                    · {t('copilot.closes', { date: formatDay(d.closesAt) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    case 'link':
      return (
        <Link to={result.href} className={buttonVariants({ variant: 'secondary' })}>
          {t(`copilot.link.${result.command}`, { company: result.company ?? '' })}
        </Link>
      );
    case 'plan':
      return (
        <div className="grid gap-2">
          <p className="font-semibold">{t('copilot.plan')}</p>
          <ol className="grid gap-2 sm:grid-cols-2">
            {result.weeks.map((w) => (
              <li key={w.week}>
                <Card className="grid gap-1 p-3">
                  <p className="text-callout font-semibold">{t('copilot.week', { n: w.week })}</p>
                  <ul className="grid gap-1 text-callout">
                    {w.items.map((it, i) => (
                      <li key={i}>
                        <Link
                          to={it.href}
                          className="inline-flex min-h-11 items-center text-brand-ink hover:underline"
                        >
                          {it.kind === 'roadmap'
                            ? it.title
                              ? t('copilot.planItem.roadmap', { title: it.title })
                              : t('copilot.planItem.roadmapAny')
                            : t(`copilot.planItem.${it.kind}`)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      );
  }
}

function Answer({ m, q }: { m: CopilotMessageView; q: string }) {
  const { t } = useTranslation();
  return (
    <Card variant="raised" className="grid gap-3 p-4">
      <p className="flex items-center gap-2 text-callout font-semibold text-fg-2">
        <Sparkles className="size-4 text-brand-ink" aria-hidden /> {t('copilot.copilot')}
      </p>
      {m.status === 'streaming' && !m.text && (
        <p className="text-callout text-fg-2">{t('copilot.thinking')}</p>
      )}
      {m.status === 'failed' && <p className="text-callout text-danger-ink">{t('copilot.failed')}</p>}
      {m.result && <Result result={m.result} />}
      {m.text && <AnswerText text={m.text} citations={m.citations} q={q} />}
      {!!m.citations.length && (
        <div className="grid gap-1">
          <p className="text-callout font-semibold">{t('copilot.sources')}</p>
          <ol className="grid gap-1 text-callout">
            {m.citations.map((c) => (
              <li key={c.n} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">[{c.n}]</span>
                <Link
                  to={c.href}
                  className="inline-flex min-h-11 items-center text-brand-ink hover:underline"
                >
                  {c.title}
                </Link>
                <Badge>{t(`copilot.kind.${c.kind}`)}</Badge>
              </li>
            ))}
          </ol>
        </div>
      )}
      <Handoffs message={m} />
    </Card>
  );
}

/** The Career Copilot (prompt 2, G11): cited answers from the college's own data, then a human. */
export function CopilotPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const sessionId = params.get('c');
  const home = useQuery({ ...SCREEN, ...copilotHome() });
  const loaded = useQuery({ ...copilotSession(sessionId ?? ''), enabled: !!sessionId });
  // The conversation being written in this tab; otherwise the saved one from the URL.
  const [live, setLive] = useState<{ key: string | null; messages: CopilotMessageView[] } | null>(null);
  const messages =
    live && live.key === sessionId ? live.messages : sessionId ? (loaded.data?.messages ?? []) : [];
  const setMessages = (f: (ms: CopilotMessageView[]) => CopilotMessageView[]) =>
    setLive((l) => (l ? { ...l, messages: f(l.messages) } : l));
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const stop = useRef<AbortController | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/copilot/sessions/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['copilot'] });
      setParams({}, { replace: true });
      toast.success(t('copilot.removed'));
    },
  });

  const ask = async () => {
    const text = question.trim();
    if (text.length < 2 || busy) return;
    setBusy(true);
    setQuestion('');
    const ctrl = new AbortController();
    stop.current = ctrl;
    let current = sessionId;
    setLive({ key: sessionId, messages });
    try {
      await streamCopilot(
        { question: text, ...(current ? { sessionId: current } : {}) },
        (e) => {
          if (e.type === 'start') {
            current = e.sessionId;
            setMessages((ms) => [
              ...ms,
              e.question,
              { ...e.question, id: e.messageId, role: 'assistant', text: '', status: 'streaming' },
            ]);
          } else if (e.type === 'sources' || e.type === 'delta') {
            setMessages((ms) =>
              ms.map((m, i) =>
                i === ms.length - 1
                  ? e.type === 'delta'
                    ? { ...m, text: m.text + e.text }
                    : { ...m, citations: e.citations }
                  : m,
              ),
            );
          } else if (e.type === 'done') {
            setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? e.message : m)));
          } else if (e.type === 'error') toast.error(e.message);
        },
        ctrl.signal,
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setBusy(false);
      stop.current = null;
      void qc.invalidateQueries({ queryKey: ['copilot'], exact: true });
      if (current && current !== sessionId) {
        setLive((l) => (l ? { ...l, key: current } : l));
        setParams({ c: current }, { replace: true });
      } else if (current) void qc.invalidateQueries({ queryKey: ['copilot', 'session', current] });
    }
  };

  const lastQuestion = [...messages].reverse().find((m) => m.role === 'user')?.text ?? '';
  return (
    <div className="mx-auto grid w-full max-w-[860px] gap-5">
      <PageHeader
        icon={<Sparkles />}
        title={t('nav.copilot')}
        intro={t('copilot.intro')}
        actions={
          <Button variant="ghost" onClick={() => setParams({}, { replace: true })} disabled={busy}>
            <Plus className="size-4" aria-hidden /> {t('copilot.new')}
          </Button>
        }
      />
      {home.isLoading && <Skeleton className="h-24" />}
      {home.isError && <ErrorState error={home.error} onRetry={() => void home.refetch()} />}
      {home.data && (
        <>
          <p className="text-callout text-fg-2">
            {t('copilot.rules')}{' '}
            {home.data.ai
              ? home.data.left !== null
                ? t('copilot.left', { count: home.data.left })
                : ''
              : t('copilot.aiOff')}
          </p>
          {!!home.data.sessions.length && (
            <nav aria-label={t('copilot.history')} className="flex flex-wrap items-center gap-2">
              {home.data.sessions.slice(0, 8).map((s) => (
                <Link
                  key={s.id}
                  to={`?c=${s.id}`}
                  aria-current={s.id === sessionId ? 'page' : undefined}
                  className="inline-flex min-h-11 max-w-[16rem] items-center truncate rounded-full border border-line px-3 text-callout aria-[current=page]:border-brand aria-[current=page]:text-brand-ink"
                >
                  {s.title}
                </Link>
              ))}
              {sessionId && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('copilot.remove')}
                  onClick={() => remove.mutate(sessionId)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              )}
            </nav>
          )}
        </>
      )}
      <ol className="grid gap-3" aria-live="polite">
        {messages.map((m) =>
          m.role === 'user' ? (
            <li
              key={m.id}
              className="justify-self-end rounded-[var(--radius-lg)] bg-brand-surface px-4 py-2 text-body text-brand-ink"
            >
              <span className="sr-only">{t('copilot.you')}: </span>
              {m.text}
            </li>
          ) : (
            <li key={m.id}>
              <Answer m={m} q={lastQuestion} />
            </li>
          ),
        )}
      </ol>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('copilot.commands')}>
          {COPILOT_COMMANDS.map((c) => (
            <button
              key={c}
              type="button"
              className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-callout hover:border-line-strong"
              onClick={() => setQuestion(`/${c} `)}
            >
              {t(`copilot.command.${c}`)}
            </button>
          ))}
        </div>
        <Field label={t('copilot.question')}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={COPILOT_QUESTION_MAX}
              placeholder={t('copilot.placeholder')}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask();
                }
              }}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          {busy && (
            <Button variant="ghost" onClick={() => stop.current?.abort()}>
              {t('copilot.stop')}
            </Button>
          )}
          <Button type="submit" variant="primary" loading={busy} disabled={question.trim().length < 2}>
            {t('copilot.send')}
          </Button>
        </div>
      </form>
    </div>
  );
}
