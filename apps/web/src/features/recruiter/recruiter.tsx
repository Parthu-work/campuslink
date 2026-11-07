import { useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Building2, FileText, Gauge, Plus, Send, Users } from 'lucide-react';
import {
  BRANCHES,
  POSTING_TYPES,
  SEEKING,
  type Branch,
  type CandidateReadinessView,
  type CandidateView,
  type EmployerView,
  type PostingType,
  type PostingView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { ChoiceGroup } from '../../components/ui/choice-group';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/field';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { api, apiBlob, ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { useCan } from '../../lib/me';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import * as nq from '../network/queries';

type Tab = 'postings' | 'pool' | 'company';
const TABS: readonly Tab[] = ['postings', 'pool', 'company'];
const useFail = () => {
  const { t } = useTranslation();
  return (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
};
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

function NewPosting({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fail = useFail();
  const [f, setF] = useState(() => ({
    title: '',
    role: '',
    type: 'full_time' as PostingType,
    location: '',
    ctcRange: '',
    description: '',
    branches: [] as Branch[],
    gradYears: '',
    closesAt: new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10),
  }));
  const create = useMutation({
    mutationFn: () =>
      api.post('/employer/postings', {
        ...f,
        gradYears: f.gradYears
          .split(',')
          .map((x) => Number(x.trim()))
          .filter((n) => n > 1950),
        closesAt: new Date(`${f.closesAt}T18:29:00.000Z`).toISOString(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employer', 'postings'] });
      onClose();
    },
    onError: fail,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('recruiter.new.title')}
      description={t('recruiter.new.body')}
      footer={
        <Button variant="primary" type="submit" form="new-posting" loading={create.isPending}>
          {t('recruiter.new.save')}
        </Button>
      }
    >
      <form id="new-posting" onSubmit={submit} className="grid gap-4">
        <Field label={t('recruiter.new.titleField')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              required
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('recruiter.new.role')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              required
              value={f.role}
              onChange={(e) => setF({ ...f, role: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('recruiter.new.type')}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={f.type}
              onChange={(e) => setF({ ...f, type: e.target.value as PostingType })}
            >
              {POSTING_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`network.postingTypes.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('recruiter.new.location')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              required
              value={f.location}
              onChange={(e) => setF({ ...f, location: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('recruiter.new.ctc')} hint={t('recruiter.new.ctcHint')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={f.ctcRange}
              maxLength={60}
              onChange={(e) => setF({ ...f, ctcRange: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('recruiter.new.description')}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              required
              minLength={20}
              rows={5}
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          )}
        </Field>
        <fieldset className="grid gap-1">
          <legend className="text-meta font-semibold">{t('recruiter.new.branches')}</legend>
          <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-3">
            {BRANCHES.map((b) => (
              <Checkbox
                key={b}
                id={`branch-${b}`}
                checked={f.branches.includes(b)}
                onChange={(on) =>
                  setF({ ...f, branches: on ? [...f.branches, b] : f.branches.filter((x) => x !== b) })
                }
              >
                {b}
              </Checkbox>
            ))}
          </div>
        </fieldset>
        <Field label={t('recruiter.new.years')} hint={t('recruiter.new.yearsHint')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              inputMode="numeric"
              value={f.gradYears}
              onChange={(e) => setF({ ...f, gradYears: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('recruiter.new.closes')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              type="date"
              required
              value={f.closesAt}
              onChange={(e) => setF({ ...f, closesAt: e.target.value })}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function PublishDialog({ p, onClose }: { p: PostingView; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fail = useFail();
  const c = useQuery(nq.employerColleges());
  const [mode, setMode] = useState<'colleges' | 'cluster'>('colleges');
  const [picked, setPicked] = useState<string[]>([]);
  const [cluster, setCluster] = useState('');
  const publish = useMutation({
    mutationFn: () =>
      api.post(
        `/employer/postings/${p.id}/publish`,
        mode === 'cluster' ? { clusterId: cluster } : { colleges: picked },
      ),
    onSuccess: () => {
      toast.success(t('recruiter.publish.done'));
      void qc.invalidateQueries({ queryKey: ['employer', 'postings'] });
      onClose();
    },
    onError: fail,
  });
  const already = new Set(p.colleges.map((x) => x.id));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('recruiter.publish.title')}
      description={t('recruiter.publish.body')}
      footer={
        <Button
          variant="primary"
          disabled={mode === 'cluster' ? !cluster : !picked.length}
          loading={publish.isPending}
          onClick={() => publish.mutate()}
        >
          <Send className="size-4" aria-hidden /> {t('recruiter.publish.send')}
        </Button>
      }
    >
      {!c.data ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="grid gap-3">
          {c.data.clusters.length > 0 && (
            <ChoiceGroup
              label={t('recruiter.publish.mode')}
              variant="chip"
              value={mode}
              options={[
                { value: 'colleges', label: t('recruiter.publish.colleges') },
                { value: 'cluster', label: t('recruiter.publish.cluster') },
              ]}
              onChange={setMode}
            />
          )}
          {mode === 'cluster' ? (
            <Field label={t('recruiter.publish.cluster')}>
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  value={cluster}
                  onChange={(e) => setCluster(e.target.value)}
                >
                  <option value="">—</option>
                  {c.data.clusters.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.colleges.length})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : c.data.colleges.length === 0 ? (
            <p className="text-meta text-fg-2">{t('recruiter.publish.noColleges')}</p>
          ) : (
            <div className="grid gap-1">
              {c.data.colleges.map((x) => (
                <Checkbox
                  key={x.id}
                  id={`college-${x.id}`}
                  checked={already.has(x.id) || picked.includes(x.id)}
                  onChange={(on) => setPicked(on ? [...picked, x.id] : picked.filter((y) => y !== x.id))}
                >
                  {x.name}
                  {x.city ? ` · ${x.city}` : ''}
                </Checkbox>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Postings({ approved }: { approved: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fail = useFail();
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState<PostingView | null>(null);
  const v = useQuery(nq.employerPostings());
  const close = useMutation({
    mutationFn: (id: string) => api.post(`/employer/postings/${id}/close`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['employer', 'postings'] }),
    onError: fail,
  });
  if (v.isError) return <ErrorState error={v.error} onRetry={() => void v.refetch()} />;
  if (!v.data) return <Skeleton className="h-40" />;
  return (
    <div className="grid gap-4">
      <div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden /> {t('recruiter.new.open')}
        </Button>
      </div>
      {v.data.length === 0 && <EmptyState icon={<Briefcase />} title={t('recruiter.postings.none')} />}
      <ul className="grid gap-3">
        {v.data.map((p) => (
          <li key={p.id}>
            <Card variant="raised" className="grid gap-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-body font-semibold">{p.title}</h3>
                <Badge tone={p.status === 'published' ? 'success' : 'neutral'}>
                  {t(`recruiter.status.${p.status}`)}
                </Badge>
              </div>
              <p className="text-meta text-fg-2">
                {[p.role, p.location, p.ctcRange].filter(Boolean).join(' · ')}
              </p>
              <p className="text-caption text-fg-3">
                {t('network.admin.closes', { date: formatDay(p.closesAt) })}
              </p>
              {p.colleges.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label={t('recruiter.postings.colleges')}>
                  {p.colleges.map((c) => (
                    <li key={c.id}>
                      <Badge
                        tone={
                          c.decision === 'approved'
                            ? 'success'
                            : c.decision === 'pending'
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {c.name}: {t(`network.decisions.${c.decision}`)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {p.status !== 'closed' && (
                  <Button size="sm" variant="primary" disabled={!approved} onClick={() => setPublishing(p)}>
                    <Send className="size-4" aria-hidden /> {t('recruiter.publish.open')}
                  </Button>
                )}
                {p.colleges.some((c) => c.decision === 'approved') && (
                  <IntentLink
                    to={`/recruiter/postings/${p.id}`}
                    className="inline-flex min-h-11 items-center gap-1.5 text-meta font-semibold text-brand-ink underline"
                  >
                    <Users className="size-4" aria-hidden /> {t('recruiter.postings.candidates')}
                  </IntentLink>
                )}
                {p.status !== 'closed' && (
                  <Button size="sm" variant="ghost" onClick={() => close.mutate(p.id)}>
                    {t('recruiter.postings.close')}
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {creating && <NewPosting onClose={() => setCreating(false)} />}
      {publishing && <PublishDialog p={publishing} onClose={() => setPublishing(null)} />}
    </div>
  );
}

function Pool() {
  const { t } = useTranslation();
  const [f, setF] = useState({ branch: '', gradYear: '', seeking: '', skills: '' });
  const [qs, setQs] = useState('');
  const v = useQuery(nq.employerPool(qs));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(f)) if (val.trim()) p.set(k, val.trim());
    setQs(p.toString());
  };
  return (
    <div className="grid gap-4">
      <p className="text-meta text-fg-2">{t('recruiter.pool.intro')}</p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <Field label={t('recruiter.pool.branch')}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={f.branch}
              onChange={(e) => setF({ ...f, branch: e.target.value })}
            >
              <option value="">{t('recruiter.pool.any')}</option>
              {BRANCHES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('recruiter.pool.year')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              inputMode="numeric"
              value={f.gradYear}
              onChange={(e) => setF({ ...f, gradYear: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('recruiter.pool.seeking')}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={f.seeking}
              onChange={(e) => setF({ ...f, seeking: e.target.value })}
            >
              <option value="">{t('recruiter.pool.any')}</option>
              {SEEKING.map((s) => (
                <option key={s} value={s}>
                  {t(`network.seeking.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('recruiter.pool.skills')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={f.skills}
              onChange={(e) => setF({ ...f, skills: e.target.value })}
            />
          )}
        </Field>
        <Button type="submit" variant="primary">
          {t('recruiter.pool.count')}
        </Button>
      </form>
      {v.isError && <ErrorState error={v.error} onRetry={() => void v.refetch()} />}
      {v.data && (
        <Card variant="raised" className="grid gap-2 p-4">
          <p className="text-title font-semibold">{t('recruiter.pool.total', { n: String(v.data.total) })}</p>
          <ul className="grid gap-1 text-meta">
            {v.data.byCollege.map((c) => (
              <li key={c.id} className="flex justify-between gap-3">
                <span>{c.name}</span>
                <span className="font-mono">{String(c.count)}</span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-fg-3">{t('recruiter.pool.privacy')}</p>
        </Card>
      )}
    </div>
  );
}

function Company({ e }: { e: EmployerView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fail = useFail();
  const manage = useCan('employer:manage');
  const [r, setR] = useState({ name: '', email: '' });
  const saved = (v: EmployerView) => qc.setQueryData(nq.employerAccount().queryKey, v);
  const verify = useMutation({
    mutationFn: () => api.post<EmployerView>('/employer/verify-domain'),
    onSuccess: saved,
    onError: fail,
  });
  const add = useMutation({
    mutationFn: () => api.post<EmployerView>('/employer/recruiters', r),
    onSuccess: (v) => {
      saved(v);
      setR({ name: '', email: '' });
      toast.success(t('recruiter.company.added'));
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<EmployerView>(`/employer/recruiters/${id}`),
    onSuccess: saved,
    onError: fail,
  });
  return (
    <div className="grid gap-4">
      <Card variant="raised" className="grid gap-2 p-4 sm:p-6">
        <h2 className="text-title font-semibold">{e.legalName}</h2>
        <p className="text-meta">
          {t('recruiter.company.status')}:{' '}
          <Badge tone={e.status === 'approved' ? 'success' : 'warning'}>
            {t(`recruiter.employerStatus.${e.status}`)}
          </Badge>
        </p>
        <p className="text-meta text-fg-2">
          {e.domain} · GSTIN {e.gstin}
        </p>
        <p className="text-meta">
          {e.emailVerified ? t('recruiter.company.emailOk') : t('recruiter.company.emailPending')}
        </p>
        {!e.domainVerifiedAt ? (
          <div className="grid gap-2">
            <p className="text-meta">{t('recruiter.company.dns', { domain: e.domain })}</p>
            <code className="rounded-[var(--radius-sm)] bg-surface-2 p-2 text-caption break-all">
              {e.dnsToken}
            </code>
            {manage && (
              <div>
                <Button variant="primary" loading={verify.isPending} onClick={() => verify.mutate()}>
                  {t('recruiter.company.check')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-meta">
            {t('recruiter.company.domainOk', { date: formatDay(e.domainVerifiedAt) })}
          </p>
        )}
        <p className="text-caption text-fg-3">
          {t('recruiter.company.prices', {
            posting: rupees(e.pricing.perPosting),
            drive: rupees(e.pricing.perDrive),
            hire: rupees(e.pricing.perHire),
          })}
        </p>
      </Card>
      <Card variant="raised" className="grid gap-3 p-4 sm:p-6">
        <h2 className="text-title font-semibold">
          {t('recruiter.company.recruiters', { n: e.recruiters.length, max: e.limits.seats })}
        </h2>
        <ul className="grid gap-2">
          {e.recruiters.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 text-meta">
              <span>
                {u.name} · {u.email}
                {u.admin ? ` · ${t('recruiter.company.admin')}` : ''}
              </span>
              {manage && !u.admin && (
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(u.id)}>
                  {t('recruiter.company.remove')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {manage && (
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(ev) => {
              ev.preventDefault();
              add.mutate();
            }}
          >
            <Field label={t('recruiter.company.name')}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  required
                  value={r.name}
                  onChange={(ev) => setR({ ...r, name: ev.target.value })}
                />
              )}
            </Field>
            <Field label={t('recruiter.company.email')}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  required
                  type="email"
                  value={r.email}
                  onChange={(ev) => setR({ ...r, email: ev.target.value })}
                />
              )}
            </Field>
            <Button type="submit" loading={add.isPending}>
              {t('recruiter.company.add')}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

/** `/recruiter` (prompt 2, G12): an employer's postings, the pool and its own verification. */
export function RecruiterPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'postings';
  const v = useQuery({ ...SCREEN, ...nq.employerAccount() });
  if (v.isError) return <ErrorState error={v.error} onRetry={() => void v.refetch()} />;
  const e = v.data;
  return (
    <div className="grid gap-5">
      <PageHeader title={t('recruiter.title')} icon={<Building2 />} intro={e ? e.name : undefined} />
      {!e && <Skeleton className="h-48" />}
      {e && e.status !== 'approved' && (
        <Card variant="raised" className="p-4 text-meta">
          {t(`recruiter.pending.${e.status}`)}
        </Card>
      )}
      {e && (
        <>
          <Tabs
            label={t('recruiter.title')}
            idBase="recruiter"
            value={tab}
            tabs={TABS.map((id) => ({ id, label: t(`recruiter.tabs.${id}`) }))}
            onChange={(next) => setParams((p) => (p.set('tab', next), p), { replace: true })}
          />
          <TabPanel idBase="recruiter" id={tab}>
            {tab === 'postings' && <Postings approved={e.status === 'approved'} />}
            {tab === 'pool' &&
              (e.status === 'approved' ? (
                <Pool />
              ) : (
                <p className="text-meta">{t('recruiter.pending.applied')}</p>
              ))}
            {tab === 'company' && <Company e={e} />}
          </TabPanel>
        </>
      )}
    </div>
  );
}

function ReadinessDialog({ c, onClose }: { c: CandidateView; onClose: () => void }) {
  const { t } = useTranslation();
  const v = useQuery({
    queryKey: ['employer', 'readiness', c.ref],
    queryFn: () => api.get<CandidateReadinessView>(`/employer/candidates/${c.ref}/readiness`),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('recruiter.candidates.readinessOf', { name: c.name })}
    >
      {v.isError && <ErrorState error={v.error} onRetry={() => void v.refetch()} />}
      {!v.data && !v.isError && <Skeleton className="h-24" />}
      {v.data && (
        <div className="grid gap-2">
          <p className="text-title font-semibold">{t('recruiter.candidates.score', { n: v.data.score })}</p>
          <ul className="grid gap-1 text-meta">
            {v.data.components.map((x) => (
              <li key={x.id} className="flex justify-between gap-3">
                <span>{t(`recruiter.components.${x.id}`)}</span>
                <span className="font-mono">
                  {x.points}/{x.max}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-fg-3">{t('recruiter.candidates.readinessNote')}</p>
        </div>
      )}
    </Dialog>
  );
}

/** `/recruiter/postings/:id`: students who applied and shared, with résumé and readiness on request. */
export function RecruiterPostingPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const fail = useFail();
  const [readiness, setReadiness] = useState<CandidateView | null>(null);
  const v = useQuery({ ...SCREEN, ...nq.employerCandidates(id) });
  const resume = useMutation({
    mutationFn: async (ref: string) => {
      const link = await api.post<{ url: string }>(`/employer/candidates/${ref}/resume-link`);
      const blob = await apiBlob(link.url.replace(/^\/api\/v1/, ''));
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    },
    onError: fail,
  });
  const stage = useMutation({
    mutationFn: (a: { ref: string; stage: 'shortlisted' | 'not_selected' }) =>
      api.put(`/employer/candidates/${a.ref}/stage`, { stage: a.stage }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['employer', 'candidates', id] }),
    onError: fail,
  });
  return (
    <div className="grid gap-5">
      <BackLink to="/recruiter">{t('recruiter.title')}</BackLink>
      <PageHeader
        title={t('recruiter.candidates.title')}
        icon={<Users />}
        intro={t('recruiter.candidates.intro')}
      />
      {v.isError && <ErrorState error={v.error} onRetry={() => void v.refetch()} />}
      {!v.data && !v.isError && <Skeleton className="h-40" />}
      {v.data && v.data.items.length === 0 && (
        <EmptyState icon={<Users />} title={t('recruiter.candidates.none')} />
      )}
      {v.data && v.data.withdrawn > 0 && (
        <p className="text-meta text-fg-2">{t('recruiter.candidates.withdrawn', { n: v.data.withdrawn })}</p>
      )}
      <ul className="grid gap-3">
        {v.data?.items.map((c) => (
          <li key={c.ref}>
            <Card variant="raised" className="grid gap-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-body font-semibold">{c.name}</h3>
                <Badge tone={c.stage === 'selected' ? 'success' : 'info'}>
                  {t(`network.stages.${c.stage}`)}
                </Badge>
              </div>
              <p className="text-caption text-fg-3">
                {[c.college, c.branch, c.gradYear].filter(Boolean).join(' · ')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!c.hasResume}
                  loading={resume.isPending}
                  onClick={() => resume.mutate(c.ref)}
                >
                  <FileText className="size-4" aria-hidden /> {t('recruiter.candidates.resume')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setReadiness(c)}>
                  <Gauge className="size-4" aria-hidden /> {t('recruiter.candidates.readiness')}
                </Button>
                {(c.stage === 'shared' || c.stage === 'not_selected') && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => stage.mutate({ ref: c.ref, stage: 'shortlisted' })}
                  >
                    {t('recruiter.candidates.shortlist')}
                  </Button>
                )}
                {(c.stage === 'shared' || c.stage === 'shortlisted') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => stage.mutate({ ref: c.ref, stage: 'not_selected' })}
                  >
                    {t('recruiter.candidates.notSelected')}
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {readiness && <ReadinessDialog c={readiness} onClose={() => setReadiness(null)} />}
    </div>
  );
}
