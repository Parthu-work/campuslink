import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExperienceView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { loadPack } from '../../i18n';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { Checkbox, Field, Textarea } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { api, ApiError } from '../../lib/api';
import { useCan } from '../../lib/me';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { ExperienceCard } from './experience-card';
import { experienceQueue } from './experience-queries';

type Status = 'pending' | 'published' | 'rejected';
/** The practice question form (G4) loads only when a reviewer writes one, with its own strings. */
const ItemForm = lazy(() =>
  Promise.all([import('../practice/item-form'), loadPack('practice')]).then(([m]) => ({
    default: m.ItemForm,
  })),
);
/** Questions from interview rounds usually suit the mock interview bank; tests suit practice. */
const BANK_KINDS = new Set(['technical', 'hr', 'group_discussion', 'other']);

function Review({ e }: { e: ExperienceView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [bank, setBank] = useState<Set<string>>(
    () =>
      new Set(
        e.rounds.flatMap((r, ri) =>
          BANK_KINDS.has(r.kind) ? r.questions.map((_, qi) => `${ri}:${qi}`) : [],
        ),
      ),
  );
  const [sending, setSending] = useState(false);
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api.post<ExperienceView>(`/admin/experiences/${e.id}/decision`, {
        decision,
        ...(decision === 'reject'
          ? { reason: reason.trim() }
          : {
              bank: [...bank].map((k) => {
                const [round, question] = k.split(':').map(Number);
                return { round, question };
              }),
            }),
      }),
    onSuccess: (_, decision) => {
      void qc.invalidateQueries({ queryKey: ['experiences'] });
      toast.success(t(decision === 'approve' ? 'moat.admin.published' : 'moat.admin.sentBack'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('errors.generic')),
  });
  const toggle = (k: string, on: boolean) =>
    setBank((s) => {
      const n = new Set(s);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
  return (
    <ExperienceCard
      e={e}
      reviewer
      questionAction={(ri, qi) => (
        <Checkbox
          id={`bank-${e.id}-${ri}-${qi}`}
          checked={bank.has(`${ri}:${qi}`)}
          onChange={(v) => toggle(`${ri}:${qi}`, v)}
        >
          {t('moat.admin.toBank')}
        </Checkbox>
      )}
      actions={
        <div className="grid gap-3">
          {sending && (
            <Field label={t('moat.admin.reason')}>
              {({ id }) => (
                <Textarea
                  id={id}
                  rows={2}
                  maxLength={300}
                  value={reason}
                  onChange={(ev) => setReason(ev.target.value)}
                />
              )}
            </Field>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              disabled={sending && reason.trim().length < 5}
              loading={decide.isPending && decide.variables === 'reject'}
              onClick={() => (sending ? decide.mutate('reject') : setSending(true))}
            >
              {t('moat.admin.sendBack')}
            </Button>
            <Button
              variant="primary"
              loading={decide.isPending && decide.variables === 'approve'}
              onClick={() => decide.mutate('approve')}
            >
              {t('moat.admin.publish')}
            </Button>
          </div>
        </div>
      }
    />
  );
}

function Published({ e }: { e: ExperienceView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canWrite = useCan('practice:author');
  const [writing, setWriting] = useState<{ round: number; question: number; text: string } | null>(null);
  const mark = useMutation({
    mutationFn: (w: { round: number; question: number }) =>
      api.post(`/admin/experiences/${e.id}/practice`, w),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['experiences'] }),
  });
  return (
    <>
      <ExperienceCard
        e={e}
        reviewer
        questionAction={(ri, qi) => {
          const question = e.rounds[ri]?.questions[qi];
          return canWrite && question && !question.sent ? (
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => setWriting({ round: ri, question: qi, text: question.text })}
            >
              {t('moat.admin.practice')}
            </Button>
          ) : null;
        }}
      />
      {writing && (
        <Suspense fallback={null}>
          <ItemForm
            prefill={{ text: writing.text, companies: [e.company.name] }}
            onSaved={() => mark.mutate({ round: writing.round, question: writing.question })}
            onClose={() => setWriting(null)}
          />
        </Suspense>
      )}
    </>
  );
}

/** Admin › Interview write-ups (prompt 2, G10): review before juniors read them. */
export function ExperiencesAdmin() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const status =
    (['pending', 'published', 'rejected'] as const).find((s) => s === params.get('tab')) ?? 'pending';
  const list = useQuery({ ...SCREEN, ...experienceQueue(status) });
  return (
    <div className="grid gap-5">
      <PageHeader title={t('admin.experiences')} intro={t('moat.admin.intro')} />
      <Tabs<Status>
        label={t('moat.admin.tabs')}
        idBase="experiences"
        value={status}
        onChange={(s) => setParams(s === 'pending' ? {} : { tab: s }, { replace: true })}
        tabs={(['pending', 'published', 'rejected'] as const).map((s) => ({
          id: s,
          label: t(`moat.admin.tab.${s}`),
        }))}
      />
      <TabPanel idBase="experiences" id={status}>
        {list.isLoading && <Skeleton className="h-48" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && !list.data.length && (
          <EmptyState art={<Illustration kind="done" />} title={t('moat.admin.none')} />
        )}
        {!!list.data?.length && (
          <ul className="grid gap-3">
            {list.data.map((e) => (
              <li key={e.id}>
                {status === 'pending' ? (
                  <Review e={e} />
                ) : status === 'published' ? (
                  <Published e={e} />
                ) : (
                  <ExperienceCard e={e} reviewer />
                )}
              </li>
            ))}
          </ul>
        )}
      </TabPanel>
    </div>
  );
}
