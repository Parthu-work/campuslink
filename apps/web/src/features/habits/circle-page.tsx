import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, MessageCircleQuestion, UsersRound } from 'lucide-react';
import type { CircleView, EventView, PostView, QuestionView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input, Textarea } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, formatRelative } from '../../lib/format';
import { useCan } from '../../lib/me';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { RichText } from '../../components/ui/rich-text';
import { VoiceAskButton } from './voice';

type Tab = 'posts' | 'questions' | 'events';
const fail = (t: (k: string) => string) => (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'));

function Posts({ c }: { c: CircleView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canPost = useCan('feed:post');
  const [body, setBody] = useState('');
  const posts = useQuery(q.circlePosts(c.id));
  const send = useMutation({
    mutationFn: () => api.post<PostView>('/posts', { kind: 'text', body: body.trim(), circleId: c.id }),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: ['circle-posts', c.id] });
    },
    onError: fail(t),
  });
  return (
    <div className="grid gap-4">
      {c.joined && canPost && (
        <Card className="grid gap-2 p-4">
          <Field label={t('habits.circle.write')}>
            {({ id }) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={3000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            )}
          </Field>
          <div>
            <Button
              variant="primary"
              disabled={!body.trim()}
              loading={send.isPending}
              onClick={() => send.mutate()}
            >
              {t('habits.circle.post')}
            </Button>
          </div>
        </Card>
      )}
      {posts.isLoading && <Skeleton className="h-40" />}
      {posts.isSuccess && !posts.data.length && <EmptyState title={t('habits.circle.noPosts')} />}
      {/* A light list (the full post card lives with the feed); each opens the post, where members react and comment. */}
      <ul className="grid gap-3">
        {posts.data?.map((p) => (
          <li key={p.id}>
            <Card className="grid gap-2 p-4">
              <p className="text-caption text-fg-3">
                <span className="font-semibold text-fg">{p.author.name}</span> · {formatRelative(p.createdAt)}
              </p>
              <RichText text={p.body} />
              <Link
                to={`/posts/${p.id}`}
                className="inline-flex min-h-11 items-center text-meta font-semibold text-brand-ink underline"
              >
                {t('habits.circle.openPost')}
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Questions({ c }: { c: CircleView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canAsk = useCan('qa:ask');
  const [title, setTitle] = useState('');
  const list = useQuery(q.circleQuestions(c.id));
  const ask = useMutation({
    mutationFn: () => api.post<QuestionView>('/questions', { title: title.trim(), circleId: c.id }),
    onSuccess: () => {
      setTitle('');
      toast.success(t('habits.circle.asked'));
      void qc.invalidateQueries({ queryKey: ['circle-questions', c.id] });
    },
    onError: fail(t),
  });
  return (
    <div className="grid gap-4">
      {c.joined && canAsk && (
        <Card className="grid gap-2 p-4">
          <Field label={t('habits.circle.ask')} hint={t('habits.circle.askHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                maxLength={150}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={title.trim().length < 10}
              loading={ask.isPending}
              onClick={() => ask.mutate()}
            >
              {t('habits.circle.askGo')}
            </Button>
            <VoiceAskButton circleId={c.id} />
          </div>
        </Card>
      )}
      {list.isLoading && <Skeleton className="h-32" />}
      {list.isSuccess && !list.data.length && <EmptyState title={t('habits.circle.noQuestions')} />}
      <ul className="grid gap-2">
        {list.data?.map((x) => (
          <li key={x.id}>
            <Card variant="interactive" className="relative grid gap-1 p-4">
              <Link to={`/questions/${x.id}`} className="font-semibold after:absolute after:inset-0">
                {x.title}
              </Link>
              <p className="text-caption text-fg-3">
                {t('habits.circle.answers', { count: x.answers })} · {formatRelative(x.createdAt)}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Events({ c }: { c: CircleView }) {
  const { t } = useTranslation();
  const canCreate = useCan('events:create');
  const list = useQuery(q.circleEvents(c.id));
  return (
    <div className="grid gap-4">
      {c.joined && canCreate && (
        <div>
          <Link to={`/events/new?circle=${c.id}`} className={buttonVariants({ variant: 'secondary' })}>
            <CalendarPlus className="size-4" aria-hidden /> {t('habits.circle.newEvent')}
          </Link>
        </div>
      )}
      {list.isLoading && <Skeleton className="h-32" />}
      {list.isSuccess && !list.data.length && <EmptyState title={t('habits.circle.noEvents')} />}
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.data?.map((e: EventView) => (
          <li key={e.id}>
            <Card variant="interactive" className="relative grid gap-1 p-4">
              <Link to={`/events/${e.id}`} className="font-semibold after:absolute after:inset-0">
                {e.title}
              </Link>
              <p className="text-meta text-fg-2">{formatDateTime(e.startsAt)}</p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One circle: join or leave, and its posts, questions and events (members only; prompt 2, G7). */
export function CirclePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (['posts', 'questions', 'events'] as const).find((x) => x === params.get('tab')) ?? 'posts';
  const circle = useQuery({ ...SCREEN, ...q.circle(id) });
  const join = useMutation({
    mutationFn: (on: boolean) => api.post<CircleView>(`/circles/${id}/${on ? 'join' : 'leave'}`),
    onSuccess: (c) => {
      qc.setQueryData(q.circle(id).queryKey, c);
      void qc.invalidateQueries({ queryKey: ['circles'] });
    },
    onError: fail(t),
  });
  if (circle.isLoading) return <Skeleton className="mx-auto h-80 w-full max-w-[860px]" />;
  if (circle.isError || !circle.data)
    return <ErrorState error={circle.error} onRetry={() => void circle.refetch()} />;
  const c = circle.data;
  return (
    <div className="mx-auto grid w-full max-w-[860px] gap-5">
      <BackLink to="/circles">{t('nav.circles')}</BackLink>
      <PageHeader
        icon={<UsersRound />}
        title={c.name}
        intro={c.description || undefined}
        actions={
          c.status === 'active' ? (
            <Button
              variant={c.joined ? 'ghost' : 'primary'}
              loading={join.isPending}
              onClick={() => join.mutate(!c.joined)}
            >
              {c.joined ? t('habits.circle.leave') : t('habits.circle.join')}
            </Button>
          ) : undefined
        }
      />
      <p className="flex flex-wrap items-center gap-2 text-meta text-fg-2">
        <Badge>{t(`habits.circles.kind.${c.kind}`)}</Badge>
        {c.status !== 'active' && <Badge tone="warning">{t(`habits.circles.status.${c.status}`)}</Badge>}
        <span>{t('habits.circles.members', { count: c.members })}</span>
      </p>
      {c.status !== 'active' ? (
        <Card className="p-4 text-meta text-fg-2">{t('habits.circle.waiting')}</Card>
      ) : !c.joined && !c.manage ? (
        <Card className="flex items-center gap-3 p-4 text-meta text-fg-2">
          <MessageCircleQuestion className="size-5 flex-none" aria-hidden /> {t('habits.circle.joinToSee')}
        </Card>
      ) : (
        <>
          <Tabs<Tab>
            label={t('habits.circle.tabs')}
            idBase="circle"
            value={tab}
            onChange={(x) => setParams(x === 'posts' ? {} : { tab: x }, { replace: true })}
            tabs={(['posts', 'questions', 'events'] as const).map((x) => ({
              id: x,
              label: t(`habits.circle.tab.${x}`),
            }))}
          />
          <TabPanel idBase="circle" id={tab}>
            {tab === 'posts' && <Posts c={c} />}
            {tab === 'questions' && <Questions c={c} />}
            {tab === 'events' && <Events c={c} />}
          </TabPanel>
        </>
      )}
    </div>
  );
}
