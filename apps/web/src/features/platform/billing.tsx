import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { AlertTriangle, Download, Pencil, Plus } from 'lucide-react';
import { FEATURE_KEYS, type InvoiceView, type PlanView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { BackLink } from '../../components/ui/back-link';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { IntentLink } from '../../components/ui/intent-link';
import { Badge, Card, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Table, THead, Td, TdNum, Th } from '../../components/ui/table';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { ApiError, api, apiBlob, saveBlob } from '../../lib/api';
import { INVOICE_TONE, compact, count, day, rupees } from '../../lib/billing';
import { platformBilling, platformCollegeBilling, platformPlans } from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { formatMoney } from '../../lib/numbers';
import { toast } from '../../lib/toast';
import {
  InvoiceDialog,
  IssueDialog,
  PaymentDialog,
  PlanDialog,
  SubscriptionForm,
  VoidDialog,
} from './billing-dialogs';

type Tab = 'colleges' | 'plans';

/** Platform › Billing (B10): every college's plan and balance, and the plans themselves. */
export function PlatformBilling() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('colleges');
  const rows = useQuery({ ...SCREEN, ...platformBilling() });
  const plans = useQuery(platformPlans());
  const [editing, setEditing] = useState<PlanView | null>(null);
  return (
    <div className="grid gap-5">
      <PageHeader title={t('pbilling.title')} intro={t('pbilling.intro')} />
      <Tabs<Tab>
        label={t('pbilling.title')}
        idBase="pbilling"
        value={tab}
        onChange={setTab}
        tabs={(['colleges', 'plans'] as const).map((id) => ({ id, label: t(`pbilling.tabs.${id}`) }))}
      />
      <TabPanel idBase="pbilling" id={tab}>
        {tab === 'colleges' ? (
          <>
            {rows.isLoading && <Skeleton className="h-48" />}
            {rows.isError && !rows.data && (
              <ErrorState error={rows.error} onRetry={() => void rows.refetch()} />
            )}
            {rows.data && (
              <Table label={t('pbilling.tabs.colleges')}>
                <THead>
                  <tr>
                    <Th>{t('pbilling.col.college')}</Th>
                    <Th>{t('pbilling.col.plan')}</Th>
                    <Th className="text-right">{t('pbilling.col.seats')}</Th>
                    <Th>{t('pbilling.col.renewal')}</Th>
                    <Th className="text-right">{t('pbilling.col.outstanding')}</Th>
                    <Th>{t('pbilling.col.status')}</Th>
                  </tr>
                </THead>
                <tbody>
                  {rows.data.map((r) => (
                    <tr key={r.tenantId}>
                      <Td>
                        <IntentLink
                          to={`/platform/billing/${r.tenantId}`}
                          className="font-semibold text-brand-ink underline-offset-4 hover:underline"
                        >
                          {r.name}
                        </IntentLink>
                        <span className="block font-mono text-caption text-fg-3">{r.slug}</span>
                      </Td>
                      <Td>{t(`billing.plan.${r.plan}`)}</Td>
                      <TdNum>
                        {r.seatsUsed === null ? '—' : count(r.seatsUsed)} / {count(r.seats)}
                      </TdNum>
                      <Td>{day(r.renewalDate)}</Td>
                      <TdNum>{rupees(r.outstandingPaise)}</TdNum>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {r.overdue > 0 && (
                            <Badge tone="danger">{t('pbilling.overdue', { count: r.overdue })}</Badge>
                          )}
                          {r.readOnly && <Badge tone="danger">{t('pbilling.readOnly')}</Badge>}
                          {r.seatsUsed !== null && r.seatsUsed > r.seats && (
                            <Badge tone="warning">{t('pbilling.overSeats')}</Badge>
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </>
        ) : (
          <div className="grid gap-4">
            <p className="text-meta text-fg-2">{t('pbilling.plans.intro')}</p>
            {plans.isLoading && <Skeleton className="h-48" />}
            <div className="grid gap-4 md:grid-cols-3">
              {plans.data?.map((p) => (
                <Card key={p.id} className="grid content-start gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-heading font-semibold">{t(`billing.plan.${p.id}`)}</h2>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setEditing(p)}
                      aria-label={t('pbilling.edit', { plan: t(`billing.plan.${p.id}`) })}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                  </div>
                  <dl className="grid gap-1 text-meta">
                    {(
                      [
                        ['pricePerStudentPaise', rupees(p.terms.pricePerStudentPaise)],
                        ['annualMinimumPaise', rupees(p.terms.annualMinimumPaise, { paise: false })],
                        ['whatsappPerStudentMonthly', count(p.terms.whatsappPerStudentMonthly)],
                        ['aiTokensPerStudentMonthly', count(p.terms.aiTokensPerStudentMonthly)],
                        ['days', p.terms.days ? count(p.terms.days) : t('pbilling.yearly')],
                      ] as const
                    ).map(([k, val]) => (
                      <div key={k} className="flex justify-between gap-3">
                        <dt className="text-fg-2">
                          {t(`pbilling.terms.${k}`)}
                          {p.changed.includes(k) && (
                            <Badge tone="accent" className="ms-1">
                              {t('pbilling.changed')}
                            </Badge>
                          )}
                        </dt>
                        <dd className="font-semibold tabular-nums">{val}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-caption text-fg-3">
                    {t('pbilling.featureCount', {
                      count: p.terms.features.length,
                      total: FEATURE_KEYS.length,
                    })}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        )}
      </TabPanel>
      {editing && <PlanDialog plan={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

type Dialogs =
  | { kind: 'invoice' }
  | { kind: 'payment'; invoice: InvoiceView }
  | { kind: 'void'; invoice: InvoiceView }
  | { kind: 'issue'; invoice: InvoiceView }
  | null;

/** Platform › Billing › one college: subscription, usage, invoices and payments. */
export function PlatformCollegeBilling() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const r = useQuery({ ...SCREEN, ...platformCollegeBilling(id) });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [busy, setBusy] = useState('');
  const v = r.data;
  const refresh = (data: unknown) => {
    qc.setQueryData(platformCollegeBilling(id).queryKey, data as never);
    void qc.invalidateQueries({ queryKey: ['platform-billing'], exact: true });
  };
  const discard = useMutation({
    mutationFn: (inv: InvoiceView) => api.delete(`/platform/billing/${id}/invoices/${inv.id}`),
    onSuccess: (data) => {
      refresh(data);
      toast.success(t('pbilling.discarded'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('errors.generic')),
  });
  const download = async (inv: InvoiceView) => {
    setBusy(inv.id);
    try {
      saveBlob(
        await apiBlob(`/platform/billing/${id}/invoices/${inv.id}/pdf`),
        `${(inv.number ?? inv.id).replaceAll('/', '-')}.pdf`,
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setBusy('');
    }
  };
  const payments = v?.invoices.flatMap((i) => i.payments.map((p) => ({ ...p, number: i.number }))) ?? [];

  return (
    <div className="grid gap-5">
      <BackLink to="/platform/billing">{t('pbilling.back')}</BackLink>
      {r.isLoading && <Skeleton className="h-64" />}
      {r.isError && !v && <ErrorState error={r.error} onRetry={() => void r.refetch()} />}
      {v && (
        <>
          <PageHeader
            title={v.name}
            intro={t('pbilling.collegeIntro', { slug: v.slug, plan: t(`billing.plan.${v.plan}`) })}
          />
          {v.warnings.length > 0 && (
            <ul className="grid gap-2">
              {v.warnings.map((w) => (
                <li
                  key={w}
                  className="flex gap-2 rounded-[var(--radius-md)] bg-warning-surface p-3 text-meta text-warning-ink"
                >
                  <AlertTriangle className="mt-0.5 size-4 flex-none" aria-hidden />{' '}
                  {t(`pbilling.warnings.${w}`)}
                </li>
              ))}
            </ul>
          )}
          <StatGrid className="md:grid-cols-4">
            <StatCard
              label={t('billing.seats')}
              value={v.usage.seats.used === null ? '—' : compact(v.usage.seats.used)}
              hint={t('billing.ofContracted', { seats: count(v.usage.seats.contracted) })}
              tone={v.overSeats ? 'warning' : 'default'}
            />
            <StatCard
              label={t('billing.whatsapp')}
              value={compact(v.usage.whatsapp.used)}
              hint={t('billing.ofAllowance', { allowance: compact(v.usage.whatsapp.allowance) })}
            />
            <StatCard
              label={t('billing.aiTokens')}
              value={compact(v.usage.aiTokens.used)}
              hint={t('billing.ofAllowance', { allowance: compact(v.usage.aiTokens.allowance) })}
            />
            <StatCard
              label={t('pbilling.annualPrice')}
              value={rupees(v.annualPricePaise, { paise: false })}
              hint={
                v.aiCost.estimate !== null
                  ? t('pbilling.aiCost', {
                      amount: formatMoney(v.aiCost.estimate, v.aiCost.currency),
                    })
                  : undefined
              }
            />
          </StatGrid>
          {v.readOnly && (
            <Badge tone="danger">
              {t('pbilling.readOnlySince', { date: day(v.readOnlySince?.slice(0, 10) ?? null) })}
            </Badge>
          )}

          <SubscriptionForm view={v} onSaved={refresh} />

          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="pbilling-invoices" className="text-heading font-semibold">
                {t('billing.invoices')}
              </h2>
              <Button variant="primary" onClick={() => setDialog({ kind: 'invoice' })}>
                <Plus className="size-4" aria-hidden /> {t('pbilling.newInvoice')}
              </Button>
            </div>
            {v.invoices.length === 0 ? (
              <p className="text-meta text-fg-2">{t('billing.noInvoices')}</p>
            ) : (
              <Table label={t('billing.invoices')}>
                <THead>
                  <tr>
                    <Th>{t('billing.col.number')}</Th>
                    <Th>{t('billing.col.due')}</Th>
                    <Th className="text-right">{t('billing.col.total')}</Th>
                    <Th className="text-right">{t('billing.col.balance')}</Th>
                    <Th>{t('billing.col.status')}</Th>
                    <Th>
                      <span className="sr-only">{t('billing.col.actions')}</span>
                    </Th>
                  </tr>
                </THead>
                <tbody>
                  {v.invoices.map((inv) => {
                    const name = inv.number ?? t('pbilling.draft');
                    const open = inv.status === 'issued' || inv.status === 'overdue';
                    return (
                      <tr key={inv.id}>
                        <Td className="whitespace-nowrap font-mono">{name}</Td>
                        <Td className="whitespace-nowrap">{day(inv.dueOn)}</Td>
                        <TdNum>{rupees(inv.totalPaise)}</TdNum>
                        <TdNum>{rupees(inv.balancePaise)}</TdNum>
                        <Td>
                          <Badge tone={INVOICE_TONE[inv.status]}>{t(`billing.status.${inv.status}`)}</Badge>
                        </Td>
                        <Td>
                          <div className="flex flex-wrap justify-end gap-2">
                            {inv.status === 'draft' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => setDialog({ kind: 'issue', invoice: inv })}
                                >
                                  {t('pbilling.issue')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  loading={discard.isPending && discard.variables.id === inv.id}
                                  onClick={() => discard.mutate(inv)}
                                >
                                  {t('pbilling.discard')}
                                </Button>
                              </>
                            )}
                            {open && (
                              <>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => setDialog({ kind: 'payment', invoice: inv })}
                                >
                                  {t('pbilling.recordPayment')}
                                </Button>
                                {inv.payments.length === 0 && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setDialog({ kind: 'void', invoice: inv })}
                                  >
                                    {t('pbilling.void')}
                                  </Button>
                                )}
                              </>
                            )}
                            {inv.hasPdf && (
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={busy === inv.id}
                                onClick={() => void download(inv)}
                                aria-label={t('billing.downloadNamed', { number: name })}
                              >
                                <Download className="size-4" aria-hidden />
                              </Button>
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </section>

          {payments.length > 0 && (
            <section className="grid gap-3">
              <h2 id="pbilling-payments" className="text-heading font-semibold">
                {t('pbilling.payments')}
              </h2>
              <Table label={t('pbilling.payments')}>
                <THead>
                  <tr>
                    <Th>{t('billing.col.number')}</Th>
                    <Th>{t('pbilling.paidOn')}</Th>
                    <Th className="text-right">{t('pbilling.amount')}</Th>
                    <Th>{t('pbilling.methodLabel')}</Th>
                    <Th>{t('pbilling.reference')}</Th>
                  </tr>
                </THead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <Td className="whitespace-nowrap font-mono">{p.number}</Td>
                      <Td className="whitespace-nowrap">{day(p.paidOn)}</Td>
                      <TdNum>{rupees(p.amountPaise)}</TdNum>
                      <Td>{t(`pbilling.method.${p.method}`)}</Td>
                      <Td className="font-mono">{p.reference}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </section>
          )}
          {dialog?.kind === 'invoice' && (
            <InvoiceDialog
              tenantId={id}
              suggested={v.suggested}
              onClose={() => setDialog(null)}
              onSaved={refresh}
            />
          )}
          {dialog?.kind === 'payment' && (
            <PaymentDialog
              tenantId={id}
              invoice={dialog.invoice}
              onClose={() => setDialog(null)}
              onSaved={refresh}
            />
          )}
          {dialog?.kind === 'issue' && (
            <IssueDialog
              tenantId={id}
              invoice={dialog.invoice}
              onClose={() => setDialog(null)}
              onSaved={refresh}
            />
          )}
          {dialog?.kind === 'void' && (
            <VoidDialog
              tenantId={id}
              invoice={dialog.invoice}
              onClose={() => setDialog(null)}
              onSaved={refresh}
            />
          )}
        </>
      )}
    </div>
  );
}
