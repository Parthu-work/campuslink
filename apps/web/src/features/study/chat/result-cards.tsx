import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, ExternalLink, Layers, RotateCw, X } from 'lucide-react';
import {
  SLASH_COMMANDS,
  type ChatCitation,
  type ChatMessageView,
  type ChatResult,
  type ChatVideo,
  type FlashcardDeckView,
  type SyllabusView,
} from '@campuslink/shared';
import { Button } from '../../../components/ui/button';
import { ChoiceGroup } from '../../../components/ui/choice-group';
import { Input } from '../../../components/ui/field';
import { IntentLink } from '../../../components/ui/intent-link';
import { Badge, Card, Chip } from '../../../components/ui/misc';
import { api, ApiError } from '../../../lib/api';
import { celebrate, firstSighting } from '../../../lib/celebrate';
import { citationHref } from '../../../lib/chat';
import { MATERIAL_ICONS } from '../../../lib/material-icons';
import { formatDuration } from '../../../lib/study';
import { toast } from '../../../lib/toast';
import { cn } from '../../../lib/cn';

type Ask = (input: string) => void;

/** Topic chips that ask about a nearby topic instead. */
function Nearby({ topics, onAsk, command }: { topics: string[]; onAsk: Ask; command?: string }) {
  const { t } = useTranslation();
  if (!topics.length) return null;
  return (
    <div className="grid gap-2">
      <p className="text-meta text-fg-2">{t('study.chat.nearby')}</p>
      <div className="flex flex-wrap gap-2">
        {topics.map((x) => (
          <Chip
            key={x}
            pressed={false}
            onClick={() => onAsk(command ? `/${command} ${x}` : t('study.chat.explainTopic', { topic: x }))}
          >
            {x}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** The sources of an answer as chips: title and page or moment, each opening the material there. */
export function SourceChips({ citations, q }: { citations: ChatCitation[]; q: string }) {
  const { t } = useTranslation();
  if (!citations.length) return null;
  return (
    <div className="grid gap-1.5">
      <p className="text-caption font-semibold text-fg-3">{t('study.chat.sources')}</p>
      <ul className="flex flex-wrap gap-2">
        {citations.map((c) => {
          const Icon = MATERIAL_ICONS[c.type];
          return (
            <li key={`${c.n}-${c.chunkId}-${c.page ?? ''}`} className="min-w-0">
              <IntentLink
                to={citationHref(c, q)}
                className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-line-strong px-3 text-caption hover:bg-hover"
              >
                <span className="font-semibold text-brand-ink">{c.n}</span>
                <Icon className="size-3.5 flex-none text-fg-3" aria-hidden />
                <span className="truncate">{c.title}</span>
                <span className="flex-none text-fg-3">
                  {c.startSec !== null
                    ? formatDuration(c.startSec)
                    : c.page
                      ? t('study.chat.pageShort', { n: c.page })
                      : ''}
                </span>
              </IntentLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function VideoCard({ v, q }: { v: ChatVideo; q: string }) {
  const { t } = useTranslation();
  const Icon = MATERIAL_ICONS[v.material.type];
  return (
    <Card className="grid w-[min(280px,80vw)] flex-none snap-start content-start gap-2 p-4">
      <div className="flex items-start gap-2">
        <span
          className="grid size-10 flex-none place-items-center rounded-[var(--radius-md)] bg-brand-surface text-brand-ink"
          aria-hidden
        >
          <Icon className="size-5" />
        </span>
        <div className="grid min-w-0 gap-0.5">
          <IntentLink
            to={`/study/${v.material.subjectId}/m/${v.material.id}`}
            className="leading-snug font-semibold hover:underline"
          >
            {v.material.title}
          </IntentLink>
          <p className="truncate text-caption text-fg-3">
            {[v.material.durationSec ? formatDuration(v.material.durationSec) : '', v.material.uploader.name]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>
      {v.moments.length > 0 && (
        <ul className="grid gap-1" aria-label={t('study.chat.moments')}>
          {v.moments.map((mo) => (
            <li key={mo.startSec}>
              <IntentLink
                to={citationHref(
                  {
                    subjectId: v.material.subjectId,
                    materialId: v.material.id,
                    page: null,
                    startSec: mo.startSec,
                  },
                  q,
                )}
                className="grid grid-cols-[3.25rem_1fr] gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-caption hover:bg-hover"
              >
                <span className="font-mono font-semibold text-brand-ink">{formatDuration(mo.startSec)}</span>
                <span className="line-clamp-2 text-fg-2">{mo.text}</span>
              </IntentLink>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function VideoRow({ title, videos, q }: { title: string; videos: ChatVideo[]; q: string }) {
  if (!videos.length) return null;
  return (
    <section className="grid gap-2" aria-label={title}>
      <h4 className="text-meta font-semibold">{title}</h4>
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1" tabIndex={0}>
        {videos.map((v) => (
          <VideoCard key={v.material.id} v={v} q={q} />
        ))}
      </div>
    </section>
  );
}

function Videos({ r, onAsk }: { r: Extract<ChatResult, { kind: 'videos' }>; onAsk: Ask }) {
  const { t } = useTranslation();
  const none = !r.exact.length && !r.related.length;
  return (
    <div className="grid gap-4">
      {none && <p>{t('study.chat.noVideos', { topic: r.topic })}</p>}
      <VideoRow title={t('study.chat.exactTopic')} videos={r.exact} q={r.topic} />
      <VideoRow title={t('study.chat.related')} videos={r.related} q={r.topic} />
      {r.web && r.web.length > 0 && (
        <section
          className="grid gap-2 rounded-[var(--radius-md)] border border-dashed border-line-strong p-3"
          aria-label={t('study.chat.fromWeb')}
        >
          <h4 className="text-meta font-semibold">{t('study.chat.fromWeb')}</h4>
          <p className="text-caption text-fg-3">{t('study.chat.fromWebNote')}</p>
          <ul className="grid gap-1">
            {r.web.map((w) => (
              <li key={w.url}>
                <a
                  href={w.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-meta text-brand-ink hover:underline"
                >
                  <ExternalLink className="size-3.5 flex-none" aria-hidden />
                  {w.title}
                  <span className="text-fg-3">· {w.channel}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {none && <Nearby topics={r.nearby} onAsk={onAsk} command="videos" />}
    </div>
  );
}

function Notes({ r, onAsk }: { r: Extract<ChatResult, { kind: 'notes' }>; onAsk: Ask }) {
  const { t } = useTranslation();
  if (!r.items.length)
    return (
      <div className="grid gap-3">
        <p>{t('study.chat.noNotes', { topic: r.topic })}</p>
        <Nearby topics={r.nearby} onAsk={onAsk} command="notes" />
      </div>
    );
  return (
    <ul className="grid gap-2">
      {r.items.map(({ material: m, pages }) => {
        const Icon = MATERIAL_ICONS[m.type];
        return (
          <li key={m.id} className="grid gap-1.5 rounded-[var(--radius-md)] border border-line p-3">
            <span className="flex items-center gap-2">
              <Icon className="size-4 flex-none text-brand-ink" aria-hidden />
              <IntentLink to={`/study/${m.subjectId}/m/${m.id}`} className="font-semibold hover:underline">
                {m.title}
              </IntentLink>
            </span>
            {pages.length > 0 && (
              <span className="flex flex-wrap items-center gap-1.5 text-caption">
                <span className="text-fg-3">{t('study.chat.pages')}</span>
                {pages.map((p) => (
                  <IntentLink
                    key={p}
                    to={citationHref(
                      { subjectId: m.subjectId, materialId: m.id, page: p, startSec: null },
                      r.topic,
                    )}
                    className="grid min-h-8 min-w-8 place-items-center rounded-full border border-line-strong px-2 hover:bg-hover"
                    aria-label={t('study.pageN', { n: p })}
                  >
                    {p}
                  </IntentLink>
                ))}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A quiz made from the material: answer, check, and see the explanations and sources. */
function Quiz({
  m,
  r,
  onUpdated,
}: {
  m: ChatMessageView;
  r: Extract<ChatResult, { kind: 'quiz' }>;
  onUpdated: (m: ChatMessageView) => void;
}) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<(number | string | null)[]>(r.questions.map(() => null));
  const check = useRef<HTMLButtonElement>(null);
  const submit = useMutation({
    mutationFn: () => api.post<ChatMessageView>(`/study/chat/messages/${m.id}/quiz`, { answers }),
    onSuccess: (v) => {
      onUpdated(v);
      // Finishing a quiz is one of the moments ADR 0008 celebrates (once per device).
      if (firstSighting('quiz', [m.id])) celebrate(check.current);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const done = r.score;
  const shown = done ? done.answers : answers;
  return (
    <div className="grid gap-4">
      <ol className="grid gap-4">
        {r.questions.map((q, i) => {
          const given = shown[i];
          const right = q.kind === 'mcq' ? given === q.answer : null;
          return (
            <li key={i} className="grid gap-2">
              <p className="font-semibold">
                {i + 1}. {q.q}
              </p>
              {q.kind === 'mcq' ? (
                <ChoiceGroup<string>
                  label={t('study.chat.questionN', { n: i + 1 })}
                  value={given === null || given === undefined ? null : String(given)}
                  options={q.options.map((o, oi) => ({
                    value: String(oi),
                    label: o,
                    disabled: !!done,
                  }))}
                  columns={1}
                  onChange={(v) => setAnswers((a) => a.map((x, xi) => (xi === i ? Number(v) : x)))}
                />
              ) : (
                <Input
                  aria-label={t('study.chat.yourAnswer', { n: i + 1 })}
                  value={typeof given === 'string' ? given : ''}
                  disabled={!!done}
                  maxLength={300}
                  onChange={(e) => setAnswers((a) => a.map((x, xi) => (xi === i ? e.target.value : x)))}
                />
              )}
              {done && (
                <div
                  className={cn(
                    'grid gap-1 rounded-[var(--radius-md)] p-3 text-meta',
                    right === false ? 'bg-warning-surface' : 'bg-success-surface',
                  )}
                >
                  <p className="flex items-center gap-1.5 font-semibold">
                    {right === false ? (
                      <X className="size-4" aria-hidden />
                    ) : (
                      <Check className="size-4" aria-hidden />
                    )}
                    {q.kind === 'mcq'
                      ? right
                        ? t('study.chat.correct')
                        : t('study.chat.correctWas', { answer: q.options[q.answer] ?? '' })
                      : t('study.chat.modelAnswer', { answer: q.answer })}
                  </p>
                  {q.explain && <p className="text-fg-2">{q.explain}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {done ? (
        <p className="text-lead font-semibold" role="status">
          {t('study.chat.score', { correct: done.correct, total: done.total })}
        </p>
      ) : (
        <Button
          ref={check}
          variant="primary"
          className="w-fit"
          loading={submit.isPending}
          disabled={answers.some((a) => a === null || a === '')}
          onClick={() => submit.mutate()}
        >
          {t('study.chat.checkAnswers')}
        </Button>
      )}
    </div>
  );
}

/** Flip cards (transform only; instant with reduced motion), and "Keep as a deck". */
function Flashcards({ m, r }: { m: ChatMessageView; r: Extract<ChatResult, { kind: 'flashcards' }> }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [at, setAt] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [saved, setSaved] = useState(false);
  const keep = useMutation({
    mutationFn: () =>
      api.postOnce<FlashcardDeckView>(
        '/study/decks',
        { messageId: m.id, title: r.topic.slice(0, 120) || t('study.chat.deck') },
        crypto.randomUUID(),
      ),
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ['study-decks'] });
      toast.success(t('study.chat.deckSaved'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const card = r.cards[at];
  if (!card) return null;
  const go = (n: number) => {
    setAt(Math.min(Math.max(0, n), r.cards.length - 1));
    setFlipped(false);
  };
  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? t('study.chat.showFront') : t('study.chat.showBack')}
        className="grid min-h-40 [perspective:900px]"
      >
        <span
          className={cn(
            'relative grid transition-transform duration-[var(--dur-smooth)] ease-snappy [transform-style:preserve-3d]',
            flipped && '[transform:rotateY(180deg)]',
          )}
        >
          <span className="col-start-1 row-start-1 grid place-items-center rounded-[var(--radius-lg)] border border-line-strong bg-surface-2 p-5 text-center text-lead font-semibold [backface-visibility:hidden]">
            {card.front}
          </span>
          <span className="col-start-1 row-start-1 grid place-items-center rounded-[var(--radius-lg)] border border-brand bg-brand-surface p-5 text-center [backface-visibility:hidden] [transform:rotateY(180deg)]">
            {card.back}
          </span>
        </span>
      </button>
      <p className="sr-only" aria-live="polite">
        {flipped ? card.back : card.front}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => go(at - 1)}
          disabled={at === 0}
          aria-label={t('study.chat.prevCard')}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <span className="text-meta text-fg-2">
          {t('study.chat.cardOf', { n: at + 1, count: r.cards.length })}
        </span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => go(at + 1)}
          disabled={at === r.cards.length - 1}
          aria-label={t('study.chat.nextCard')}
        >
          <ChevronRight className="size-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setFlipped((f) => !f)}>
          <RotateCw className="size-4" aria-hidden /> {t('study.chat.flip')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ms-auto"
          loading={keep.isPending}
          disabled={saved}
          onClick={() => keep.mutate()}
        >
          <Layers className="size-4" aria-hidden />{' '}
          {saved ? t('study.chat.deckKept') : t('study.chat.keepDeck')}
        </Button>
      </div>
    </div>
  );
}

/** The structured part of an assistant message (command results and "no generated answer" states). */
export function ResultCard({
  m,
  onAsk,
  onUpdated,
  isAdmin,
}: {
  m: ChatMessageView;
  onAsk: Ask;
  onUpdated: (m: ChatMessageView) => void;
  isAdmin: boolean;
}) {
  const { t } = useTranslation();
  const r = m.result;
  if (!r) return null;
  switch (r.kind) {
    case 'videos':
      return <Videos r={r} onAsk={onAsk} />;
    case 'notes':
      return <Notes r={r} onAsk={onAsk} />;
    case 'quiz':
      return <Quiz m={m} r={r} onUpdated={onUpdated} />;
    case 'flashcards':
      return <Flashcards m={m} r={r} />;
    case 'not_covered':
      return (
        <div className="grid gap-3">
          <p>{t('study.chat.notCovered')}</p>
          <p className="text-caption text-fg-3">{t('study.chat.notCoveredLogged')}</p>
          <Nearby topics={r.nearby} onAsk={onAsk} />
        </div>
      );
    case 'passages':
      return (
        <div className="grid gap-2">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{t('study.chat.passagesBadge')}</Badge>
            {m.status === 'failed'
              ? t('study.chat.providerDown')
              : m.citations.length
                ? t('study.chat.passagesIntro')
                : t('study.chat.aiOff')}
          </p>
          {!m.citations.length && isAdmin && (
            <p className="text-caption text-fg-3">{t('study.chat.aiOffAdmin')}</p>
          )}
          {m.citations.length > 0 && (
            <ul className="grid gap-2">
              {m.citations.map((c) => (
                <li key={c.n} className="rounded-[var(--radius-md)] border border-line p-3 text-meta">
                  <p className="text-fg-2">“{c.snippet}”</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
  }
}

/** `/help`: every command and what it does (answered in the browser). */
export function HelpCard({ onPick }: { onPick: (input: string) => void }) {
  const { t } = useTranslation();
  return (
    <ul className="grid gap-1">
      {SLASH_COMMANDS.map((c) => (
        <li key={c}>
          <button
            type="button"
            onClick={() => onPick(`/${c} `)}
            className="grid w-full gap-0.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-start hover:bg-hover"
          >
            <span className="font-mono text-meta font-semibold text-brand-ink">/{c}</span>
            <span className="text-caption text-fg-2">{t(`study.chat.cmd.${c}`)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** `/syllabus`: the subject's units and topics; a topic asks for an explanation. */
export function SyllabusCard({ tree, onAsk }: { tree: SyllabusView | null; onAsk: Ask }) {
  const { t } = useTranslation();
  if (!tree?.units.length) return <p>{t('study.chat.noSyllabus')}</p>;
  return (
    <ol className="grid gap-3">
      {tree.units.map((u, i) => (
        <li key={u.id} className="grid gap-1.5">
          <p className="font-semibold">
            {t('study.unit', { n: i + 1 })}: {u.title}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {u.topics.map((tp) => (
              <Chip
                key={tp.id}
                pressed={false}
                onClick={() => onAsk(t('study.chat.explainTopic', { topic: tp.title }))}
              >
                {tp.title}
              </Chip>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}
