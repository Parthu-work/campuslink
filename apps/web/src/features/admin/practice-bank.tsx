import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles } from 'lucide-react';
import {
  PRACTICE_AREAS,
  PRACTICE_DIFFICULTIES,
  PRACTICE_DRAFTS_MAX,
  PRACTICE_TOPIC_AREAS,
  type PracticeDifficulty,
  type PracticeItemView,
  type PracticeMasteryView,
  type PracticeStatus,
  type PracticeTopic,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Select } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { Table, Td, TdNum, Th, THead } from '../../components/ui/table';
import { api, ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { useCan } from '../../lib/me';
import * as q from '../../lib/queries';
import { toast } from '../../lib/toast';
import { ItemForm } from '../practice/item-form';

type Tab = PracticeStatus | 'mastery';
type DraftKind = 'mcq' | 'numeric' | 'output_prediction';

function TopicSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: PracticeTopic;
  onChange: (t: PracticeTopic) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as PracticeTopic)}>
      {PRACTICE_AREAS.map((a) => (
        <optgroup key={a} label={t(`practice.area.${a}`)}>
          {PRACTICE_TOPIC_AREAS[a].map((x) => (
            <option key={x} value={x}>
              {t(`practice.topic.${x}`)}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

function DraftDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [topic, setTopic] = useState<PracticeTopic>('percentages');
  const [kind, setKind] = useState<DraftKind>('mcq');
  const [difficulty, setDifficulty] = useState<PracticeDifficulty>('medium');
  const [count, setCount] = useState(3);
  const draft = useMutation({
    mutationFn: () =>
      api.post<{ drafted: number; dropped: number; reason: string | null }>('/admin/practice/drafts', {
        topic,
        kind,
        difficulty,
        count,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['practice-items'] });
      if (r.reason) toast.error(t(`practice.bank.draftUnavailable.${r.reason}`));
      else toast.success(t('practice.bank.drafted', { count: r.drafted }));
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('practice.bank.draftTitle')}
      description={t('practice.bank.draftBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button variant="primary" loading={draft.isPending} onClick={() => draft.mutate()}>
            <Sparkles className="size-4" aria-hidden /> {t('practice.bank.draftGo')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('practice.form.topic')}>
          {({ id }) => <TopicSelect id={id} value={topic} onChange={setTopic} />}
        </Field>
        <Field label={t('practice.form.kind')}>
          {({ id }) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as DraftKind)}>
              {(['mcq', 'numeric', 'output_prediction'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`practice.kind.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('practice.form.difficulty')}>
          {({ id }) => (
            <Select
              id={id}
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as PracticeDifficulty)}
            >
              {PRACTICE_DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {t(`practice.difficulty.${d}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('practice.bank.count')}>
          {({ id }) => (
            <Select id={id} value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
              {Array.from({ length: PRACTICE_DRAFTS_MAX }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function ItemCard({ item: x }: { item: PracticeItemView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api.post<PracticeItemView>(`/admin/practice/items/${x.id}/decision`, { decision }),
    onSuccess: (_, decision) => {
      void qc.invalidateQueries({ queryKey: ['practice-items'] });
      toast.success(t(decision === 'approve' ? 'practice.bank.approved' : 'practice.bank.rejected'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <li>
      <Card variant="raised" className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{t(`practice.kind.${x.kind}`)}</Badge>
          <Badge>{t(`practice.topic.${x.topic}`)}</Badge>
          <Badge>{t(`practice.difficulty.${x.difficulty}`)}</Badge>
          <Badge tone={x.source === 'ai_generated' ? 'info' : 'neutral'}>
            {t(`practice.bank.source.${x.source}`)}
          </Badge>
          {x.companies.map((c) => (
            <Badge key={c} tone="brand">
              {c}
            </Badge>
          ))}
        </div>
        <p className="whitespace-pre-line font-semibold">{x.text}</p>
        {x.code && (
          <pre className="overflow-x-auto rounded-[var(--radius-md)] bg-surface-2 p-3 font-mono text-meta">
            <code>{x.code}</code>
          </pre>
        )}
        {x.kind === 'mcq' && (
          <ol className="grid gap-1 text-meta">
            {x.options.map((o, i) => (
              <li key={i} className={String(i) === x.answer ? 'font-semibold text-success-ink' : 'text-fg-2'}>
                {String.fromCharCode(65 + i)}. {o}
                {String(i) === x.answer && <span className="sr-only"> ({t('practice.bank.right')})</span>}
              </li>
            ))}
          </ol>
        )}
        {(x.kind === 'numeric' || x.kind === 'output_prediction') && (
          <p className="text-meta">
            {t('practice.bank.answer')}{' '}
            <span className="whitespace-pre-wrap font-mono font-semibold">{x.answer}</span>
          </p>
        )}
        {x.kind === 'coding' && (
          <p className="text-meta">{t('practice.bank.tests', { count: x.tests.length })}</p>
        )}
        <p className="text-meta text-fg-2">{x.explanation}</p>
        <p className="text-caption text-fg-3">
          {x.createdBy?.name
            ? t('practice.bank.by', { name: x.createdBy.name })
            : t(`practice.bank.source.${x.source}`)}{' '}
          · {formatDay(x.createdAt)}
          {x.reviewedBy?.name && <> · {t('practice.bank.reviewedBy', { name: x.reviewedBy.name })}</>}
        </p>
        <div className="flex flex-wrap gap-2">
          {x.status !== 'approved' && (
            <Button
              variant="primary"
              size="sm"
              loading={decide.isPending && decide.variables === 'approve'}
              disabled={decide.isPending}
              onClick={() => decide.mutate('approve')}
            >
              {t('practice.bank.approve')}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {t('practice.bank.edit')}
          </Button>
          {x.status !== 'rejected' && (
            <Button
              variant="ghost"
              size="sm"
              loading={decide.isPending && decide.variables === 'reject'}
              disabled={decide.isPending}
              onClick={() => decide.mutate('reject')}
            >
              {x.status === 'approved' ? t('practice.bank.retire') : t('practice.bank.reject')}
            </Button>
          )}
        </div>
      </Card>
      {editing && <ItemForm item={x} onClose={() => setEditing(false)} />}
    </li>
  );
}

function Mastery({ data }: { data: PracticeMasteryView }) {
  const { t } = useTranslation();
  if (!data.batches.length)
    return <EmptyState art={<Illustration kind="empty" />} title={t('practice.mastery.emptyTitle')} />;
  return (
    <div className="grid gap-5">
      <p className="max-w-[60ch] text-meta text-fg-2">
        {t('practice.mastery.intro', { date: formatDay(data.since) })}
      </p>
      {data.batches.map((b) => (
        <section
          key={b.gradYear ?? 'none'}
          className="grid gap-2"
          aria-label={
            b.gradYear ? t('practice.mastery.batch', { year: b.gradYear }) : t('practice.mastery.noBatch')
          }
        >
          <h3 className="text-lead font-semibold">
            {b.gradYear ? t('practice.mastery.batch', { year: b.gradYear }) : t('practice.mastery.noBatch')}{' '}
            <span className="text-meta font-normal text-fg-2">
              · {t('practice.mastery.students', { n: String(b.students) })}
            </span>
          </h3>
          <Table label={t('practice.mastery.table')}>
            <THead>
              <tr>
                <Th>{t('practice.topics.topic')}</Th>
                <Th className="text-right">{t('practice.mastery.practised')}</Th>
                <Th className="text-right">{t('practice.topics.right')}</Th>
              </tr>
            </THead>
            <tbody>
              {b.topics.map((x) => (
                <tr key={x.topic}>
                  <Td>
                    {t(`practice.topic.${x.topic}`)}
                    <span className="block text-caption text-fg-3">{t(`practice.area.${x.area}`)}</span>
                  </Td>
                  <TdNum>{String(x.students)}</TdNum>
                  <TdNum>
                    {x.accuracy === null ? '–' : t('practice.percent', { n: Math.round(x.accuracy * 100) })}
                  </TdNum>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ))}
      <p className="text-caption text-fg-3">{t('practice.mastery.suppressed')}</p>
    </div>
  );
}

/** Admin › Practice questions (prompt 2, G4): the review queue, the bank and topic mastery by batch. */
export function PracticeBankAdmin() {
  const { t } = useTranslation();
  const canCohort = useCan('analytics:cohort');
  const [tab, setTab] = useState<Tab>('pending');
  const [adding, setAdding] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const list = useQuery({
    ...q.practiceItems(tab === 'mastery' ? 'pending' : tab),
    enabled: tab !== 'mastery',
  });
  const mastery = useQuery({ ...q.practiceMastery(), enabled: tab === 'mastery' });
  const tabs: Tab[] = ['pending', 'approved', 'rejected', ...(canCohort ? (['mastery'] as const) : [])];
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[60ch] text-meta text-fg-2">{t('practice.bank.intro')}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDrafting(true)}>
            <Sparkles className="size-4" aria-hidden /> {t('practice.bank.draft')}
          </Button>
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden /> {t('practice.form.add')}
          </Button>
        </div>
      </div>
      <Tabs<Tab>
        label={t('practice.bank.byStatus')}
        idBase="practice-bank"
        value={tab}
        onChange={setTab}
        tabs={tabs.map((s) => ({ id: s, label: t(`practice.bank.tab.${s}`) }))}
      />
      <TabPanel idBase="practice-bank" id={tab}>
        {tab === 'mastery' ? (
          <>
            {mastery.isLoading && <Skeleton className="h-40" />}
            {mastery.isError && <ErrorState error={mastery.error} onRetry={() => void mastery.refetch()} />}
            {mastery.data && <Mastery data={mastery.data} />}
          </>
        ) : (
          <>
            {list.isLoading && <Skeleton className="h-40" />}
            {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
            {list.isSuccess && !list.data.length && (
              <EmptyState art={<Illustration kind="done" />} title={t(`practice.bank.none.${tab}`)} />
            )}
            {!!list.data?.length && (
              <ul className="grid gap-3">
                {list.data.map((x) => (
                  <ItemCard key={x.id} item={x} />
                ))}
              </ul>
            )}
          </>
        )}
      </TabPanel>
      {adding && <ItemForm onClose={() => setAdding(false)} />}
      {drafting && <DraftDialog onClose={() => setDrafting(false)} />}
    </div>
  );
}
