import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus } from 'lucide-react';
import {
  PLEDGE_PURPOSES,
  PLEDGE_STATUSES,
  type FundView,
  type GivingSettingsView,
  type PledgePurpose,
  type PledgeView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState } from '../../components/ui/error-state';
import { Field, Input, Select, Textarea } from '../../components/ui/field';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { ProgressBar } from '../../components/ui/progress';
import { Switch } from '../../components/ui/switch';
import { Table, Td, TdNum, Th, THead } from '../../components/ui/table';
import { api, ApiError, apiBlob, saveBlob } from '../../lib/api';
import { paiseToInput, rupees, toPaise } from '../../lib/billing';
import { newIdempotencyKey } from '../../lib/format';
import * as q from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';

const fail = (t: (k: string) => string) => (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
const today = () => new Date().toISOString().slice(0, 10);

function FundDialog({ fund, onClose }: { fund: FundView | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [title, setTitle] = useState(fund?.title ?? '');
  const [purpose, setPurpose] = useState<PledgePurpose>(fund?.purpose ?? 'scholarship');
  const [description, setDescription] = useState(fund?.description ?? '');
  const [target, setTarget] = useState(fund?.targetPaise ? paiseToInput(fund.targetPaise) : '');
  const [payLink, setPayLink] = useState(fund?.payLink ?? '');
  const [bank, setBank] = useState(fund?.bankDetails ?? '');
  const [open, setOpen] = useState(fund ? fund.status === 'open' : true);
  const [key] = useState(newIdempotencyKey);
  const targetPaise = target.trim() ? toPaise(target) : null;
  const body = {
    title: title.trim(),
    purpose,
    description: description.trim(),
    targetPaise,
    payLink: payLink.trim() || null,
    bankDetails: bank.trim(),
    status: open ? 'open' : 'closed',
  };
  const save = useMutation({
    mutationFn: () =>
      fund ? api.put(`/admin/giving/funds/${fund.id}`, body) : api.postOnce('/admin/giving/funds', body, key),
    onSuccess: () => {
      toast.success(t('alumniAdmin.giving.saved'));
      void qc.invalidateQueries({ queryKey: ['admin-funds'] });
      onClose();
    },
    onError: fail(t),
  });
  const ready =
    body.title.length >= 3 &&
    body.description.length >= 10 &&
    (targetPaise === null || Number.isFinite(targetPaise));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={fund ? t('alumniAdmin.giving.editFund') : t('alumniAdmin.giving.newFund')}
      description={t('alumniAdmin.giving.fundBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button variant="primary" type="submit" form="fund" loading={save.isPending} disabled={!ready}>
            {t('common.save')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <form
        id="fund"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) save.mutate();
        }}
      >
        <Field label={t('alumniAdmin.giving.fundTitle')}>
          {({ id }) => (
            <Input id={id} maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('alumniAdmin.giving.purpose')}>
            {({ id }) => (
              <Select id={id} value={purpose} onChange={(e) => setPurpose(e.target.value as PledgePurpose)}>
                {PLEDGE_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {t(`alumni.purpose.${p}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('alumniAdmin.giving.target')} hint={t('alumniAdmin.giving.targetHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t('alumniAdmin.giving.description')}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('alumniAdmin.giving.payLink')} hint={t('alumniAdmin.giving.payLinkHint')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="url"
              inputMode="url"
              placeholder="https://"
              value={payLink}
              onChange={(e) => setPayLink(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('alumniAdmin.giving.bank')}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={2}
              maxLength={600}
              value={bank}
              onChange={(e) => setBank(e.target.value)}
            />
          )}
        </Field>
        <Switch checked={open} onChange={setOpen} label={t('alumniAdmin.giving.open')} />
      </form>
    </Dialog>
  );
}

function ReceiveDialog({ p, onClose }: { p: PledgeView; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(paiseToInput(p.amountPaise));
  const [on, setOn] = useState(today);
  const [reference, setReference] = useState(p.reference);
  const [key] = useState(newIdempotencyKey);
  const paise = toPaise(amount);
  const save = useMutation({
    mutationFn: () =>
      api.postOnce(
        `/admin/giving/pledges/${p.id}/receive`,
        { amountPaise: paise, receivedOn: on, reference: reference.trim() },
        key,
      ),
    onSuccess: () => {
      toast.success(t('alumniAdmin.giving.recorded'));
      void qc.invalidateQueries({ queryKey: ['admin-pledges'] });
      void qc.invalidateQueries({ queryKey: ['admin-funds'] });
      onClose();
    },
    onError: fail(t),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('alumniAdmin.giving.receiveTitle', { name: p.person?.name ?? '' })}
      description={t('alumniAdmin.giving.receiveBody')}
      footer={
        <div className="grid gap-2 sm:flex sm:flex-row-reverse">
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!Number.isFinite(paise) || paise < 100 || !on}
            onClick={() => save.mutate()}
          >
            {t('alumniAdmin.giving.record')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Field label={t('alumniAdmin.giving.amount')}>
          {({ id }) => (
            <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          )}
        </Field>
        <Field label={t('alumniAdmin.giving.receivedOn')}>
          {({ id }) => <Input id={id} type="date" value={on} onChange={(e) => setOn(e.target.value)} />}
        </Field>
        <Field label={t('alumniAdmin.giving.reference')}>
          {({ id }) => (
            <Input id={id} maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function SettingsCard({ s }: { s: GivingSettingsView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tax, setTax] = useState(s.taxReceipts);
  const [registration, setRegistration] = useState(s.registration);
  const [signatory, setSignatory] = useState(s.signatory);
  const save = useMutation({
    mutationFn: () =>
      api.put<GivingSettingsView>('/admin/giving/settings', { taxReceipts: tax, registration, signatory }),
    onSuccess: (v) => {
      qc.setQueryData(['giving-settings'], v);
      toast.success(t('alumniAdmin.giving.saved'));
    },
    onError: fail(t),
  });
  return (
    <Card className="grid gap-4 p-4">
      <Switch
        checked={tax}
        onChange={setTax}
        label={t('alumniAdmin.giving.tax')}
        description={t('alumniAdmin.giving.taxHint')}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('alumniAdmin.giving.registration')}>
          {({ id }) => (
            <Input
              id={id}
              maxLength={200}
              value={registration}
              onChange={(e) => setRegistration(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('alumniAdmin.giving.signatory')}>
          {({ id }) => (
            <Input id={id} maxLength={80} value={signatory} onChange={(e) => setSignatory(e.target.value)} />
          )}
        </Field>
      </div>
      <Button className="justify-self-start" loading={save.isPending} onClick={() => save.mutate()}>
        {t('common.save')}
      </Button>
    </Card>
  );
}

/** Admin › Giving (prompt 2, G6): funds, money the college received, receipts. */
export function GivingAdmin() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const funds = useQuery({ ...SCREEN, ...q.adminFunds() });
  const pledges = useQuery(q.adminPledges(status));
  const settings = useQuery(q.givingSettings());
  const [editing, setEditing] = useState<FundView | 'new' | null>(null);
  const [receiving, setReceiving] = useState<PledgeView | null>(null);
  const ack = async (p: PledgeView) => {
    try {
      saveBlob(
        await apiBlob(`/admin/giving/pledges/${p.id}/acknowledgement`),
        `${(p.receiptNo ?? 'receipt').replace(/\//g, '-')}.pdf`,
      );
    } catch (e) {
      fail(t)(e);
    }
  };
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[60ch] text-callout text-fg-2">{t('alumniAdmin.givingIntro')}</p>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden /> {t('alumniAdmin.giving.newFund')}
        </Button>
      </div>
      {funds.isLoading && <Skeleton className="h-32" />}
      {funds.isError && <ErrorState error={funds.error} onRetry={() => void funds.refetch()} />}
      <ul className="grid gap-3 md:grid-cols-2">
        {funds.data?.map((f) => (
          <li key={f.id}>
            <Card className="grid gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <b>{f.title}</b>
                <Badge tone={f.status === 'open' ? 'success' : 'neutral'}>
                  {t(`alumniAdmin.giving.fundStatus.${f.status}`)}
                </Badge>
              </div>
              {f.targetPaise ? <ProgressBar value={f.receivedPaise} max={f.targetPaise} /> : null}
              <p className="text-callout text-fg-2">
                {t('alumniAdmin.giving.totals', {
                  received: rupees(f.receivedPaise),
                  pledged: rupees(f.pledgedPaise),
                  donors: f.donors,
                })}
              </p>
              <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setEditing(f)}>
                {t('alumniAdmin.giving.editFund')}
              </Button>
            </Card>
          </li>
        ))}
      </ul>
      <section aria-labelledby="pledges" className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="pledges" className="text-headline font-semibold">
            {t('alumniAdmin.giving.pledges')}
          </h2>
          <Field label={t('alumniAdmin.giving.filter')}>
            {({ id }) => (
              <Select id={id} size="sm" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">{t('alumniAdmin.giving.all')}</option>
                {PLEDGE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`alumni.pledge.${s}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {pledges.data && !pledges.data.length ? (
          <p className="text-callout text-fg-2">{t('alumniAdmin.giving.noPledges')}</p>
        ) : (
          <Table label={t('alumniAdmin.giving.pledges')}>
            <THead>
              <tr>
                <Th>{t('alumniAdmin.giving.who')}</Th>
                <Th>{t('alumniAdmin.giving.fund')}</Th>
                <Th>{t('alumniAdmin.giving.amount')}</Th>
                <Th>{t('alumniAdmin.giving.state')}</Th>
                <Th>{t('alumniAdmin.giving.receipt')}</Th>
                <Th>
                  <span className="sr-only">{t('alumniAdmin.giving.actions')}</span>
                </Th>
              </tr>
            </THead>
            <tbody>
              {pledges.data?.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <Td>
                    {p.person?.name}
                    {p.reference && <span className="block text-caption text-fg-3">{p.reference}</span>}
                  </Td>
                  <Td>{p.fund.title}</Td>
                  <TdNum>{rupees(p.receivedPaise ?? p.amountPaise)}</TdNum>
                  <Td>{t(`alumni.pledge.${p.status}`)}</Td>
                  <Td>{p.receiptNo ?? '–'}</Td>
                  <Td>
                    {(p.status === 'pledged' || p.status === 'paid') && (
                      <Button size="sm" onClick={() => setReceiving(p)}>
                        {t('alumniAdmin.giving.record')}
                      </Button>
                    )}
                    {p.acknowledgement && (
                      <Button size="sm" variant="ghost" onClick={() => void ack(p)}>
                        <Download className="size-4" aria-hidden />
                        <span className="sr-only">{t('alumni.giving.ack')}</span>
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      <section aria-labelledby="giving-settings" className="grid gap-3">
        <h2 id="giving-settings" className="text-headline font-semibold">
          {t('alumniAdmin.giving.settings')}
        </h2>
        {settings.data && <SettingsCard s={settings.data} />}
      </section>
      {editing && <FundDialog fund={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {receiving && <ReceiveDialog p={receiving} onClose={() => setReceiving(null)} />}
    </div>
  );
}
