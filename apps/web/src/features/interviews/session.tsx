import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mic, Square, UserRoundSearch } from 'lucide-react';
import {
  INTERVIEW_ANSWER_MAX,
  RUBRIC_DIMENSIONS,
  type InterviewTurnView,
  type InterviewView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Textarea } from '../../components/ui/field';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ProgressBar } from '../../components/ui/progress';
import { api, ApiError } from '../../lib/api';
import { focusOnMount } from '../../lib/focus';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { useRecorder } from './use-recorder';

const tone = (n: number) => (n >= 4 ? 'success' : n >= 3 ? 'warning' : 'danger');
const seconds = (ms: number) =>
  `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

/** Scores, quotes from the answer and the tip for one answered turn. */
function Feedback({ turn: t }: { turn: InterviewTurnView }) {
  const { t: tr } = useTranslation();
  if (!t.scores) return <p className="text-meta text-fg-3">{tr('interviews.unscored')}</p>;
  return (
    <div className="grid gap-2">
      <ul className="flex flex-wrap gap-1.5">
        {RUBRIC_DIMENSIONS.map((d) => {
          const v = t.scores?.[d];
          return typeof v === 'number' ? (
            <li key={d}>
              <Badge tone={tone(v)}>
                {tr(`interviews.dimension.${d}`)} {v}/5
              </Badge>
            </li>
          ) : null;
        })}
      </ul>
      {Object.entries(t.evidence).length > 0 && (
        <ul className="grid gap-1 text-meta text-fg-2">
          {RUBRIC_DIMENSIONS.filter((d) => t.evidence[d]).map((d) => (
            <li key={d}>
              <span className="font-semibold">{tr(`interviews.dimension.${d}`)}:</span> “{t.evidence[d]}”
            </li>
          ))}
        </ul>
      )}
      {t.tip && (
        <p className="rounded-[var(--radius-md)] bg-surface-2 p-3 text-meta">
          <span className="font-semibold">{tr('interviews.tip')}:</span> {t.tip}
        </p>
      )}
    </div>
  );
}

function TurnCard({ turn: t, n }: { turn: InterviewTurnView; n: number }) {
  const { t: tr } = useTranslation();
  return (
    <Card variant="flat" className="grid gap-2 p-4">
      <p className="text-caption text-fg-3">
        {t.kind === 'follow_up' ? tr('interviews.followUp') : tr('interviews.questionN', { n })} · {t.topic}
      </p>
      <p className="font-semibold">{t.text}</p>
      {t.status === 'skipped' ? (
        <p className="text-meta text-fg-3">{tr('interviews.skipped')}</p>
      ) : (
        t.answer && (
          <>
            <p className="text-meta whitespace-pre-line">
              {t.answeredBy === 'voice' && <Badge className="mr-2">{tr('interviews.byVoice')}</Badge>}
              {t.answer}
            </p>
            <Feedback turn={t} />
          </>
        )
      )}
    </Card>
  );
}

/** The finished session: the summary, then every question with its answer and feedback. */
function Report({ s }: { s: InterviewView }) {
  const { t } = useTranslation();
  let n = 0;
  const numbered = s.turns.map((turn) => ({ turn, n: turn.kind === 'question' ? ++n : n }));
  const mockLink = `/mentors?view=browse&type=mock_interview${s.drive ? `&q=${encodeURIComponent(s.drive.company)}` : ''}`;
  return (
    <div className="grid gap-5">
      {s.summary && (
        <Card variant="featured" className="grid gap-3 p-4 sm:p-6" aria-labelledby="summary-title">
          <h2 id="summary-title" className="text-title font-semibold">
            {t('interviews.summary')}
          </h2>
          <p>{s.summary.overall}</p>
          <ul className="flex flex-wrap gap-1.5">
            {RUBRIC_DIMENSIONS.map((d) => {
              const v = s.summary?.averages[d];
              return typeof v === 'number' ? (
                <li key={d}>
                  <Badge tone={tone(v)}>
                    {t(`interviews.dimension.${d}`)} {t('interviews.outOf5', { n: v.toFixed(1) })}
                  </Badge>
                </li>
              ) : null;
            })}
          </ul>
          <div className="grid gap-4 sm:grid-cols-2">
            {!!s.summary.strengths.length && (
              <div className="grid gap-1">
                <h3 className="font-semibold">{t('interviews.strengths')}</h3>
                <ul className="grid list-disc gap-1 pl-5 text-meta">
                  {s.summary.strengths.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!s.summary.improve.length && (
              <div className="grid gap-1">
                <h3 className="font-semibold">{t('interviews.improve')}</h3>
                <ul className="grid list-disc gap-1 pl-5 text-meta">
                  {s.summary.improve.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {s.unscored > 0 && (
            <p className="text-caption text-fg-3">{t('interviews.someUnscored', { count: s.unscored })}</p>
          )}
          <p className="text-caption text-fg-3">{t('interviews.noVerdict')}</p>
        </Card>
      )}
      {s.mine && (
        <Card variant="raised" className="grid gap-3 p-4">
          <h2 className="font-semibold">{t('interviews.human.title')}</h2>
          <p className="text-meta text-fg-2">
            {s.drive
              ? t('interviews.human.bodyCompany', { company: s.drive.company })
              : t('interviews.human.body')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to={mockLink} className={buttonVariants({ variant: 'primary' })}>
              <UserRoundSearch className="size-4" aria-hidden /> {t('interviews.human.book')}
            </Link>
            <Link to="/interviews" className={buttonVariants({ variant: 'outline' })}>
              {t('interviews.again')}
            </Link>
          </div>
          <p className="text-caption text-fg-3">{t('interviews.human.share')}</p>
        </Card>
      )}
      <ol className="grid gap-3">
        {numbered.map(({ turn, n: k }) => (
          <li key={turn.index}>
            <TurnCard turn={turn} n={k} />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The question being asked now: type an answer, or record one when the session is by voice. */
function Live({ s }: { s: InterviewView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const current = s.current ?? 0;
  const turn = s.turns[current];
  const update = (v: InterviewView) => {
    qc.setQueryData(q.interview(s.id).queryKey, v);
    setText('');
    setError('');
    if (v.status === 'completed') void qc.invalidateQueries({ queryKey: ['interviews'] });
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : t('errors.generic'));
  const send = useMutation({
    mutationFn: () =>
      api.post<InterviewView>(`/interviews/${s.id}/answers`, { turn: current, text: text.trim() }),
    onSuccess: update,
    onError,
  });
  const skip = useMutation({
    mutationFn: () => api.post<InterviewView>(`/interviews/${s.id}/skip`, { turn: current }),
    onSuccess: update,
    onError,
  });
  const finish = useMutation({
    mutationFn: () => api.post<InterviewView>(`/interviews/${s.id}/finish`, {}),
    onSuccess: update,
    onError,
  });
  const upload = useMutation({
    mutationFn: (audio: Blob) => {
      const form = new FormData();
      const ext = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', audio, `answer.${ext}`);
      return api.upload<InterviewView>(`/interviews/${s.id}/turns/${current}/audio`, form);
    },
    onSuccess: update,
    onError,
  });
  const recorder = useRecorder((audio) => upload.mutate(audio));
  const answered = s.turns.filter((x) => x.status === 'answered' || x.status === 'skipped').length;
  const transcribing = turn?.status === 'transcribing';
  const voiceFailed = turn?.status === 'voice_failed';
  const busy = send.isPending || skip.isPending || upload.isPending || transcribing;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [current]);
  if (!turn) return null;
  const previous = s.turns
    .slice(0, current)
    .filter((x) => x.status === 'answered')
    .at(-1);
  const voiceOn = s.mode === 'voice' && recorder.state !== 'unsupported';
  return (
    <div className="grid gap-5">
      <ProgressBar
        value={answered}
        max={s.turns.length}
        label={t('interviews.progressLabel', { done: answered, total: s.turns.length })}
      />
      {previous && (
        <details className="rounded-[var(--radius-md)] border border-line p-3">
          <summary className="cursor-pointer text-meta font-semibold">{t('interviews.lastFeedback')}</summary>
          <div className="mt-2">
            <Feedback turn={previous} />
          </div>
        </details>
      )}
      <Card variant="raised" className="grid gap-4 p-4 sm:p-6">
        <p className="text-caption text-fg-3">
          {turn.kind === 'follow_up'
            ? t('interviews.followUp')
            : t('interviews.questionOf', {
                n: s.turns.slice(0, current + 1).filter((x) => x.kind === 'question').length,
                total: s.planned,
              })}
          {' · '}
          {turn.topic}
        </p>
        <h2
          ref={heading}
          tabIndex={-1}
          className="text-title font-semibold outline-none"
          lang={s.language === 'mixed' ? undefined : s.language}
        >
          {turn.text}
        </h2>
        {voiceOn && (
          <div className="grid gap-2">
            {transcribing ? (
              <p className="flex items-center gap-2 text-meta" role="status">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{' '}
                {t('interviews.voice.transcribing')}
              </p>
            ) : recorder.state === 'recording' ? (
              <Button variant="danger" size="lg" onClick={recorder.stop}>
                <Square className="size-4" aria-hidden />{' '}
                {t('interviews.voice.stop', { time: seconds(recorder.elapsed) })}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                disabled={busy}
                loading={upload.isPending}
                onClick={() => void recorder.start()}
              >
                <Mic className="size-5" aria-hidden /> {t('interviews.voice.record')}
              </Button>
            )}
            {voiceFailed && (
              <p role="alert" className="text-meta text-warning-ink">
                {t('interviews.voice.notHeard')}
              </p>
            )}
            {(recorder.state === 'denied' || recorder.state === 'failed') && (
              <p role="alert" className="text-meta text-warning-ink">
                {t(`interviews.voice.${recorder.state}`)}
              </p>
            )}
            <p className="text-caption text-fg-3">{t('interviews.voice.note')}</p>
          </div>
        )}
        {!transcribing && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) send.mutate();
            }}
          >
            <Field
              label={voiceOn ? t('interviews.orType') : t('interviews.yourAnswer')}
              aside={`${text.length}/${INTERVIEW_ANSWER_MAX}`}
            >
              {({ id }) => (
                <Textarea
                  id={id}
                  rows={6}
                  maxLength={INTERVIEW_ANSWER_MAX}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              )}
            </Field>
            {error && (
              <p role="alert" className="text-meta font-medium text-danger">
                {error}
              </p>
            )}
            <div className="grid gap-2 sm:flex sm:flex-row-reverse sm:justify-start">
              <Button
                type="submit"
                variant="primary"
                loading={send.isPending}
                disabled={!text.trim() || busy}
              >
                {t('interviews.submit')}
              </Button>
              <Button variant="ghost" loading={skip.isPending} disabled={busy} onClick={() => skip.mutate()}>
                {t('interviews.skip')}
              </Button>
            </div>
          </form>
        )}
        {send.isPending && (
          <p className="text-meta text-fg-2" role="status">
            {t('interviews.scoring')}
          </p>
        )}
      </Card>
      <div>
        <Button
          variant="outline"
          loading={finish.isPending}
          disabled={busy || answered === 0}
          onClick={() => finish.mutate()}
        >
          {t('interviews.finish')}
        </Button>
      </div>
    </div>
  );
}

/** One practice interview (prompt 2, G3): live while in progress, the report once done. */
export function InterviewSessionPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const s = useQuery({
    ...SCREEN,
    ...q.interview(id),
    // While a recording is transcribed in the worker, look again every two seconds.
    refetchInterval: (query) =>
      query.state.data?.turns.some((x) => x.status === 'transcribing') ? 2000 : false,
  });
  const wasCompleted = useRef<boolean | null>(null);
  useEffect(() => {
    if (!s.data) return;
    if (wasCompleted.current === false && s.data.status === 'completed') toast.success(t('interviews.done'));
    wasCompleted.current = s.data.status === 'completed';
  }, [s.data, t]);
  const d = s.data;
  return (
    <div className="mx-auto grid w-full max-w-[800px] gap-4">
      <BackLink to={d && !d.mine ? '/mentorship' : '/interviews'}>
        {d && !d.mine ? t('nav.requests') : t('nav.interviews')}
      </BackLink>
      {s.isLoading && <Skeleton className="h-80 rounded-[var(--radius-lg)]" />}
      {s.isError && <ErrorState error={s.error} onRetry={() => void s.refetch()} />}
      {d && (
        <>
          <PageHeader
            icon={<Mic />}
            title={
              d.mine
                ? d.drive
                  ? t('interviews.forCompany', { company: d.drive.company })
                  : t(`interviews.track.${d.track}`)
                : t('interviews.reportOf', { name: d.owner.name })
            }
            intro={
              <span
                ref={d.status === 'completed' ? focusOnMount : undefined}
                tabIndex={-1}
                className="outline-none"
              >
                {t(`interviews.difficulty.${d.difficulty}`)} · {t(`interviews.language.${d.language}`)} ·{' '}
                {t(`interviews.status.${d.status}`)}
              </span>
            }
          />
          {d.status === 'in_progress' && d.mine ? <Live s={d} /> : <Report s={d} />}
        </>
      )}
    </div>
  );
}
