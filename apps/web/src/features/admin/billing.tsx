import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Download, ExternalLink, Lock } from 'lucide-react';
import type { InvoiceView } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/error-state';
import { Illustration } from '../../components/ui/illustration';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { ProgressBar } from '../../components/ui/progress';
import { StatCard, StatGrid } from '../../components/ui/stat-card';
import { Table, THead, Td, TdNum, Th } from '../../components/ui/table';
import { ApiError, api, apiBlob, saveBlob } from '../../lib/api';
import { INVOICE_TONE, compact, count, day, rupees } from '../../lib/billing';
import { adminBilling } from '../../lib/queries';
import { SCREEN } from '../../lib/query-client';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';

/**
 * Admin › Billing (B10): the college's plan, seats and usage against its allowances, and its
 * invoices to download or pay online. Students and alumni never pay.
 */
export function AdminBilling() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const r = useQuery({ ...SCREEN, ...adminBilling() });
  const [busy, setBusy] = useState('');
  const v = r.data;
  const open = v?.invoices.filter((i) => i.status === 'issued' || i.status === 'overdue') ?? [];

  const download = async (inv: InvoiceView) => {
    setBusy(`pdf-${inv.id}`);
    try {
      saveBlob(
        await apiBlob(`/admin/billing/invoices/${inv.id}/pdf`),
        `${(inv.number ?? inv.id).replaceAll('/', '-')}.pdf`,
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setBusy('');
    }
  };
  const pay = async (inv: InvoiceView) => {
    setBusy(`pay-${inv.id}`);
    try {
      const { url } = await api.post<{ url: string }>(`/admin/billing/invoices/${inv.id}/pay`);
      window.location.assign(url);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
      setBusy('');
    }
  };

  return (
    <div className="grid gap-5">
      <p className="text-meta text-fg-2">{t('billing.intro')}</p>
      {r.isLoading && <Skeleton className="h-64" />}
      {r.isError && !v && <ErrorState error={r.error} onRetry={() => void r.refetch()} />}
      {v && (
        <>
          {params.get('paid') === '1' && (
            <p
              role="status"
              className="rounded-[var(--radius-md)] bg-success-surface p-3 text-meta text-success-ink"
            >
              {t('billing.paidReturn')}
            </p>
          )}
          {v.readOnly && (
            <div className="flex gap-3 rounded-[var(--radius-md)] border border-danger bg-danger-surface p-4">
              <Lock className="mt-0.5 size-5 flex-none text-danger-ink" aria-hidden />
              <div className="grid gap-1">
                <p className="font-semibold text-danger-ink">{t('billing.readOnly.title')}</p>
                <p className="text-meta text-fg-2">{t('billing.readOnly.body')}</p>
              </div>
            </div>
          )}
          <Card className="grid gap-2 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-title font-semibold">{t(`billing.plan.${v.plan}`)}</h2>
              {v.customDeal && <Badge tone="accent">{t('billing.customDeal')}</Badge>}
            </div>
            {v.plan !== 'pilot' && (
              <p className="text-meta text-fg-2">
                {t('billing.pricePerStudent', { price: rupees(v.terms.pricePerStudentPaise) })} ·{' '}
                {t('billing.minimum', { amount: rupees(v.terms.annualMinimumPaise, { paise: false }) })}
              </p>
            )}
            {v.plan !== 'pilot' && (
              <p className="text-meta text-fg-2">
                {t('billing.annual', { amount: rupees(v.annualPricePaise, { paise: false }) })}
              </p>
            )}
            {v.pilotEndsOn && (
              <p className="text-meta text-fg-2">{t('billing.pilotEnds', { date: day(v.pilotEndsOn) })}</p>
            )}
            {!v.pilotEndsOn && v.renewalDate && (
              <p className="text-meta text-fg-2">{t('billing.renews', { date: day(v.renewalDate) })}</p>
            )}
          </Card>
          <StatGrid className="md:grid-cols-3">
            <StatCard
              label={t('billing.seats')}
              value={v.usage.seats.used === null ? '—' : compact(v.usage.seats.used)}
              hint={
                <>
                  {t('billing.ofContracted', { seats: count(v.usage.seats.contracted) })}
                  <span className="mt-1 block">
                    {v.usage.seats.used === null ? t('billing.notCounted') : t('billing.seatsHint')}
                  </span>
                </>
              }
              tone={v.overSeats ? 'warning' : 'default'}
            />
            <Meter
              label={t('billing.whatsapp')}
              used={v.usage.whatsapp.used}
              allowance={v.usage.whatsapp.allowance}
            />
            <Meter
              label={t('billing.aiTokens')}
              used={v.usage.aiTokens.used}
              allowance={v.usage.aiTokens.allowance}
              note={
                v.usage.aiTokens.ownKey > 0
                  ? t('billing.ownKey', { tokens: compact(v.usage.aiTokens.ownKey) })
                  : undefined
              }
            />
          </StatGrid>
          {v.usage.aiByFeature.length > 0 && (
            <Table label={t('billing.aiByFeature')}>
              <THead>
                <tr>
                  <Th>{t('billing.aiFeature')}</Th>
                  <Th className="text-right">{t('billing.aiPlatform')}</Th>
                  <Th className="text-right">{t('billing.aiOwn')}</Th>
                </tr>
              </THead>
              <tbody>
                {v.usage.aiByFeature.map((f) => (
                  <tr key={f.feature}>
                    <Td>{t(`billing.feature.${f.feature}`)}</Td>
                    <TdNum>{count(f.platform)}</TdNum>
                    <TdNum>{count(f.own)}</TdNum>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <section className="grid gap-3">
            <h2 className="text-heading font-semibold">{t('billing.invoices')}</h2>
            {open.length > 0 && (
              <ul className="grid gap-2">
                {open.map((inv) => (
                  <li
                    key={inv.id}
                    className={cn(
                      'flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border p-3',
                      inv.status === 'overdue'
                        ? 'border-danger bg-danger-surface'
                        : 'border-line bg-surface-1',
                    )}
                  >
                    <span className="text-meta">
                      <span className="font-semibold">
                        {t('billing.toPay', { amount: rupees(inv.balancePaise), date: day(inv.dueOn) })}
                      </span>
                      <span className="block font-mono text-caption text-fg-3">{inv.number}</span>
                    </span>
                    {v.payOnline && (
                      <Button
                        variant="primary"
                        loading={busy === `pay-${inv.id}`}
                        onClick={() => void pay(inv)}
                        aria-label={t('billing.payNamed', { number: inv.number ?? '' })}
                      >
                        <ExternalLink className="size-4" aria-hidden /> {t('billing.payOnline')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {v.invoices.length === 0 ? (
              <EmptyState art={<Illustration kind="empty" />} title={t('billing.noInvoices')}>
                {t('billing.noInvoicesBody')}
              </EmptyState>
            ) : (
              <Table label={t('billing.invoices')}>
                <THead>
                  <tr>
                    <Th>{t('billing.col.number')}</Th>
                    <Th className="text-right">{t('billing.col.total')}</Th>
                    <Th className="text-right">{t('billing.col.balance')}</Th>
                    <Th>{t('billing.col.status')}</Th>
                    <Th>
                      <span className="sr-only">{t('billing.col.actions')}</span>
                    </Th>
                  </tr>
                </THead>
                <tbody>
                  {v.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <Td className="whitespace-nowrap">
                        <span className="font-mono">{inv.number}</span>
                        <span className="block text-caption text-fg-3">
                          {t('billing.issuedOn', { date: day(inv.issuedOn) })}
                        </span>
                      </Td>
                      <TdNum>{rupees(inv.totalPaise)}</TdNum>
                      <TdNum className="whitespace-nowrap">
                        {rupees(inv.balancePaise)}
                        {inv.balancePaise > 0 && (
                          <span className="block text-caption text-fg-3">
                            {t('billing.dueOn', { date: day(inv.dueOn) })}
                          </span>
                        )}
                      </TdNum>
                      <Td>
                        <Badge tone={INVOICE_TONE[inv.status]}>{t(`billing.status.${inv.status}`)}</Badge>
                      </Td>
                      <Td>
                        <div className="flex justify-end">
                          <Button
                            size="icon"
                            variant="ghost"
                            loading={busy === `pdf-${inv.id}`}
                            onClick={() => void download(inv)}
                            aria-label={t('billing.downloadNamed', { number: inv.number ?? '' })}
                            title={t('billing.downloadNamed', { number: inv.number ?? '' })}
                          >
                            <Download className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <p className="text-caption text-fg-3">{t('billing.payHint')}</p>
          </section>

          <section className="grid gap-1">
            <h2 className="text-heading font-semibold">{t('billing.billedTo')}</h2>
            {v.buyer ? (
              <p className="text-meta text-fg-2">
                {v.buyer.legalName}, {v.buyer.address}
                {v.buyer.gstin ? ` · GSTIN ${v.buyer.gstin}` : ''}
              </p>
            ) : (
              <p className="text-meta text-fg-2">{t('billing.billedToMissing')}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Meter({
  label,
  used,
  allowance,
  note,
}: {
  label: string;
  used: number;
  allowance: number;
  note?: string | undefined;
}) {
  const { t } = useTranslation();
  const text = t('billing.usedOf', { used: count(used), allowance: count(allowance) });
  return (
    <StatCard
      label={label}
      value={compact(used)}
      hint={
        <>
          {t('billing.ofAllowance', { allowance: compact(allowance) })}
          {note && <span className="block">{note}</span>}
          <ProgressBar
            className="mt-2"
            value={used}
            max={Math.max(1, allowance)}
            label={label}
            valueText={text}
            size="sm"
            tone={used >= allowance && allowance > 0 ? 'warning' : 'brand'}
          />
        </>
      }
    />
  );
}
