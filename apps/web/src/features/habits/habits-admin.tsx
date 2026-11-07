import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import type { BuddyBoardView, CircleView, PublicProfile } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { api, ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import * as q from '../../lib/queries';
import { toast } from '../../lib/toast';
import { CircleCard } from './circles';

const fail = (t: (k: string) => string) => (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'));

function Nominate() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const found = useQuery({
    queryKey: ['peer-nominee-search', search.trim()],
    queryFn: () =>
      api.get<PublicProfile[]>(`/directory?role=STUDENT&limit=10&q=${encodeURIComponent(search.trim())}`),
    enabled: search.trim().length >= 2,
  });
  const nominate = useMutation({
    mutationFn: (userId: string) => api.post('/admin/peers/nominations', { userId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-peers'] });
      toast.success(t('habits.admin.nominated'));
      setSearch('');
    },
    onError: fail(t),
  });
  return (
    <Card className="grid gap-3 p-4">
      <h3 className="font-semibold">{t('habits.admin.nominateTitle')}</h3>
      <p className="text-callout text-fg-2">{t('habits.admin.nominateBody')}</p>
      <Field label={t('habits.admin.find')}>
        {({ id }) => (
          <Input id={id} maxLength={80} value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
      </Field>
      {!!found.data?.length && (
        <ul className="grid gap-1">
          {found.data.map((p) => (
            <li key={p.userId} className="flex min-h-11 items-center justify-between gap-2">
              <span>
                {p.name}
                <span className="text-caption text-fg-3">
                  {' '}
                  {[p.fields.branch, p.fields.gradYear].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                loading={nominate.isPending && nominate.variables === p.userId}
                onClick={() => nominate.mutate(p.userId)}
              >
                <UserPlus className="size-4" aria-hidden /> {t('habits.admin.nominate')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Admin › Peer mentors and buddies (prompt 2, G7). */
export function PeersAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const data = useQuery(q.adminPeers());
  const match = useMutation({
    mutationFn: () => api.post<{ matched: number; waiting: number }>('/admin/peers/match-buddies'),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['admin-peers'] });
      toast.success(t('habits.admin.matched', { n: r.matched, waiting: r.waiting }));
    },
    onError: fail(t),
  });
  const withdraw = useMutation({
    mutationFn: (userId: string) => api.post('/admin/peers/nominations', { userId, on: false }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-peers'] }),
    onError: fail(t),
  });
  if (data.isLoading) return <Skeleton className="h-64" />;
  if (data.isError || !data.data)
    return <ErrorState error={data.error} onRetry={() => void data.refetch()} />;
  const b: BuddyBoardView = data.data.buddies;
  return (
    <div className="grid gap-5">
      <p className="max-w-[60ch] text-callout text-fg-2">{t('habits.admin.intro')}</p>
      <section aria-labelledby="buddies-admin" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="buddies-admin" className="text-headline font-semibold">
            {t('habits.admin.buddies')}
          </h2>
          <Button variant="secondary" loading={match.isPending} onClick={() => match.mutate()}>
            {t('habits.admin.matchNow')}
          </Button>
        </div>
        <StatGrid>
          <StatCard label={t('habits.admin.firstYears')} value={String(b.firstYears)} />
          <StatCard label={t('habits.admin.matchedCount')} value={String(b.matched)} />
          <StatCard label={t('habits.admin.waiting')} value={String(b.waiting)} />
          <StatCard label={t('habits.admin.volunteers')} value={String(b.volunteers)} />
        </StatGrid>
        <p className="text-caption text-fg-3">{t('habits.admin.matchDaily')}</p>
      </section>
      <section aria-labelledby="peers-admin" className="grid gap-3">
        <h2 id="peers-admin" className="text-headline font-semibold">
          {t('habits.admin.nominations')}
        </h2>
        <Nominate />
        {!data.data.nominations.length ? (
          <EmptyState icon={<Users className="size-6" />} title={t('habits.admin.noNominations')} />
        ) : (
          <ul className="grid gap-2">
            {data.data.nominations.map((n) => (
              <li key={n.userId}>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="grid">
                    <span className="font-semibold">{n.name}</span>
                    <span className="text-caption text-fg-3">
                      {[n.branch, n.gradYear].filter(Boolean).join(' · ')} · {formatDay(n.nominatedAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {n.active && <Badge tone="success">{t('habits.admin.mentoring')}</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => withdraw.mutate(n.userId)}>
                      {t('habits.admin.withdraw')}
                    </Button>
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Admin › Circles: proposals to approve, and active circles to archive (prompt 2, G7). */
export function CirclesAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const pending = useQuery(q.circles('pending'));
  const active = useQuery(q.circles('discover'));
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' | 'archive' }) =>
      api.post<CircleView>(`/admin/circles/${id}/decision`, { decision }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['circles'] }),
    onError: fail(t),
  });
  return (
    <div className="grid gap-5">
      <p className="max-w-[60ch] text-callout text-fg-2">{t('habits.admin.circlesIntro')}</p>
      <section aria-labelledby="circles-pending" className="grid gap-3">
        <h2 id="circles-pending" className="text-headline font-semibold">
          {t('habits.admin.pending')}
        </h2>
        {pending.isLoading && <Skeleton className="h-24" />}
        {pending.isSuccess && !pending.data.length && (
          <p className="text-callout text-fg-2">{t('habits.admin.noPending')}</p>
        )}
        <ul className="grid gap-2">
          {pending.data?.map((c) => (
            <li key={c.id}>
              <Card className="grid gap-2 p-4">
                <span className="font-semibold">{c.name}</span>
                <span className="text-callout text-fg-2">
                  {t(`habits.circles.kind.${c.kind}`)}
                  {c.createdBy?.name ? ` · ${t('habits.admin.by', { name: c.createdBy.name })}` : ''}
                </span>
                {c.description && <p className="text-callout">{c.description}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => decide.mutate({ id: c.id, decision: 'approve' })}
                  >
                    {t('habits.admin.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => decide.mutate({ id: c.id, decision: 'reject' })}
                  >
                    {t('habits.admin.reject')}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="circles-active" className="grid gap-3">
        <h2 id="circles-active" className="text-headline font-semibold">
          {t('habits.admin.active')}
        </h2>
        {active.isSuccess && !active.data.length && (
          <p className="text-callout text-fg-2">{t('habits.admin.noActive')}</p>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {active.data?.map((c) => (
            <CircleCard key={c.id} c={c} />
          ))}
        </ul>
      </section>
    </div>
  );
}
