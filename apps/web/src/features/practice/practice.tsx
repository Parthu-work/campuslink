import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Dumbbell, Flame, PenLine, PlayCircle } from 'lucide-react';
import { PRACTICE_SET_SIZE, type PracticeHomeView, type PracticeSetView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { ProgressBar } from '../../components/ui/progress';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Table, Td, TdNum, Th, THead } from '../../components/ui/table';
import { api, ApiError } from '../../lib/api';
import { formatDay, newIdempotencyKey } from '../../lib/format';
import { useCan } from '../../lib/me';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { ItemForm } from './item-form';

/** Starts today's set (or resumes it), or a company prep set, and opens it. */
function useStart() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [key, setKey] = useState(newIdempotencyKey);
  return useMutation({
    mutationFn: (company: string | null) =>
      api.postOnce<PracticeSetView>(
        '/practice/sets',
        company ? { company } : {},
        `${key}-${company ?? 'daily'}`,
      ),
    onSuccess: (s) => {
      setKey(newIdempotencyKey());
      qc.setQueryData(q.practiceSet(s.id).queryKey, s);
      void qc.invalidateQueries({ queryKey: ['practice'] });
      void navigate(`/practice/sets/${s.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
}

function Today({ home, start }: { home: PracticeHomeView; start: ReturnType<typeof useStart> }) {
  const { t } = useTranslation();
  const { today } = home;
  const started = !!today.setId;
  return (
    <Card variant="raised" className="grid gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-title font-semibold">{t('practice.today.title')}</h2>
          <p className="max-w-[60ch] text-meta text-fg-2">
            {t('practice.today.body', { count: PRACTICE_SET_SIZE })}
          </p>
        </div>
        {home.streak > 0 && (
          <Badge tone="accent" className="gap-1">
            <Flame className="size-4" aria-hidden /> {t('practice.streak', { count: home.streak })}
          </Badge>
        )}
      </div>
      {started && (
        <ProgressBar
          value={today.answered}
          max={today.size}
          label={t('practice.today.progress')}
          valueText={t('practice.answeredOf', { n: today.answered, total: today.size })}
          tone={today.completed ? 'success' : 'brand'}
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        {today.completed && today.setId ? (
          <>
            <p className="font-semibold text-success-ink">{t('practice.today.done')}</p>
            <Link
              className="inline-flex min-h-11 items-center text-meta font-semibold text-brand-ink underline"
              to={`/practice/sets/${today.setId}`}
            >
              {t('practice.today.review')}
            </Link>
          </>
        ) : (
          <Button
            variant="primary"
            size="lg"
            loading={start.isPending && start.variables === null}
            onClick={() => start.mutate(null)}
          >
            <PlayCircle className="size-5" aria-hidden />{' '}
            {started ? t('practice.today.continue') : t('practice.today.start')}
          </Button>
        )}
      </div>
      <p className="text-caption text-fg-3">{t('practice.english')}</p>
    </Card>
  );
}

function Topics({ home }: { home: PracticeHomeView }) {
  const { t } = useTranslation();
  const scored = home.topics.filter((x) => x.accuracy !== null);
  const weakest = scored.find((x) => x.weak);
  return (
    <section aria-labelledby="practice-topics" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="practice-topics" className="text-title font-semibold">
          {t('practice.topics.title')}
        </h2>
        <p className="text-meta text-fg-2">{t('practice.topics.intro')}</p>
      </div>
      <StatGrid>
        <StatCard label={t('practice.stats.streak')} value={t('practice.days', { count: home.streak })} />
        <StatCard label={t('practice.stats.month')} value={t('practice.days', { count: home.days.length })} />
        <StatCard
          label={t('practice.stats.focus')}
          value={weakest ? t(`practice.topic.${weakest.topic}`) : t('practice.stats.noFocus')}
        />
      </StatGrid>
      {!home.topics.length ? (
        <EmptyState art={<Illustration kind="empty" />} title={t('practice.topics.emptyTitle')}>
          {t('practice.topics.emptyBody')}
        </EmptyState>
      ) : (
        <Table label={t('practice.topics.table')}>
          <THead>
            <tr>
              <Th>{t('practice.topics.topic')}</Th>
              <Th className="text-right">{t('practice.topics.answered')}</Th>
              <Th>{t('practice.topics.right')}</Th>
            </tr>
          </THead>
          <tbody>
            {home.topics.map((x) => (
              <tr key={x.topic}>
                <Td>
                  <span className="font-semibold">{t(`practice.topic.${x.topic}`)}</span>
                  <span className="block text-caption text-fg-3">{t(`practice.area.${x.area}`)}</span>
                </Td>
                <TdNum>{x.attempts}</TdNum>
                <Td>
                  {x.accuracy === null ? (
                    <span className="text-caption text-fg-3">{t('practice.topics.few')}</span>
                  ) : (
                    <div className="grid min-w-32 gap-1">
                      <span className="text-meta">
                        {t('practice.percent', { n: Math.round(x.accuracy * 100) })}
                        {x.weak && <span className="text-warning-ink"> · {t('practice.topics.weak')}</span>}
                      </span>
                      <ProgressBar value={x.accuracy} size="sm" tone={x.weak ? 'warning' : 'success'} />
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

function Companies({ home, start }: { home: PracticeHomeView; start: ReturnType<typeof useStart> }) {
  const { t } = useTranslation();
  const seniors = useCan('companies:view');
  return (
    <section aria-labelledby="practice-companies" className="grid gap-3">
      <div className="grid gap-1">
        <h2 id="practice-companies" className="text-title font-semibold">
          {t('practice.companies.title')}
        </h2>
        <p className="text-meta text-fg-2">
          {home.companySetsLeft
            ? t('practice.companies.intro', { count: home.companySetsLeft })
            : t('practice.companies.noneLeft')}
        </p>
      </div>
      {!home.companies.length ? (
        <EmptyState art={<Illustration kind="empty" />} title={t('practice.companies.emptyTitle')}>
          {t('practice.companies.emptyBody')}
        </EmptyState>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {home.companies.map((c) => (
            <li key={c.key}>
              <Card variant="raised" className="grid h-full gap-3 p-4">
                <div className="grid gap-1">
                  <p className="flex items-center gap-2 font-semibold">
                    <Building2 className="size-4 text-fg-3" aria-hidden /> {c.name}
                  </p>
                  <p className="text-meta text-fg-2">
                    {t('practice.companies.items', { count: c.items })}
                    {c.nextDriveCloses && (
                      <> · {t('practice.companies.closes', { date: formatDay(c.nextDriveCloses) })}</>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Button
                    variant="secondary"
                    disabled={!home.companySetsLeft || start.isPending}
                    loading={start.isPending && start.variables === c.key}
                    onClick={() => start.mutate(c.key)}
                  >
                    {t('practice.companies.go', { company: c.name })}
                  </Button>
                  {/* Prompt 2, G10: the company's page with seniors' interview write-ups. */}
                  {seniors && (
                    <Link
                      to={`/companies/${encodeURIComponent(c.key)}`}
                      className="inline-flex min-h-11 items-center text-meta font-semibold text-brand-ink hover:underline"
                    >
                      {t('practice.companies.seniors', { company: c.name })}
                    </Link>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Aptitude and coding practice (prompt 2, G4): today's set, topic accuracy and company prep. */
export function PracticePage() {
  const { t } = useTranslation();
  const home = useQuery({ ...SCREEN, ...q.practice() });
  const start = useStart();
  const canWrite = useCan('practice:author');
  const [writing, setWriting] = useState(false);
  return (
    <div className="mx-auto grid w-full max-w-[960px] gap-6">
      <PageHeader
        icon={<Dumbbell />}
        title={t('nav.practice')}
        intro={t('practice.intro')}
        actions={
          canWrite ? (
            <Button variant="secondary" onClick={() => setWriting(true)}>
              <PenLine className="size-4" aria-hidden /> {t('practice.write')}
            </Button>
          ) : undefined
        }
      />
      {home.isLoading && <Skeleton className="h-80 rounded-[var(--radius-lg)]" />}
      {home.isError && <ErrorState error={home.error} onRetry={() => void home.refetch()} />}
      {home.data && (
        <>
          <Today home={home.data} start={start} />
          {home.data.mineWaiting > 0 && (
            <p className="text-meta text-fg-2">
              {t('practice.mineWaiting', { count: home.data.mineWaiting })}
            </p>
          )}
          <Topics home={home.data} />
          <Companies home={home.data} start={start} />
          {!home.data.runner && <p className="text-caption text-fg-3">{t('practice.noRunner')}</p>}
        </>
      )}
      {writing && <ItemForm onClose={() => setWriting(false)} />}
    </div>
  );
}
