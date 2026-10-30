import { useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import {
  DRIVE_STATUSES,
  type DriveStatus,
  type OfferView,
  type OutcomeKind,
  type PlacementCompanyView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input, Textarea } from '../../components/ui/field';
import { Illustration } from '../../components/ui/illustration';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Card, Chip, EmptyState, Skeleton } from '../../components/ui/misc';
import { Table, THead, Td, Th } from '../../components/ui/table';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { Segmented } from '../../components/ui/tab-nav';
import { OutcomesQueue } from './outcomes-queue';
import { api, ApiError, apiBlob, saveBlob } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { closesSoon, ctcExact } from '../../lib/placements';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Drives() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DriveStatus | ''>('');
  const list = useInfiniteQuery({ ...SCREEN, ...q.adminDrives(status) });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('placements.admin.statusFilter')}>
          {(['', ...DRIVE_STATUSES] as const).map((s) => (
            <Chip key={s || 'all'} pressed={status === s} onClick={() => setStatus(s)}>
              {s ? t(`placements.status.${s}`) : t('placements.admin.allStatuses')}
            </Chip>
          ))}
        </div>
        <Link to="/admin/placements/new" className={buttonVariants({ variant: 'primary' })}>
          <Plus className="size-4" aria-hidden /> {t('placements.admin.newDrive')}
        </Link>
      </div>
      {list.isLoading && <Skeleton className="h-48" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.isSuccess && !rows.length && (
        <EmptyState art={<Illustration kind="calendar" />} title={t('placements.admin.noDrives')}>
          {t('placements.admin.noDrivesBody')}
        </EmptyState>
      )}
      {rows.length > 0 && (
        <Table label={t('placements.admin.drives')}>
          <THead>
            <tr>
              <Th>{t('placements.field.company')}</Th>
              <Th>{t('placements.admin.status')}</Th>
              <Th>{t('placements.admin.closes')}</Th>
              <Th>{t('placements.admin.registered')}</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <Td>
                  <IntentLink to={`/admin/placements/${d.id}`} className="font-semibold hover:underline">
                    {d.company.name}
                  </IntentLink>
                  <span className="block text-caption text-fg-2">{d.title}</span>
                </Td>
                <Td>
                  <Badge
                    tone={d.status === 'open' ? 'success' : d.status === 'cancelled' ? 'danger' : 'neutral'}
                  >
                    {t(`placements.status.${d.status}`)}
                  </Badge>{' '}
                  {closesSoon(d) && <Badge tone="warning">{t('placements.admin.closingSoon')}</Badge>}
                </Td>
                <Td>{formatDateTime(d.registrationCloseAt)}</Td>
                <Td className="tabular-nums">{d.registrations ?? 0}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {list.hasNextPage && (
        <div>
          <Button onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
            {t('common.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Students' own academic figures, waiting for the cell to check them against its records. */
function PendingAcademics() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery(q.pendingAcademics());
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'verify' | 'reject' }) =>
      api.post(`/admin/placements/academics/${id}/decision`, { decision }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pending-academics'] });
      toast.success(t('placements.admin.recordDecided'));
    },
    onError: (e) => toast.error(errorText(e, t('errors.generic'))),
  });
  if (list.isLoading) return <Skeleton className="h-32" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  const rows = list.data ?? [];
  if (!rows.length)
    return <EmptyState art={<Illustration kind="done" />} title={t('placements.admin.noPendingRecords')} />;
  return (
    <Table label={t('placements.admin.pendingRecords')}>
      <THead>
        <tr>
          <Th>{t('admin.rollNumber')}</Th>
          <Th>{t('placements.field.cgpa')}</Th>
          <Th>{t('placements.admin.backlogs')}</Th>
          <Th>{t('placements.admin.schooling')}</Th>
          <Th>{t('placements.admin.decision')}</Th>
        </tr>
      </THead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td className="font-mono">{r.rollNumber}</Td>
            <Td className="tabular-nums">{r.cgpa ?? '—'}</Td>
            <Td className="tabular-nums">
              {r.activeBacklogs ?? '—'} / {r.historyBacklogs ?? '—'}
            </Td>
            <Td className="tabular-nums">
              {[r.tenthPct, r.twelfthPct ?? r.diplomaPct]
                .map((x) => (x === null ? '—' : `${x}%`))
                .join(' · ')}
            </Td>
            <Td>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  loading={
                    decide.isPending && decide.variables.id === r.id && decide.variables.decision === 'verify'
                  }
                  onClick={() => decide.mutate({ id: r.id, decision: 'verify' })}
                >
                  {t('placements.admin.verify')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={
                    decide.isPending && decide.variables.id === r.id && decide.variables.decision === 'reject'
                  }
                  onClick={() => decide.mutate({ id: r.id, decision: 'reject' })}
                >
                  {t('placements.admin.reject')}
                </Button>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function CompanyDialog({ company, onClose }: { company: PlacementCompanyView | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(company?.name ?? '');
  const [website, setWebsite] = useState(company?.website ?? '');
  const [sector, setSector] = useState(company?.sector ?? '');
  const [notes, setNotes] = useState(company?.notes ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.put('/admin/placements/companies', {
        name: name.trim(),
        website: website.trim() || null,
        sector: sector.trim(),
        notes: notes.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['placement-companies'] });
      toast.success(t('placements.admin.companySaved'));
      onClose();
    },
    onError: (e) => toast.error(errorText(e, t('errors.generic'))),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={company ? company.name : t('placements.admin.addCompany')}
      description={t('placements.admin.companyBody')}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {!company && (
          <Field label={t('placements.field.company')}>
            {({ id }) => (
              <Input id={id} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
        )}
        <Field label={t('placements.admin.website')} aside={t('common.optional')}>
          {({ id }) => (
            <Input
              id={id}
              type="url"
              placeholder="https://"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('placements.admin.sector')} aside={t('common.optional')}>
          {({ id }) => (
            <Input id={id} maxLength={80} value={sector} onChange={(e) => setSector(e.target.value)} />
          )}
        </Field>
        <Field label={t('placements.admin.notes')} hint={t('placements.admin.notesHint')}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={4}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button variant="primary" type="submit" loading={save.isPending} disabled={name.trim().length < 2}>
            {t('placements.admin.save')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Companies() {
  const { t } = useTranslation();
  const list = useQuery(q.placementCompanies());
  const [editing, setEditing] = useState<PlacementCompanyView | 'new' | null>(null);
  return (
    <div className="grid gap-3">
      <div>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden /> {t('placements.admin.addCompany')}
        </Button>
      </div>
      {list.isLoading && <Skeleton className="h-32" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.isSuccess && !list.data.length && (
        <EmptyState art={<Illustration kind="empty" />} title={t('placements.admin.noCompanies')} />
      )}
      {!!list.data?.length && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {list.data.map((c) => (
            <li key={c.id}>
              <Card className="grid gap-1 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{c.name}</p>
                    {c.sector && <p className="text-caption text-fg-2">{c.sector}</p>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                    {t('placements.admin.edit')}
                  </Button>
                </div>
                {c.notes && <p className="line-clamp-2 text-meta text-fg-2">{c.notes}</p>}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <CompanyDialog company={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

type DrivesTab = 'drives' | 'records' | 'companies';

/** Admin › Placements (B7): drives, students' self-reported records, and recruiting companies. */
export function DrivesAdmin() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DrivesTab>('drives');
  const pending = useQuery(q.pendingAcademics());
  const idBase = 'placements-admin';
  return (
    <div className="grid gap-4">
      <p className="text-fg-2">{t('placements.admin.intro')}</p>
      <Tabs<DrivesTab>
        label={t('placements.admin.sections')}
        idBase={idBase}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'drives', label: t('placements.admin.drives') },
          {
            id: 'records',
            label: t('placements.admin.pendingRecords'),
            ...(pending.data?.length ? { count: pending.data.length } : {}),
          },
          { id: 'companies', label: t('placements.admin.companies') },
        ]}
      />
      <TabPanel idBase={idBase} id={tab}>
        {tab === 'drives' && <Drives />}
        {tab === 'records' && <PendingAcademics />}
        {tab === 'companies' && <Companies />}
      </TabPanel>
    </div>
  );
}

function OfferDecision({ offer: o, onClose }: { offer: OfferView; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'verify' | 'reject') =>
      api.post(
        `/admin/offers/${o.id}/decision`,
        decision === 'reject' ? { decision, reason: reason.trim() } : { decision },
      ),
    onSuccess: (_r, decision) => {
      void qc.invalidateQueries({ queryKey: ['offers-queue'] });
      void qc.invalidateQueries({ queryKey: ['admin-overview'] });
      toast.success(
        decision === 'verify' ? t('placements.admin.offerVerified') : t('placements.admin.offerRejected'),
      );
      onClose();
    },
    onError: (e) => toast.error(errorText(e, t('errors.generic'))),
  });
  const proof = async () => {
    if (!o.proofFileId) return;
    try {
      const blob = await apiBlob(`/files/${o.proofFileId}`);
      saveBlob(blob, `offer-proof-${o.id}.${blob.type === 'application/pdf' ? 'pdf' : 'jpg'}`);
    } catch (e) {
      toast.error(errorText(e, t('errors.generic')));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(x) => !x && onClose()}
      title={t('placements.admin.offerTitle', { company: o.companyName })}
      description={t('placements.admin.offerBody')}
    >
      <div className="grid gap-4">
        <dl className="grid grid-cols-2 gap-3 text-meta">
          <div>
            <dt className="text-fg-3">{t('common.name')}</dt>
            <dd className="font-semibold">{o.member?.name || t('placements.admin.formerMember')}</dd>
          </div>
          <div>
            <dt className="text-fg-3">{t('placements.admin.class')}</dt>
            <dd className="font-semibold">
              {[o.member?.branch, o.member?.gradYear].filter(Boolean).join(' · ') || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-fg-3">{t('placements.field.role')}</dt>
            <dd className="font-semibold">{o.role}</dd>
          </div>
          <div>
            <dt className="text-fg-3">{t('placements.field.ctc')}</dt>
            <dd className="font-semibold tabular-nums">{ctcExact(t, o.ctcLpa)}</dd>
          </div>
          <div>
            <dt className="text-fg-3">{t('placements.field.source')}</dt>
            <dd className="font-semibold">{t(`placements.source.${o.source}`)}</dd>
          </div>
          <div>
            <dt className="text-fg-3">{t('placements.field.offerDate')}</dt>
            <dd className="font-semibold">{formatDay(o.offerDate)}</dd>
          </div>
        </dl>
        {o.proofFileId && (
          <div>
            <Button size="sm" onClick={() => void proof()}>
              <FileText className="size-4" aria-hidden /> {t('placements.admin.openProof')}
            </Button>
          </div>
        )}
        <Field label={t('placements.admin.rejectReason')} hint={t('placements.admin.rejectReasonHint')}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            loading={decide.isPending && decide.variables === 'verify'}
            onClick={() => decide.mutate('verify')}
          >
            {t('placements.admin.verify')}
          </Button>
          <Button
            variant="ghost"
            disabled={reason.trim().length < 3}
            loading={decide.isPending && decide.variables === 'reject'}
            onClick={() => decide.mutate('reject')}
          >
            {t('placements.admin.reject')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

type OfferStatusTab = 'reported' | 'verified' | 'rejected';

/** Offers members reported, with proof, waiting for verification (B7). */
function OffersQueue() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OfferStatusTab>('reported');
  const [open, setOpen] = useState<OfferView | null>(null);
  const list = useInfiniteQuery({ ...SCREEN, ...q.offersQueue(status) });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const idBase = 'offers-admin';
  return (
    <div className="grid gap-4">
      <p className="text-fg-2">{t('placements.admin.offersIntro')}</p>
      <Tabs<OfferStatusTab>
        label={t('placements.admin.offersBy')}
        idBase={idBase}
        value={status}
        onChange={setStatus}
        tabs={(['reported', 'verified', 'rejected'] as const).map((s) => ({
          id: s,
          label: t(`placements.offerStatus.${s}`),
        }))}
      />
      <TabPanel idBase={idBase} id={status}>
        {list.isLoading && <Skeleton className="h-48" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.isSuccess && !rows.length && (
          <EmptyState art={<Illustration kind="done" />} title={t(`placements.admin.noOffers.${status}`)} />
        )}
        {rows.length > 0 && (
          <Table label={t('placements.admin.offers')}>
            <THead>
              <tr>
                <Th>{t('common.name')}</Th>
                <Th>{t('placements.field.company')}</Th>
                <Th>{t('placements.field.ctc')}</Th>
                <Th>{t('placements.field.source')}</Th>
                <Th>{t('placements.admin.reported')}</Th>
                {status === 'reported' && <Th>{t('placements.admin.decision')}</Th>}
              </tr>
            </THead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <Td>
                    {o.member?.name || t('placements.admin.formerMember')}
                    <span className="block text-caption text-fg-2">
                      {[o.member?.branch, o.member?.gradYear].filter(Boolean).join(' · ')}
                    </span>
                  </Td>
                  <Td>
                    {o.companyName}
                    <span className="block text-caption text-fg-2">{o.role}</span>
                  </Td>
                  <Td className="tabular-nums">{ctcExact(t, o.ctcLpa)}</Td>
                  <Td>{t(`placements.source.${o.source}`)}</Td>
                  <Td>{formatDay(o.createdAt)}</Td>
                  {status === 'reported' && (
                    <Td>
                      <Button size="sm" onClick={() => setOpen(o)}>
                        {t('placements.admin.review')}
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.hasNextPage && (
          <div className="mt-3">
            <Button onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
              {t('common.loadMore')}
            </Button>
          </div>
        )}
      </TabPanel>
      {open && <OfferDecision offer={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

type QueueKind = 'offers' | OutcomeKind;

/** Admin › Offers and outcomes (B7, B8): offers, higher studies, exams and ventures to verify. */
export function OffersAdmin() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<QueueKind>('offers');
  return (
    <div className="grid gap-5">
      <Segmented<QueueKind>
        label={t('outcomes.admin.kinds')}
        value={kind}
        onChange={setKind}
        options={[
          ['offers', t('outcomes.offers')],
          ['higher_study', t('outcomes.kind.higher_study')],
          ['exam', t('outcomes.kind.exam')],
          ['venture', t('outcomes.kind.venture')],
        ]}
      />
      {kind === 'offers' ? <OffersQueue /> : <OutcomesQueue key={kind} kind={kind} />}
    </div>
  );
}
