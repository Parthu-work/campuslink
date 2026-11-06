import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Dumbbell, XCircle } from 'lucide-react';
import {
  CODE_LANGUAGES,
  PRACTICE_CODE_MAX,
  type CodeLanguage,
  type PracticeSetItemView,
  type PracticeSetView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ProgressBar } from '../../components/ui/progress';
import { api, ApiError } from '../../lib/api';
import { celebrate, firstSighting } from '../../lib/celebrate';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';

function Code({ code, language }: { code: string; language: CodeLanguage | null }) {
  const { t } = useTranslation();
  if (!code) return null;
  return (
    <figure className="grid gap-1">
      {language && (
        <figcaption className="text-caption text-fg-3">{t(`practice.language.${language}`)}</figcaption>
      )}
      <pre className="overflow-x-auto rounded-[var(--radius-md)] bg-surface-2 p-3 font-mono text-meta leading-relaxed">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

function Result({ entry }: { entry: PracticeSetItemView }) {
  const { t } = useTranslation();
  const r = entry.result;
  if (!r) return null;
  const shown = r.given.trim() !== '';
  return (
    <div
      role="status"
      className={`grid gap-2 rounded-[var(--radius-md)] border p-3 ${r.correct ? 'border-success-line bg-success-surface' : 'border-warning-line bg-warning-surface'}`}
    >
      <p
        className={`flex items-center gap-2 font-semibold ${r.correct ? 'text-success-ink' : 'text-warning-ink'}`}
      >
        {r.correct ? (
          <CheckCircle2 className="size-5" aria-hidden />
        ) : (
          <XCircle className="size-5" aria-hidden />
        )}
        {r.correct ? t('practice.set.right') : shown ? t('practice.set.notQuite') : t('practice.set.shown')}
      </p>
      {r.run && r.run.total > 0 && (
        <p className="text-meta">{t('practice.set.tests', { passed: r.run.passed, total: r.run.total })}</p>
      )}
      {r.run?.message && (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-surface-1 p-2 font-mono text-caption">
          {r.run.message}
        </pre>
      )}
      {!r.correct && r.answer && (
        <p className="text-meta">
          {t('practice.set.answerWas')}{' '}
          <span className="whitespace-pre-wrap font-mono font-semibold">{r.answer}</span>
        </p>
      )}
      <p className="text-meta text-fg-2">{r.explanation}</p>
      {!r.correct && <p className="text-caption text-fg-3">{t('practice.set.comesBack')}</p>}
    </div>
  );
}

function Question({
  set,
  entry,
  onAnswered,
}: {
  set: PracticeSetView;
  entry: PracticeSetItemView;
  onAnswered: (s: PracticeSetView) => void;
}) {
  const { t } = useTranslation();
  const { item } = entry;
  const [value, setValue] = useState('');
  const [language, setLanguage] = useState<CodeLanguage>(item.codeLanguage ?? 'python');
  const [error, setError] = useState('');
  const send = useMutation({
    mutationFn: (answer: string) =>
      api.post<PracticeSetView>(`/practice/sets/${set.id}/answers`, {
        index: entry.index,
        answer,
        ...(item.kind === 'coding' ? { codeLanguage: language } : {}),
      }),
    onSuccess: onAnswered,
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const ready = value.trim() !== '';
  const label = t(`practice.answerLabel.${item.kind}`);
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) send.mutate(value);
      }}
    >
      {item.kind === 'mcq' && (
        <fieldset className="grid gap-2">
          <legend className="sr-only">{label}</legend>
          <ChoiceGroup
            label={label}
            value={value}
            columns={1}
            options={item.options.map((o, i) => ({ value: String(i), label: o }))}
            onChange={setValue}
          />
        </fieldset>
      )}
      {item.kind === 'numeric' && (
        <Field label={label} hint={t('practice.set.numberHint')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              inputMode="decimal"
              autoComplete="off"
              maxLength={40}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
      )}
      {item.kind === 'output_prediction' && (
        <Field label={label} hint={t('practice.set.outputHint')}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              spellCheck={false}
              className="font-mono"
              maxLength={2000}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
      )}
      {item.kind === 'coding' && (
        <>
          <Field label={t('practice.set.language')}>
            {({ id }) => (
              <Select id={id} value={language} onChange={(e) => setLanguage(e.target.value as CodeLanguage)}>
                {CODE_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`practice.language.${l}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={label} hint={t('practice.set.codeHint')}>
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={12}
                spellCheck={false}
                className="font-mono"
                maxLength={PRACTICE_CODE_MAX}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </Field>
        </>
      )}
      {error && (
        <p role="alert" className="text-meta font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          type="submit"
          disabled={!ready || send.isPending}
          loading={send.isPending && send.variables !== ''}
        >
          {item.kind === 'coding' ? t('practice.set.run') : t('practice.set.check')}
        </Button>
        <Button
          variant="ghost"
          disabled={send.isPending}
          loading={send.isPending && send.variables === ''}
          onClick={() => send.mutate('')}
        >
          {t('practice.set.showAnswer')}
        </Button>
      </div>
    </form>
  );
}

function Summary({ set }: { set: PracticeSetView }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A finished daily set is a "quiz complete" moment (ADR 0008), once per device.
    if (set.kind === 'daily' && set.completedAt && firstSighting('practice-daily', [set.id]))
      celebrate(ref.current);
  }, [set.id, set.kind, set.completedAt]);
  return (
    <Card variant="raised" className="grid gap-4 p-4 sm:p-6">
      <div ref={ref} className="grid gap-1">
        <h2 className="text-title font-semibold">{t('practice.set.doneTitle')}</h2>
        <p className="text-body">{t('practice.set.score', { n: set.correct, total: set.items.length })}</p>
        <p className="text-meta text-fg-2">
          {set.correct === set.items.length ? t('practice.set.allRight') : t('practice.set.missedBack')}
        </p>
      </div>
      <ol className="grid gap-2">
        {set.items.map((e) => (
          <li key={e.index}>
            <details className="rounded-[var(--radius-md)] border border-line p-3">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2">
                {e.result?.correct ? (
                  <CheckCircle2
                    className="size-5 shrink-0 text-success-ink"
                    aria-label={t('practice.set.right')}
                  />
                ) : (
                  <XCircle
                    className="size-5 shrink-0 text-warning-ink"
                    aria-label={t('practice.set.notQuite')}
                  />
                )}
                <span className="line-clamp-2">{e.item.text}</span>
              </summary>
              <div className="mt-3 grid gap-3">
                <Code code={e.item.code} language={e.item.codeLanguage} />
                <Result entry={e} />
              </div>
            </details>
          </li>
        ))}
      </ol>
      <div>
        <Link
          to="/practice"
          className="inline-flex min-h-11 items-center gap-2 font-semibold text-brand-ink underline"
        >
          {t('practice.set.backHome')}
        </Link>
      </div>
    </Card>
  );
}

/** One practice set, a question at a time: answer, see why, next (prompt 2, G4). */
export function PracticeSetPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const s = useQuery({ ...SCREEN, ...q.practiceSet(id) });
  // The question just answered stays on screen (with its result) until "Next".
  const [shown, setShown] = useState<number | null>(null);
  if (s.isLoading) return <Skeleton className="mx-auto h-96 w-full max-w-[760px]" />;
  if (s.isError || !s.data) return <ErrorState error={s.error} onRetry={() => void s.refetch()} />;
  const set = s.data;
  const open = set.items.find((e) => !e.result);
  const entry = shown !== null ? set.items.find((e) => e.index === shown) : open;
  const title = set.company
    ? t('practice.set.companyTitle', { company: set.company.name })
    : t('practice.today.title');
  const position = entry ? set.items.indexOf(entry) + 1 : set.items.length;
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-5">
      <BackLink to="/practice">{t('nav.practice')}</BackLink>
      <PageHeader icon={<Dumbbell />} title={title} />
      <ProgressBar
        value={set.answered}
        max={set.items.length}
        label={t('practice.today.progress')}
        valueText={t('practice.answeredOf', { n: set.answered, total: set.items.length })}
      />
      {entry ? (
        <Card variant="raised" className="grid gap-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption font-semibold text-fg-3">
              {t('practice.set.position', { n: position, total: set.items.length })}
            </span>
            <Badge>{t(`practice.topic.${entry.item.topic}`)}</Badge>
            <Badge>{t(`practice.difficulty.${entry.item.difficulty}`)}</Badge>
          </div>
          <p className="whitespace-pre-line text-body font-semibold">{entry.item.text}</p>
          <Code code={entry.item.code} language={entry.item.codeLanguage} />
          {entry.result ? (
            <>
              <Result entry={entry} />
              <div>
                <Button variant="primary" onClick={() => setShown(null)}>
                  {open ? t('practice.set.next') : t('practice.set.finish')}{' '}
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              </div>
            </>
          ) : (
            <Question
              key={entry.index}
              set={set}
              entry={entry}
              onAnswered={(next) => {
                qc.setQueryData(q.practiceSet(set.id).queryKey, next);
                void qc.invalidateQueries({ queryKey: ['practice'], exact: true });
                setShown(entry.index);
              }}
            />
          )}
        </Card>
      ) : (
        <Summary set={set} />
      )}
    </div>
  );
}
