import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  BRANCHES,
  INTERVIEW_DIFFICULTIES,
  type Branch,
  type InterviewDifficulty,
  type InterviewQuestionStatus,
  type InterviewQuestionView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { api, ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import * as q from '../../lib/queries';
import { toast } from '../../lib/toast';

const fail = (t: (k: string) => string) => (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'));

function AddQuestion({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [track, setTrack] = useState<'hr' | 'technical'>('technical');
  const [branch, setBranch] = useState<Branch | ''>('');
  const [difficulty, setDifficulty] = useState<InterviewDifficulty>('medium');
  const [topic, setTopic] = useState('');
  const [text, setText] = useState('');
  const [rubric, setRubric] = useState('');
  const [error, setError] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api.post<InterviewQuestionView>('/admin/interview-questions', {
        track,
        branch: track === 'technical' && branch ? branch : null,
        difficulty,
        topic: topic.trim(),
        text: text.trim(),
        rubric: rubric.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['interview-questions'] });
      toast.success(t('interviews.bank.added'));
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const ready = topic.trim().length >= 2 && text.trim().length >= 10 && rubric.trim().length >= 10;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('interviews.bank.addTitle')}
      description={t('interviews.bank.addBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            type="submit"
            form="question-add"
            loading={add.isPending}
            disabled={!ready}
          >
            {t('interviews.bank.add')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <form
        id="question-add"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) add.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('interviews.start.track')}>
            {({ id }) => (
              <Select id={id} value={track} onChange={(e) => setTrack(e.target.value as 'hr' | 'technical')}>
                <option value="hr">{t('interviews.track.hr')}</option>
                <option value="technical">{t('interviews.track.technical')}</option>
              </Select>
            )}
          </Field>
          {track === 'technical' && (
            <Field label={t('interviews.start.branch')}>
              {({ id }) => (
                <Select id={id} value={branch} onChange={(e) => setBranch(e.target.value as Branch | '')}>
                  <option value="">{t('interviews.bank.anyBranch')}</option>
                  {BRANCHES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label={t('interviews.start.difficulty')}>
            {({ id }) => (
              <Select
                id={id}
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as InterviewDifficulty)}
              >
                {INTERVIEW_DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {t(`interviews.difficulty.${d}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label={t('interviews.bank.topic')}>
          {({ id }) => (
            <Input id={id} maxLength={60} value={topic} onChange={(e) => setTopic(e.target.value)} />
          )}
        </Field>
        <Field label={t('interviews.bank.question')}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={400}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('interviews.bank.rubric')} hint={t('interviews.bank.rubricHint')}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              maxLength={400}
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
            />
          )}
        </Field>
        {error && (
          <p role="alert" className="text-meta font-medium text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function QuestionCard({ question: x }: { question: InterviewQuestionView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState(x.text);
  const [rubric, setRubric] = useState(x.rubric);
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api.post<InterviewQuestionView>(`/admin/interview-questions/${x.id}/decision`, {
        decision,
        ...(decision === 'approve' && text.trim() !== x.text ? { text: text.trim() } : {}),
        ...(decision === 'approve' && rubric.trim() !== x.rubric ? { rubric: rubric.trim() } : {}),
      }),
    onSuccess: (_, decision) => {
      void qc.invalidateQueries({ queryKey: ['interview-questions'] });
      toast.success(t(decision === 'approve' ? 'interviews.bank.approved' : 'interviews.bank.rejected'));
    },
    onError: fail(t),
  });
  const pending = x.status === 'pending';
  return (
    <li>
      <Card variant="raised" className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{t(`interviews.track.${x.track}`)}</Badge>
          {x.branch && <Badge>{x.branch}</Badge>}
          <Badge>{t(`interviews.difficulty.${x.difficulty}`)}</Badge>
          <Badge tone={x.source === 'ai_generated' ? 'info' : 'neutral'}>
            {t(`interviews.bank.source.${x.source}`)}
          </Badge>
          <span className="text-caption text-fg-3">
            {x.topic} · {formatDay(x.createdAt)}
          </span>
        </div>
        {pending ? (
          <>
            <Field label={t('interviews.bank.question')}>
              {({ id }) => (
                <Textarea
                  id={id}
                  rows={2}
                  maxLength={400}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('interviews.bank.rubric')}>
              {({ id }) => (
                <Textarea
                  id={id}
                  rows={2}
                  maxLength={400}
                  value={rubric}
                  onChange={(e) => setRubric(e.target.value)}
                />
              )}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                loading={decide.isPending && decide.variables === 'approve'}
                disabled={decide.isPending || text.trim().length < 10 || rubric.trim().length < 10}
                onClick={() => decide.mutate('approve')}
              >
                {t('interviews.bank.approve')}
              </Button>
              <Button
                variant="ghost"
                loading={decide.isPending && decide.variables === 'reject'}
                disabled={decide.isPending}
                onClick={() => decide.mutate('reject')}
              >
                {t('interviews.bank.reject')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="font-semibold">{x.text}</p>
            <p className="text-meta text-fg-2">{x.rubric}</p>
            {x.reviewedBy && (
              <p className="text-caption text-fg-3">
                {t('interviews.bank.reviewedBy', { name: x.reviewedBy.name })}
              </p>
            )}
          </>
        )}
      </Card>
    </li>
  );
}

/** Admin › Interview questions (prompt 2, G3): the college's bank and the AI questions awaiting review. */
export function InterviewQuestionsAdmin() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<InterviewQuestionStatus>('pending');
  const [adding, setAdding] = useState(false);
  const list = useQuery(q.interviewQuestions(status));
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[60ch] text-meta text-fg-2">{t('interviews.bank.intro')}</p>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden /> {t('interviews.bank.add')}
        </Button>
      </div>
      <Tabs<InterviewQuestionStatus>
        label={t('interviews.bank.byStatus')}
        idBase="questions"
        value={status}
        onChange={setStatus}
        tabs={(['pending', 'approved', 'rejected'] as const).map((s) => ({
          id: s,
          label: t(`interviews.bank.status.${s}`),
        }))}
      />
      <TabPanel idBase="questions" id={status}>
        {list.isLoading && <Skeleton className="h-40" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.isSuccess && !list.data.length && (
          <EmptyState art={<Illustration kind="done" />} title={t(`interviews.bank.none.${status}`)} />
        )}
        {!!list.data?.length && (
          <ul className="grid gap-3">
            {list.data.map((x) => (
              <QuestionCard key={x.id} question={x} />
            ))}
          </ul>
        )}
      </TabPanel>
      {adding && <AddQuestion onClose={() => setAdding(false)} />}
    </div>
  );
}
