import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { NETWORK_TERMS_VERSION, POSTING_DECLINE_REASONS, type CollegePostingView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Checkbox, Field, Input, Select } from '../../components/ui/field';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { Switch } from '../../components/ui/switch';
import { api, ApiError } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { useCan } from '../../lib/me';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import * as nq from './queries';

type SwitchKey = 'alumniDiscovery' | 'employerAccess' | 'credentials';
const SWITCHES: readonly SwitchKey[] = ['alumniDiscovery', 'employerAccess', 'credentials'];
const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

function ApproveDialog({ p, onClose }: { p: CollegePostingView; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [close, setClose] = useState(() => day(10));
  const [drive, setDrive] = useState(() => day(14));
  const approve = useMutation({
    mutationFn: () =>
      api.post(`/admin/network/postings/${p.id}/decision`, {
        decision: 'approved',
        registrationCloseAt: new Date(`${close}T18:30:00.000Z`).toISOString(),
        driveDate: new Date(`${drive}T04:30:00.000Z`).toISOString(),
      }),
    onSuccess: () => {
      toast.success(t('network.admin.approved'));
      void qc.invalidateQueries({ queryKey: ['admin-network'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('network.admin.approveTitle', { title: p.title })}
      description={t('network.admin.approveBody')}
      footer={
        <Button variant="primary" loading={approve.isPending} onClick={() => approve.mutate()}>
          {t('network.admin.approve')}
        </Button>
      }
    >
      <div className="grid gap-4">
        <Field label={t('network.admin.registrationClose')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              type="date"
              value={close}
              onChange={(e) => setClose(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('network.admin.driveDate')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              type="date"
              value={drive}
              onChange={(e) => setDrive(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function Postings({ items }: { items: CollegePostingView[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [approving, setApproving] = useState<CollegePostingView | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: ['admin-network'] });
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const decline = useMutation({
    mutationFn: (a: { id: string; reason: string }) =>
      api.post(`/admin/network/postings/${a.id}/decision`, { decision: 'declined', reason: a.reason }),
    onSuccess: done,
    onError: fail,
  });
  const moderate = useMutation({
    mutationFn: (a: { id: string; keep: boolean }) =>
      api.post(`/admin/network/postings/${a.id}/moderate`, { keep: a.keep }),
    onSuccess: done,
    onError: fail,
  });
  const block = useMutation({
    mutationFn: (employerId: string) => api.post('/admin/network/blocks', { employerId }),
    onSuccess: done,
    onError: fail,
  });
  if (!items.length) return <p className="text-callout text-fg-2">{t('network.admin.noPostings')}</p>;
  return (
    <ul className="grid gap-3">
      {items.map((p) => (
        <li key={p.id}>
          <Card className="grid gap-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-body font-semibold">
                {p.employer.name}: {p.title}
              </h3>
              <Badge
                tone={p.decision === 'approved' ? 'success' : p.decision === 'pending' ? 'info' : 'neutral'}
              >
                {t(`network.decisions.${p.decision}`)}
              </Badge>
            </div>
            <p className="text-callout text-fg-2">
              {[p.role, p.location, p.ctcRange, t(`network.postingTypes.${p.type}`)]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="text-caption text-fg-3">
              {t('network.admin.closes', { date: formatDay(p.closesAt) })}
              {p.branches.length ? ` · ${p.branches.join(', ')}` : ''}
              {p.gradYears.length ? ` · ${p.gradYears.join(', ')}` : ''}
              {p.reports ? ` · ${t('network.admin.reports', { n: p.reports })}` : ''}
            </p>
            <p className="line-clamp-3 text-callout whitespace-pre-line">{p.description}</p>
            <div className="flex flex-wrap gap-2">
              {p.decision === 'pending' && (
                <>
                  <Button size="sm" variant="primary" onClick={() => setApproving(p)}>
                    {t('network.admin.approve')}
                  </Button>
                  <Select
                    size="sm"
                    className="w-auto"
                    aria-label={t('network.admin.decline')}
                    value=""
                    onChange={(e) => e.target.value && decline.mutate({ id: p.id, reason: e.target.value })}
                  >
                    <option value="">{t('network.admin.decline')}</option>
                    {POSTING_DECLINE_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {t(`network.postingDeclines.${r}`)}
                      </option>
                    ))}
                  </Select>
                </>
              )}
              {p.decision === 'hidden' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => moderate.mutate({ id: p.id, keep: true })}
                  >
                    {t('network.admin.keep')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => moderate.mutate({ id: p.id, keep: false })}
                  >
                    {t('network.admin.remove')}
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => block.mutate(p.employer.id)}>
                {t('network.admin.block', { name: p.employer.name })}
              </Button>
            </div>
          </Card>
        </li>
      ))}
      {approving && <ApproveDialog p={approving} onClose={() => setApproving(null)} />}
    </ul>
  );
}

function CredentialKeys() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const v = useQuery(nq.adminCredentials());
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const rotate = useMutation({
    mutationFn: (kid?: string) =>
      api.post(kid ? `/admin/credentials/keys/${kid}/compromised` : '/admin/credentials/rotate'),
    onSuccess: () => {
      toast.success(t('network.admin.rotated'));
      void qc.invalidateQueries({ queryKey: ['admin-credentials'] });
    },
    onError: fail,
  });
  if (!v.data) return v.isLoading ? <Skeleton className="h-24" /> : null;
  const d = v.data;
  return (
    <Card variant="raised" className="grid gap-3 p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-headline font-semibold">
        <KeyRound className="size-5 text-brand-ink" aria-hidden /> {t('network.admin.keysTitle')}
      </h2>
      <p className="text-callout text-fg-2">
        {t('network.admin.keysBody', { issued: d.issued, revoked: d.revoked })}
      </p>
      <p className="text-caption break-all text-fg-3">{d.did}</p>
      <ul className="grid gap-2">
        {d.keys.map((k) => (
          <li key={k.kid} className="flex flex-wrap items-center justify-between gap-2 text-callout">
            <span className="font-mono">{k.kid.slice(0, 12)}…</span>
            <Badge tone={k.status === 'active' ? 'success' : k.status === 'retired' ? 'neutral' : 'danger'}>
              {t(`network.admin.keyStatus.${k.status}`)}
            </Badge>
            <span className="text-caption text-fg-3">{formatDay(k.createdAt)}</span>
            {k.status !== 'compromised' && (
              <Button size="sm" variant="ghost" onClick={() => rotate.mutate(k.kid)}>
                {t('network.admin.compromised')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div>
        <Button variant="outline" loading={rotate.isPending} onClick={() => rotate.mutate(undefined)}>
          {t('network.admin.rotate')}
        </Button>
      </div>
    </Card>
  );
}

/** /admin/network (prompt 2, G12, ADR 0014): the switches, postings to review, blocks and who looked. */
export function NetworkAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canSwitch = useCan('tenant:settings');
  const canKeys = useCan('credentials:manage');
  const v = useQuery({ ...SCREEN, ...nq.adminNetwork() });
  const [terms, setTerms] = useState(false);
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
  const done = () => void qc.invalidateQueries({ queryKey: ['admin-network'] });
  const flip = useMutation({
    mutationFn: (b: Partial<Record<SwitchKey, boolean>>) =>
      api.put('/admin/network/switches', { ...b, acceptTerms: terms }),
    onSuccess: () => {
      toast.success(t('network.admin.saved'));
      done();
    },
    onError: fail,
  });
  const unblock = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/network/blocks/${id}`),
    onSuccess: done,
    onError: fail,
  });
  const resume = useMutation({
    mutationFn: (id: string) => api.post(`/admin/network/paused/${id}/resume`),
    onSuccess: done,
    onError: fail,
  });
  if (v.isError) return <ErrorState error={v.error} onRetry={() => void v.refetch()} />;
  const d = v.data;
  if (!d) return <Skeleton className="h-64" />;
  const anyOff = SWITCHES.some((k) => !d.switches[k]);
  return (
    <div className="grid gap-5">
      <p className="text-callout text-fg-2">{t('network.admin.intro')}</p>
      <Card variant="raised" className="grid gap-3 p-4 sm:p-6">
        <h2 className="text-headline font-semibold">{t('network.admin.switchesTitle')}</h2>
        {canSwitch && anyOff && (
          <Checkbox id="network-terms" checked={terms} onChange={setTerms}>
            {t('network.admin.terms', { v: NETWORK_TERMS_VERSION })}
          </Checkbox>
        )}
        {SWITCHES.map((k) => (
          <Switch
            key={k}
            checked={d.switches[k]}
            disabled={!canSwitch || flip.isPending || (!d.switches[k] && !terms)}
            onChange={(on) => flip.mutate({ [k]: on })}
            label={t(`network.admin.switches.${k}`)}
            description={t(`network.admin.switches.${k}Body`)}
          />
        ))}
        {d.changedAt && (
          <p className="text-caption text-fg-3">
            {t('network.admin.changedOn', { date: formatDay(d.changedAt) })}
          </p>
        )}
        <p className="text-callout">
          {t('network.admin.members', {
            discoverable: d.members.discoverable,
            employers: d.members.employerVisible,
          })}
        </p>
      </Card>
      <section className="grid gap-3" aria-labelledby="postings-title">
        <h2 id="postings-title" className="text-headline font-semibold">
          {t('network.admin.postingsTitle')}
        </h2>
        <Postings items={d.postings} />
      </section>
      {d.blocked.length > 0 && (
        <Card className="grid gap-2 p-4">
          <h2 className="text-headline font-semibold">{t('network.admin.blockedTitle')}</h2>
          <ul className="grid gap-2">
            {d.blocked.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 text-callout">
                {b.name}
                <Button size="sm" variant="ghost" onClick={() => unblock.mutate(b.id)}>
                  {t('network.admin.unblock')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {d.paused.length > 0 && (
        <Card className="grid gap-2 p-4">
          <h2 className="text-headline font-semibold">{t('network.admin.pausedTitle')}</h2>
          <p className="text-callout text-fg-2">{t('network.admin.pausedBody')}</p>
          <ul className="grid gap-2">
            {d.paused.map((p) => (
              <li key={p.userId} className="flex items-center justify-between gap-2 text-callout">
                {p.name}
                <Button size="sm" variant="outline" onClick={() => resume.mutate(p.userId)}>
                  {t('network.admin.resume')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="grid gap-2 p-4">
        <h2 className="text-headline font-semibold">{t('network.admin.activityTitle')}</h2>
        {d.activity.length === 0 ? (
          <p className="text-callout text-fg-2">{t('network.admin.activityNone')}</p>
        ) : (
          <ul className="grid gap-1 text-callout">
            {d.activity.map((a) => (
              <li key={a.reason}>
                {t(`network.paths.${a.reason.replace('network.', '')}`)}: {a.count}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canKeys && d.switches.credentials && <CredentialKeys />}
    </div>
  );
}
