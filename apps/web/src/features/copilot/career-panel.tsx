import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUp, Sparkles, Square, UserRound } from 'lucide-react';
import {
  COPILOT_QUESTION_MAX,
  type CopilotHandoff,
  type CopilotMessageView,
  type CopilotResult,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Textarea } from '../../components/ui/field';
import { Badge, Card, Chip, Skeleton } from '../../components/ui/misc';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { useCan } from '../../lib/me';
import { isRegistered } from '../../lib/placements';
import { placementDrives } from '../../lib/queries';
import { useFeature } from '../../lib/tenant-context';
import { toast } from '../../lib/toast';
import { careerSaid } from '../ask/said';
import { TrustNote } from '../ask/trust-note';
import { AnswerText } from '../study/chat/answer-text';
import { copilotHome, copilotSession } from './queries';
import { streamCopilot } from './stream';

const NEAR_BOTTOM = 160;

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
    <article className="grid gap-3" aria-label={t('copilot.copilot')}>
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
    </article>
  );
}

/**
 * The Career Copilot inside Ask (prompt 2, G11; prompt 3, U8): cited answers from the college's own
 * records, then a person to talk to. The same frame as the study chat: the conversation, and the
 * composer docked under it. Suggestions are questions; a command is shown back in words.
 */
export function CareerPanel({
  sessionId: initialSession = null,
  initialInput = '',
  onSession,
}: {
  sessionId?: string | null;
  /** A question carried in from search ("Ask about…"), placed in the composer, not sent. */
  initialInput?: string;
  /** A new conversation got its id (Ask puts it in the address). */
  onSession?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const home = useQuery(copilotHome());
  const [sessionId, setSessionId] = useState<string | null>(initialSession);
  const loaded = useQuery({ ...copilotSession(sessionId ?? ''), enabled: !!sessionId });
  const seesDrives = useCan('placements:view');
  const placementsOn = useFeature('placements');
  const canDrives = seesDrives && placementsOn;
  const drives = useQuery({ ...placementDrives('eligible'), enabled: canDrives, staleTime: 5 * 60_000 });
  // The conversation being written here; otherwise the saved one.
  const [live, setLive] = useState<CopilotMessageView[] | null>(null);
  const messages = live ?? (sessionId ? (loaded.data?.messages ?? []) : []);
  const [question, setQuestion] = useState(initialInput);
  const [busy, setBusy] = useState(false);
  const stop = useRef<AbortController | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // Follow the conversation as it grows and as the last answer streams in.
  const count = messages.length;
  const lastText = messages.at(-1)?.text;
  useEffect(() => {
    const el = thread.current;
    if (el && pinned.current && count) el.scrollTop = el.scrollHeight;
  }, [count, lastText]);
  useEffect(() => () => stop.current?.abort(), []);

  const ask = async (raw: string) => {
    const text = raw.trim();
    if (text.length < 2 || busy) return;
    setBusy(true);
    setQuestion('');
    pinned.current = true;
    const ctrl = new AbortController();
    stop.current = ctrl;
    let current = sessionId;
    const base = messages;
    const set = (f: (ms: CopilotMessageView[]) => CopilotMessageView[]) => setLive((l) => f(l ?? base));
    setLive(base);
    try {
      await streamCopilot(
        { question: text, ...(current ? { sessionId: current } : {}) },
        (e) => {
          if (e.type === 'start') {
            current = e.sessionId;
            if (!sessionId) {
              setSessionId(e.sessionId);
              onSession?.(e.sessionId);
            }
            set((ms) => [
              ...ms,
              e.question,
              { ...e.question, id: e.messageId, role: 'assistant', text: '', status: 'streaming' },
            ]);
          } else if (e.type === 'sources' || e.type === 'delta') {
            set((ms) =>
              ms.map((m, i) =>
                i === ms.length - 1
                  ? e.type === 'delta'
                    ? { ...m, text: m.text + e.text }
                    : { ...m, citations: e.citations }
                  : m,
              ),
            );
          } else if (e.type === 'done') {
            set((ms) => ms.map((m, i) => (i === ms.length - 1 ? e.message : m)));
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
      if (current) void qc.invalidateQueries({ queryKey: ['copilot', 'session', current] });
    }
  };

  const lastQuestion = [...messages].reverse().find((m) => m.role === 'user')?.text ?? '';
  const next = (drives.data ?? []).find((d) => d.registrationOpen && !isRegistered(d));
  const chips: [string, string][] = [
    ['/eligible', t('ask.chip.eligible')],
    ...(next
      ? [
          [`/prep ${next.company.name}`, t('ask.chip.prep', { company: next.company.name })] as [
            string,
            string,
          ],
        ]
      : []),
    ['/plan', t('ask.chip.plan')],
    ['/resume', t('ask.chip.resume')],
  ];
  const left = home.data?.ai ? home.data.left : null;
  const loading = !!sessionId && loaded.isLoading && !live;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={thread}
        role="log"
        aria-label={t('copilot.history')}
        aria-busy={busy}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
        }}
        className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto overscroll-contain py-4"
      >
        {loading ? (
          <Skeleton className="h-40" />
        ) : messages.length === 0 ? (
          <div className="grid gap-4 py-4">
            <p className="flex items-center gap-2 text-headline font-semibold">
              <Sparkles className="size-5 text-brand-ink" aria-hidden /> {t('ask.career.hello')}
            </p>
            <p className="text-fg-2">{t('ask.career.intro')}</p>
            <div className="grid gap-2">
              <p className="text-callout font-semibold text-fg-2">{t('ask.chips')}</p>
              <div className="flex flex-wrap gap-2">
                {chips.map(([command, label]) => (
                  <Chip
                    key={command}
                    pressed={false}
                    disabled={busy}
                    className="h-auto max-w-full shrink py-2 text-start whitespace-normal"
                    onClick={() => void ask(command)}
                  >
                    {label}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((m) =>
            m.role === 'user' ? (
              <p
                key={m.id}
                className="max-w-[85%] justify-self-end rounded-[var(--radius-lg)] bg-brand-surface px-4 py-2 text-body text-pretty break-words text-brand-ink"
              >
                <span className="sr-only">{t('copilot.you')}: </span>
                {careerSaid(t, m.text)}
              </p>
            ) : (
              <Answer key={m.id} m={m} q={careerSaid(t, lastQuestion)} />
            ),
          )
        )}
      </div>
      <form
        className="grid gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            rows={1}
            maxLength={COPILOT_QUESTION_MAX}
            aria-label={t('ask.career.ask')}
            placeholder={t('ask.career.placeholder')}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(question);
              }
            }}
            className="max-h-40 min-h-12 resize-none py-3 text-body"
          />
          {busy ? (
            <Button
              variant="outline"
              size="icon"
              className="flex-none"
              aria-label={t('copilot.stop')}
              onClick={() => stop.current?.abort()}
            >
              <Square className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="icon"
              className="flex-none"
              aria-label={t('copilot.send')}
              disabled={question.trim().length < 2}
            >
              <ArrowUp className="size-5" aria-hidden />
            </Button>
          )}
        </div>
        <TrustNote
          scope="career"
          left={left}
          note={home.data && !home.data.ai ? t('copilot.aiOff') : undefined}
        />
      </form>
    </div>
  );
}
