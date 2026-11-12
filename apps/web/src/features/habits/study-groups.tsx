import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenCheck, CheckCircle2, Circle, Plus, UsersRound } from 'lucide-react';
import {
  STUDY_GROUP_MAX,
  STUDY_GROUP_MIN,
  type StudyGroupQuizView,
  type StudyGroupView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input, Select } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

const fail = (t: (k: string) => string) => (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'));

function GroupCard({ g }: { g: StudyGroupView }) {
  const { t } = useTranslation();
  return (
    <li>
      <Card variant="interactive" className="relative grid gap-1 p-4">
        <Link to={`/study-groups/${g.id}`} className="font-semibold after:absolute after:inset-0">
          {g.name}
        </Link>
        <p className="text-callout text-fg-2">{g.subject.name}</p>
        <p className="flex flex-wrap items-center gap-2 text-caption text-fg-3">
          <span>{t('habits.groups.members', { n: g.members.length, max: STUDY_GROUP_MAX })}</span>
          {g.joined && <Badge tone="brand">{t('habits.groups.yours')}</Badge>}
          {!g.formed && <Badge tone="warning">{t('habits.groups.forming', { n: STUDY_GROUP_MIN })}</Badge>}
          {g.slot && <span>{formatDateTime(g.slot.at)}</span>}
        </p>
      </Card>
    </li>
  );
}

function NewGroup({ subjectId, onClose }: { subjectId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const subjects = useQuery(q.subjects('mine'));
  const [subject, setSubject] = useState(subjectId);
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<StudyGroupView>('/study-groups', { subjectId: subject, name: name.trim() }),
    onSuccess: (g) => {
      onClose();
      void navigate(`/study-groups/${g.id}`);
    },
    onError: fail(t),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('habits.groups.newTitle')}
      description={t('habits.groups.newBody', { min: STUDY_GROUP_MIN, max: STUDY_GROUP_MAX })}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!subject || name.trim().length < 3}
            onClick={() => create.mutate()}
          >
            {t('habits.groups.start')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Field label={t('habits.groups.subject')}>
          {({ id }) => (
            <Select id={id} value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">
                {subjects.isLoading ? t('common.loading') : t('habits.groups.pickSubject')}
              </option>
              {(subjects.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('habits.groups.name')}>
          {({ id }) => (
            <Input id={id} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Study groups: mine, or the ones on a subject (?subject=), and starting one (prompt 2, G7). */
export function StudyGroupsPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const subjectId = params.get('subject') ?? '';
  const [creating, setCreating] = useState(false);
  const list = useQuery({ ...SCREEN, ...q.studyGroups(subjectId) });
  return (
    <div className="mx-auto grid w-full max-w-[860px] gap-5">
      <PageHeader
        icon={<UsersRound />}
        title={t('habits.groups.title')}
        intro={t('habits.groups.intro', { min: STUDY_GROUP_MIN, max: STUDY_GROUP_MAX })}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> {t('habits.groups.new')}
          </Button>
        }
      />
      {list.isLoading && <Skeleton className="h-40" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.isSuccess && !list.data.length && (
        <EmptyState icon={<UsersRound className="size-6" />} title={t('habits.groups.none')}>
          {t('habits.groups.noneBody')}
        </EmptyState>
      )}
      {!!list.data?.length && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {list.data.map((g) => (
            <GroupCard key={g.id} g={g} />
          ))}
        </ul>
      )}
      {creating && <NewGroup subjectId={subjectId} onClose={() => setCreating(false)} />}
    </div>
  );
}

function Quiz({ group, quiz }: { group: StudyGroupView; quiz: StudyGroupQuizView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<(number | string)[]>(() =>
    quiz.questions.map((x) => (x.kind === 'mcq' ? -1 : '')),
  );
  const submit = useMutation({
    mutationFn: () =>
      api.post<StudyGroupView>(`/study-groups/${group.id}/quizzes/${quiz.id}/answers`, { answers }),
    onSuccess: (g) => qc.setQueryData(q.studyGroup(group.id).queryKey, g),
    onError: fail(t),
  });
  const ready = answers.every((a) => (typeof a === 'number' ? a >= 0 : a.trim() !== ''));
  return (
    <Card variant="raised" className="grid gap-4 p-4">
      <div className="grid gap-1">
        <h3 className="font-semibold">{quiz.topic || t('habits.groups.quiz')}</h3>
        <p className="text-caption text-fg-3">
          {t('habits.groups.sharedBy', { name: quiz.sharedBy.name })} ·{' '}
          {t('habits.groups.taken', { count: quiz.taken })}
        </p>
      </div>
      {quiz.mine ? (
        <div className="grid gap-2">
          <p className="font-semibold">
            {t('habits.groups.score', { n: quiz.mine.correct, total: quiz.mine.total })}
          </p>
          <ol className="grid gap-2">
            {quiz.questions.map((x, i) => (
              <li key={i} className="grid gap-1 text-callout">
                <span className="font-semibold">{x.q}</span>
                <span className="text-fg-2">
                  {t('habits.groups.answerWas')}{' '}
                  {x.kind === 'mcq'
                    ? x.options[Number(quiz.mine?.key[i]?.answer)]
                    : String(quiz.mine?.key[i]?.answer ?? '')}
                </span>
                <span className="text-fg-3">{quiz.mine?.key[i]?.explain}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) submit.mutate();
          }}
        >
          {quiz.questions.map((x, i) =>
            x.kind === 'mcq' ? (
              <fieldset key={i} className="grid gap-2">
                <legend className="mb-1 text-callout font-semibold">{x.q}</legend>
                <ChoiceGroup
                  label={x.q}
                  value={String(answers[i])}
                  columns={1}
                  options={x.options.map((o, j) => ({ value: String(j), label: o }))}
                  onChange={(v) => setAnswers(answers.map((a, k) => (k === i ? Number(v) : a)))}
                />
              </fieldset>
            ) : (
              <Field key={i} label={x.q}>
                {({ id }) => (
                  <Input
                    id={id}
                    maxLength={300}
                    value={String(answers[i] ?? '')}
                    onChange={(e) => setAnswers(answers.map((a, k) => (k === i ? e.target.value : a)))}
                  />
                )}
              </Field>
            ),
          )}
          <div>
            <Button variant="primary" type="submit" disabled={!ready} loading={submit.isPending}>
              {t('habits.groups.submit')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function ShareQuiz({ group, onClose }: { group: StudyGroupView; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const mine = useQuery(q.myQuizzes());
  const [messageId, setMessageId] = useState('');
  const share = useMutation({
    mutationFn: () => api.post<StudyGroupView>(`/study-groups/${group.id}/quizzes`, { messageId }),
    onSuccess: (g) => {
      qc.setQueryData(q.studyGroup(group.id).queryKey, g);
      onClose();
    },
    onError: fail(t),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('habits.groups.shareTitle')}
      description={t('habits.groups.shareBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            disabled={!messageId}
            loading={share.isPending}
            onClick={() => share.mutate()}
          >
            {t('habits.groups.share')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      {mine.isLoading && <Skeleton className="h-24" />}
      {mine.isSuccess && !mine.data.length && (
        <p className="text-callout text-fg-2">
          {t('habits.groups.noQuizzes')}{' '}
          <Link to={`/study/${group.subject.id}`} className="font-semibold text-brand-ink underline">
            {t('habits.groups.openSubject')}
          </Link>
        </p>
      )}
      {!!mine.data?.length && (
        <Field label={t('habits.groups.pickQuiz')}>
          {({ id }) => (
            <Select id={id} value={messageId} onChange={(e) => setMessageId(e.target.value)}>
              <option value="">{t('habits.groups.pickQuiz')}</option>
              {mine.data.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.topic} · {formatDay(m.createdAt)} ·{' '}
                  {t('habits.groups.questions', { count: m.questions })}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </Dialog>
  );
}

/** One study group (prompt 2, G7). */
export function StudyGroupPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const g = useQuery({ ...SCREEN, ...q.studyGroup(id) });
  const [question, setQuestion] = useState('');
  const [sharing, setSharing] = useState(false);
  const [slotAt, setSlotAt] = useState('');
  const [place, setPlace] = useState('');
  const put = (v: StudyGroupView | null) => {
    if (v) qc.setQueryData(q.studyGroup(id).queryKey, v);
    void qc.invalidateQueries({ queryKey: ['study-groups'] });
  };
  const join = useMutation({
    mutationFn: (on: boolean) =>
      api.post<StudyGroupView | null>(`/study-groups/${id}/${on ? 'join' : 'leave'}`),
    onSuccess: (v) => put(v),
    onError: fail(t),
  });
  const ask = useMutation({
    mutationFn: () => api.post<StudyGroupView>(`/study-groups/${id}/questions`, { text: question.trim() }),
    onSuccess: (v) => {
      setQuestion('');
      put(v);
    },
    onError: fail(t),
  });
  const mark = useMutation({
    mutationFn: ({ qid, done }: { qid: string; done: boolean }) =>
      api.put<StudyGroupView>(`/study-groups/${id}/questions/${qid}`, { done }),
    onSuccess: put,
    onError: fail(t),
  });
  const slot = useMutation({
    mutationFn: (clear: boolean) =>
      api.put<StudyGroupView>(`/study-groups/${id}/slot`, {
        slot: clear ? null : { at: new Date(slotAt).toISOString(), place: place.trim() },
      }),
    onSuccess: put,
    onError: fail(t),
  });
  if (g.isLoading) return <Skeleton className="mx-auto h-80 w-full max-w-[860px]" />;
  if (g.isError || !g.data) return <ErrorState error={g.error} onRetry={() => void g.refetch()} />;
  const v = g.data;
  return (
    <div className="mx-auto grid w-full max-w-[860px] gap-5">
      <BackLink to="/study-groups">{t('habits.groups.title')}</BackLink>
      <PageHeader
        icon={<BookOpenCheck />}
        title={v.name}
        intro={v.subject.name}
        actions={
          v.joined ? (
            <Button variant="ghost" loading={join.isPending} onClick={() => join.mutate(false)}>
              {t('habits.groups.leave')}
            </Button>
          ) : !v.full ? (
            <Button variant="primary" loading={join.isPending} onClick={() => join.mutate(true)}>
              {t('habits.groups.join')}
            </Button>
          ) : (
            <Badge>{t('habits.groups.full')}</Badge>
          )
        }
      />
      <Card className="grid gap-2 p-4">
        <h2 className="font-semibold">
          {t('habits.groups.membersTitle', { n: v.members.length, max: STUDY_GROUP_MAX })}
        </h2>
        <p className="text-callout text-fg-2">{v.members.map((m) => m.name).join(', ')}</p>
        {!v.formed && (
          <p className="text-caption text-fg-3">{t('habits.groups.formingBody', { n: STUDY_GROUP_MIN })}</p>
        )}
      </Card>
      {v.joined && (
        <>
          <Card className="grid gap-3 p-4">
            <h2 className="font-semibold">{t('habits.groups.next')}</h2>
            {v.slot ? (
              <p className="text-callout">
                {formatDateTime(v.slot.at)}
                {v.slot.place ? ` · ${v.slot.place}` : ''}
              </p>
            ) : (
              <p className="text-callout text-fg-2">{t('habits.groups.noSlot')}</p>
            )}
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label={t('habits.groups.when')}>
                {({ id: fid }) => (
                  <Input
                    id={fid}
                    type="datetime-local"
                    value={slotAt}
                    onChange={(e) => setSlotAt(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('habits.groups.where')}>
                {({ id: fid }) => (
                  <Input id={fid} maxLength={200} value={place} onChange={(e) => setPlace(e.target.value)} />
                )}
              </Field>
              <Button
                variant="secondary"
                disabled={!slotAt}
                loading={slot.isPending}
                onClick={() => slot.mutate(false)}
              >
                {t('habits.groups.setSlot')}
              </Button>
            </div>
          </Card>
          <section aria-labelledby="group-questions" className="grid gap-3">
            <h2 id="group-questions" className="text-headline font-semibold">
              {t('habits.groups.questionsTitle')}
            </h2>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label={t('habits.groups.addQuestion')}>
                  {({ id: fid }) => (
                    <Input
                      id={fid}
                      maxLength={300}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Button
                variant="secondary"
                disabled={question.trim().length < 5}
                loading={ask.isPending}
                onClick={() => ask.mutate()}
              >
                {t('habits.groups.add')}
              </Button>
            </div>
            {!v.questions.length && (
              <p className="text-callout text-fg-2">{t('habits.groups.noQuestions')}</p>
            )}
            <ul className="grid gap-1">
              {v.questions.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-2 text-left hover:bg-hover"
                    aria-pressed={x.done}
                    onClick={() => mark.mutate({ qid: x.id, done: !x.done })}
                  >
                    {x.done ? (
                      <CheckCircle2 className="size-5 flex-none text-success-ink" aria-hidden />
                    ) : (
                      <Circle className="size-5 flex-none text-fg-3" aria-hidden />
                    )}
                    <span className={x.done ? 'text-fg-2 line-through' : ''}>{x.text}</span>
                    <span className="ml-auto text-caption text-fg-3">{x.by.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="group-quizzes" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="group-quizzes" className="text-headline font-semibold">
                {t('habits.groups.quizzes')}
              </h2>
              <Button variant="secondary" onClick={() => setSharing(true)}>
                {t('habits.groups.shareQuiz')}
              </Button>
            </div>
            {!v.quizzes.length && <p className="text-callout text-fg-2">{t('habits.groups.noQuizShared')}</p>}
            {v.quizzes.map((z) => (
              <Quiz key={z.id} group={v} quiz={z} />
            ))}
          </section>
        </>
      )}
      {sharing && <ShareQuiz group={v} onClose={() => setSharing(false)} />}
    </div>
  );
}
