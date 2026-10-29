import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import { CheckCircle2, HandHeart, MessageCircleQuestion, Plus } from 'lucide-react';
import { TOPICS, type AnswerView, type QuestionView, type Topic } from '@campuslink/shared';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { Badge, Card, Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { RichText } from '../../components/ui/rich-text';
import { api, apiRequest, ApiError } from '../../lib/api';
import { useCan } from '../../lib/me';
import { useUrlOverlay } from '../../lib/use-url-overlay';
import { formatRelative, newIdempotencyKey } from '../../lib/format';
import { AuthorLine } from '../feed/post-card';
import { ContentMenu, RemovalNotice } from '../feed/content-menu';
import { TopicPicker } from '../feed/composer-form';

const STATUS_TONE = {
  pending: 'warning',
  published: 'success',
  rejected: 'danger',
  removed: 'danger',
} as const;

function AskForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [key] = useState(newIdempotencyKey);
  const [error, setError] = useState('');
  const ask = useMutation({
    mutationFn: () =>
      api.postOnce<QuestionView>('/questions', { title: title.trim(), body: body.trim(), topics }, key),
    onSuccess: () => {
      toast.success(t('qa.sentForReview'));
      void qc.invalidateQueries({ queryKey: ['questions'] });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        ask.mutate();
      }}
    >
      <Field label={t('qa.questionTitle')} hint={t('qa.questionTitleHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            minLength={10}
            maxLength={150}
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('qa.details')} hint={t('qa.detailsHint')}>
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>
      <TopicPicker value={topics} onChange={setTopics} />
      {error && (
        <p role="alert" className="text-meta font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={title.trim().length < 10} loading={ask.isPending}>
          {t('qa.submit')}
        </Button>
      </div>
    </form>
  );
}

function QuestionRow({ q }: { q: QuestionView }) {
  const { t } = useTranslation();
  return (
    <li>
      <Card variant="interactive" className="grid gap-2 p-4">
        <h2 className="text-body leading-snug font-semibold">
          <Link to={`/questions/${q.id}`} className="hover:underline">
            {q.title}
          </Link>
        </h2>
        <p className="flex flex-wrap items-center gap-1.5 text-caption text-fg-3">
          {q.isMine && q.status !== 'published' && (
            <Badge tone={STATUS_TONE[q.status]}>{t(`qa.status.${q.status}`)}</Badge>
          )}
          {q.acceptedAnswerId && (
            <Badge tone="success">
              <CheckCircle2 className="size-3" aria-hidden /> {t('qa.solved')}
            </Badge>
          )}
          <span>{t('qa.answers', { count: q.answers })}</span>
          <span aria-hidden>·</span>
          <span>{formatRelative(q.createdAt)}</span>
          {q.topics.map((tp) => (
            <Badge key={tp}>{t(`topics.${tp}`)}</Badge>
          ))}
        </p>
      </Card>
    </li>
  );
}

export function QuestionsPage() {
  const { t } = useTranslation();
  const canAsk = useCan('qa:ask');
  const [params, setParams] = useSearchParams();
  // ?ask=1 opens the form (the Create sheet links here), and Back closes it.
  const askOverlay = useUrlOverlay('ask');
  const asking = canAsk && askOverlay.value !== null;
  const setAsking = (o: boolean) => (o ? askOverlay.open('1') : askOverlay.close());
  const filter = params.get('filter') ?? 'all';
  const topic = params.get('topic') ?? '';
  const qs = new URLSearchParams({
    ...(filter === 'mine' ? { mine: 'true' } : {}),
    ...(filter === 'unanswered' ? { unanswered: 'true' } : {}),
    ...(topic ? { topic } : {}),
  }).toString();
  const list = useInfiniteQuery({
    queryKey: ['questions', filter, topic],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiRequest<QuestionView[]>(`/questions?${qs}${pageParam ? `${qs ? '&' : ''}cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.meta?.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-4">
      <PageHeader
        title={t('qa.title')}
        intro={t('qa.intro')}
        actions={
          <>
            {canAsk && (
              <Button variant="primary" onClick={() => setAsking(true)}>
                <Plus className="size-4" aria-hidden /> {t('qa.ask')}
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('qa.filter')} className="flex flex-wrap gap-2">
          {(['all', 'unanswered', ...(canAsk ? ['mine'] : [])] as const).map((f) => (
            <Chip key={f} pressed={filter === f} onClick={() => set('filter', f === 'all' ? '' : f)}>
              {t(`qa.filters.${f}`)}
            </Chip>
          ))}
        </div>
        <label className="ml-auto w-full sm:w-52">
          <span className="sr-only">{t('feed.topics')}</span>
          <Select value={topic} onChange={(e) => set('topic', e.target.value)}>
            <option value="">{t('qa.anyTopic')}</option>
            {TOPICS.map((tp) => (
              <option key={tp} value={tp}>
                {t(`topics.${tp}`)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {list.isLoading && (
        <div className="grid gap-3" aria-hidden>
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      )}
      {list.isSuccess && !rows.length && (
        <EmptyState icon={<MessageCircleQuestion className="size-6" />} title={t('qa.empty')}>
          {t('qa.emptyBody')}
        </EmptyState>
      )}
      <ul className="grid gap-3">
        {rows.map((q) => (
          <QuestionRow key={q.id} q={q} />
        ))}
      </ul>
      {list.hasNextPage && (
        <Button loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          {t('common.loadMore')}
        </Button>
      )}
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        title={t('qa.askTitle')}
        description={t('qa.askBody')}
        history={false}
      >
        {asking && <AskForm onDone={() => setAsking(false)} />}
      </Dialog>
    </div>
  );
}

function AnswerCard({ a, q, onChange }: { a: AnswerView; q: QuestionView; onChange: () => void }) {
  const { t } = useTranslation();
  const canVote = useCan('feed:interact');
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const helpful = useMutation({
    mutationFn: () =>
      a.votedHelpful ? api.delete(`/answers/${a.id}/helpful`) : api.post(`/answers/${a.id}/helpful`, {}),
    onSuccess: onChange,
    onError: fail,
  });
  const accept = useMutation({
    mutationFn: () => api.post(`/questions/${q.id}/accept`, { answerId: a.id }),
    onSuccess: () => {
      toast.success(t('qa.acceptedToast'));
      onChange();
    },
    onError: fail,
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/answers/${a.id}`),
    onSuccess: onChange,
    onError: fail,
  });
  return (
    <li>
      <Card
        className={`grid gap-3 p-4 ${a.accepted ? 'border-[color-mix(in_srgb,var(--success)_50%,var(--line))]' : ''}`}
      >
        <article className="grid gap-3" aria-label={t('qa.answerBy', { name: a.author.name })}>
          <AuthorLine author={a.author} at={a.createdAt}>
            <ContentMenu
              targetType="answer"
              targetId={a.id}
              authorId={a.author.userId}
              authorName={a.author.name}
              isMine={a.isMine}
              onDelete={() => del.mutate()}
              deleting={del.isPending}
            />
          </AuthorLine>
          {a.accepted && (
            <Badge tone="success" className="justify-self-start">
              <CheckCircle2 className="size-3" aria-hidden /> {t('qa.accepted')}
            </Badge>
          )}
          {a.removal && (
            <RemovalNotice targetType="answer" targetId={a.id} removal={a.removal} canAppeal={a.isMine} />
          )}
          <RichText text={a.body} />
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={a.votedHelpful}
              disabled={!canVote || a.isMine || a.status !== 'published'}
              loading={helpful.isPending}
              onClick={() => helpful.mutate()}
              className="aria-pressed:text-brand-ink"
            >
              <HandHeart className="size-4" aria-hidden /> {t('qa.helpful', { count: a.helpful })}
            </Button>
            {q.isMine && !a.accepted && a.status === 'published' && (
              <Button
                size="sm"
                className="ml-auto"
                loading={accept.isPending}
                onClick={() => accept.mutate()}
              >
                <CheckCircle2 className="size-4" aria-hidden /> {t('qa.accept')}
              </Button>
            )}
          </div>
        </article>
      </Card>
    </li>
  );
}

export function QuestionPage() {
  const { t } = useTranslation();
  const { questionId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canAnswer = useCan('qa:answer');
  const [body, setBody] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const q = useQuery({
    queryKey: ['question', questionId],
    queryFn: () => api.get<{ question: QuestionView; answers: AnswerView[] }>(`/questions/${questionId}`),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['question', questionId] });
  const answer = useMutation({
    mutationFn: () => api.postOnce(`/questions/${questionId}/answers`, { body: body.trim() }, key),
    onSuccess: () => {
      setBody('');
      setKey(newIdempotencyKey());
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/questions/${questionId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['questions'] });
      navigate('/questions');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const question = q.data?.question;
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-4">
      <BackLink to="/questions">{t('qa.back')}</BackLink>
      {q.isLoading && <Skeleton className="h-40" />}
      {q.isError && (
        <EmptyState icon={<MessageCircleQuestion className="size-6" />} title={t('qa.gone')}>
          {t('qa.goneBody')}
        </EmptyState>
      )}
      {question && q.data && (
        <>
          <Card className="grid gap-3 p-4">
            <AuthorLine author={question.author} at={question.createdAt}>
              <ContentMenu
                targetType="question"
                targetId={question.id}
                authorId={question.author.userId}
                authorName={question.author.name}
                isMine={question.isMine}
                {...(question.answers === 0 ? { onDelete: () => del.mutate() } : {})}
                deleting={del.isPending}
              />
            </AuthorLine>
            <h1 className="text-headline leading-tight font-bold">{question.title}</h1>
            {question.isMine && question.status === 'pending' && (
              <p role="status" className="rounded-[var(--radius-sm)] bg-surface-2 p-3 text-meta text-fg-2">
                {t('qa.pendingNote')}
              </p>
            )}
            {question.removal && (
              <RemovalNotice
                targetType="question"
                targetId={question.id}
                removal={question.removal}
                canAppeal={question.isMine && question.status === 'removed'}
              />
            )}
            {question.body && <RichText text={question.body} />}
            {question.topics.length > 0 && (
              <p className="flex flex-wrap gap-1.5">
                {question.topics.map((tp) => (
                  <Badge key={tp}>{t(`topics.${tp}`)}</Badge>
                ))}
              </p>
            )}
          </Card>
          <section aria-labelledby="answers" className="grid gap-3">
            <h2 id="answers" className="text-title font-semibold">
              {t('qa.answers', { count: q.data.answers.length })}
            </h2>
            {!q.data.answers.length && <p className="text-fg-2">{t('qa.noAnswers')}</p>}
            <ul className="grid gap-3">
              {q.data.answers.map((a) => (
                <AnswerCard key={a.id} a={a} q={question} onChange={refresh} />
              ))}
            </ul>
          </section>
          {canAnswer && question.status === 'published' && (
            <Card className="p-4">
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  answer.mutate();
                }}
              >
                <Field label={t('qa.yourAnswer')} hint={t('qa.answerHint')}>
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      minLength={10}
                      maxLength={3000}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      className="min-h-[120px]"
                    />
                  )}
                </Field>
                <Button
                  type="submit"
                  variant="primary"
                  className="justify-self-end"
                  disabled={body.trim().length < 10}
                  loading={answer.isPending}
                >
                  {t('qa.postAnswer')}
                </Button>
              </form>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
