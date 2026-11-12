import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { EMPLOYER_STATUSES, type EmployerReviewView, type RevenueStatementView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Checkbox, Field, Input } from '../../components/ui/field';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { api, ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import * as nq from '../network/queries';

type Status = (typeof EMPLOYER_STATUSES)[number];
const fail = (t: (k: string) => string) => (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'));

function Review({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const v = useQuery({
    queryKey: ['platform', 'employer', id],
    queryFn: () => api.get<EmployerReviewView>(`/platform/employers/${id}`),
  });
  const decide = useMutation({
    mutationFn: (decision: string) => api.post(`/platform/employers/${id}/decision`, { decision, note }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform', 'employers'] });
      onClose();
    },
    onError: fail(t),
  });
  const e = v.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={e?.name ?? t('recruiter.platform.review')}>
      {!e ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="grid gap-3 text-callout">
          <p>
            {e.legalName} · {e.domain} · GSTIN {e.gstin}
          </p>
          <p>{e.applicant ? `${e.applicant.name} · ${e.applicant.email}` : '—'}</p>
          <p>
            {e.emailVerified ? t('recruiter.company.emailOk') : t('recruiter.company.emailPending')} ·{' '}
            {e.domainVerifiedAt
              ? t('recruiter.company.domainOk', { date: formatDay(e.domainVerifiedAt) })
              : t('recruiter.platform.domainPending')}
          </p>
          <p className="text-fg-2">{t('recruiter.platform.gstCheck')}</p>
          {e.blocks > 0 && <p>{t('recruiter.platform.blocks', { n: e.blocks })}</p>}
          <Field label={t('recruiter.platform.note')}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                value={note}
                maxLength={500}
                onChange={(x) => setNote(x.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            {e.status === 'verified' && (
              <Button size="sm" variant="primary" onClick={() => decide.mutate('approve')}>
                {t('recruiter.platform.approve')}
              </Button>
            )}
            {(e.status === 'applied' || e.status === 'verified') && (
              <Button size="sm" variant="ghost" onClick={() => decide.mutate('reject')}>
                {t('recruiter.platform.reject')}
              </Button>
            )}
            {e.status === 'approved' && (
              <Button size="sm" variant="danger" onClick={() => decide.mutate('suspend')}>
                {t('recruiter.platform.suspend')}
              </Button>
            )}
            {e.status === 'suspended' && (
              <Button size="sm" variant="outline" onClick={() => decide.mutate('reinstate')}>
                {t('recruiter.platform.reinstate')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Clusters() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const clusters = useQuery(nq.platformClusters());
  const colleges = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: () => api.get<{ id: string; branding: { displayName: string } }[]>('/platform/tenants'),
  });
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const done = () => void qc.invalidateQueries({ queryKey: ['platform', 'clusters'] });
  const save = useMutation({
    mutationFn: () => api.post('/platform/network/clusters', { name, colleges: picked }),
    onSuccess: () => {
      setName('');
      setPicked([]);
      done();
    },
    onError: fail(t),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/platform/network/clusters/${id}`),
    onSuccess: done,
    onError: fail(t),
  });
  return (
    <Card variant="raised" className="grid gap-3 p-4 sm:p-6">
      <h2 className="text-headline font-semibold">{t('recruiter.platform.clusters')}</h2>
      <ul className="grid gap-2 text-callout">
        {clusters.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>{c.name}</b>: {c.colleges.map((x) => x.name).join(', ')}
            </span>
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}>
              {t('recruiter.platform.deleteCluster')}
            </Button>
          </li>
        ))}
      </ul>
      <Field label={t('recruiter.platform.clusterName')}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-1 sm:grid-cols-2">
        {colleges.data?.map((c) => (
          <Checkbox
            key={c.id}
            id={`cl-${c.id}`}
            checked={picked.includes(c.id)}
            onChange={(on) => setPicked(on ? [...picked, c.id] : picked.filter((x) => x !== c.id))}
          >
            {c.branding.displayName}
          </Checkbox>
        ))}
      </div>
      <div>
        <Button
          disabled={name.trim().length < 2 || !picked.length}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {t('recruiter.platform.addCluster')}
        </Button>
      </div>
    </Card>
  );
}

function Revenue() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const v = useQuery({
    queryKey: ['platform', 'revenue', month],
    queryFn: () => api.get<RevenueStatementView>(`/platform/network/revenue?month=${month}`),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
  return (
    <Card variant="raised" className="grid gap-3 p-4 sm:p-6">
      <h2 className="text-headline font-semibold">{t('recruiter.platform.revenue')}</h2>
      <Field label={t('recruiter.platform.month')}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        )}
      </Field>
      {v.data && v.data.colleges.length === 0 && (
        <p className="text-callout text-fg-2">{t('recruiter.platform.noRevenue')}</p>
      )}
      <ul className="grid gap-1 text-callout">
        {v.data?.colleges.map((c) => (
          <li key={c.id}>
            {t('recruiter.platform.revenueRow', {
              name: c.name,
              postings: c.postings,
              drives: c.drives,
              hires: c.hires,
              share: `₹${(c.share / 100).toLocaleString('en-IN')}`,
            })}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** `/platform/employers` (prompt 2, G12): the employer registry, clusters and the colleges' share. */
export function PlatformEmployers() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('verified');
  const [open, setOpen] = useState<string | null>(null);
  const v = useQuery({ ...SCREEN, ...nq.platformEmployers(status) });
  return (
    <div className="grid gap-5">
      <PageHeader
        title={t('recruiter.platform.title')}
        icon={<Building2 />}
        intro={t('recruiter.platform.intro')}
      />
      <ChoiceGroup
        label={t('recruiter.company.status')}
        variant="chip"
        scroll
        value={status}
        options={EMPLOYER_STATUSES.map((s) => ({ value: s, label: t(`recruiter.employerStatus.${s}`) }))}
        onChange={setStatus}
      />
      {v.isError && <ErrorState error={v.error} onRetry={() => void v.refetch()} />}
      {!v.data && !v.isError && <Skeleton className="h-32" />}
      {v.data?.length === 0 && <EmptyState icon={<Building2 />} title={t('recruiter.platform.none')} />}
      <ul className="grid gap-3">
        {v.data?.map((e) => (
          <li key={e.id}>
            <Card variant="raised" className="flex flex-wrap items-center justify-between gap-2 p-4">
              <span className="grid gap-1 text-callout">
                <b>{e.name}</b>
                <span className="text-fg-2">
                  {e.domain} · {formatDay(e.createdAt)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={e.status === 'approved' ? 'success' : 'info'}>
                  {t(`recruiter.employerStatus.${e.status}`)}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => setOpen(e.id)}>
                  {t('recruiter.platform.review')}
                </Button>
              </span>
            </Card>
          </li>
        ))}
      </ul>
      <Clusters />
      <Revenue />
      {open && <Review id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
