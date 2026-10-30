import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type { FormEvent } from 'react';
import {
  FEATURE_KEYS,
  GST_STATES,
  GST_STATE_CODES,
  PLAN_IDS,
  PLAN_TERM_KEYS,
  type Feature,
  type InvoiceView,
  type PlanId,
  type PlanTermsPatch,
  type PlanView,
  type PlatformCollegeBillingView,
} from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { FormError } from '../../components/layout/auth-layout';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Checkbox, Field, Input, Select } from '../../components/ui/field';
import { Card } from '../../components/ui/misc';
import { api } from '../../lib/api';
import { paiseToInput, rupees, saveErrors, toPaise } from '../../lib/billing';
import { platformPlans } from '../../lib/queries';
import { toast } from '../../lib/toast';

type Saved = (data: PlatformCollegeBillingView) => void;
const MONEY_TERMS = new Set(['pricePerStudentPaise', 'annualMinimumPaise']);
type NumberTerm = Exclude<(typeof PLAN_TERM_KEYS)[number], 'features'>;
const NUMBER_TERMS = PLAN_TERM_KEYS.filter((k): k is NumberTerm => k !== 'features');

/** A term typed in a form, as the API takes it (money in paise); undefined when left empty. */
function termValue(k: NumberTerm, raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  return MONEY_TERMS.has(k) ? toPaise(raw) : Number(raw.replace(/[,\s]/g, ''));
}
const termInput = (k: NumberTerm, v: number | undefined) =>
  v === undefined ? '' : MONEY_TERMS.has(k) ? paiseToInput(v) : String(v);

function FeatureChecks({
  idBase,
  value,
  onChange,
}: {
  idBase: string;
  value: Feature[];
  onChange: (v: Feature[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="grid gap-1 sm:grid-cols-2">
      <legend className="mb-1 text-meta font-semibold">{t('pbilling.terms.features')}</legend>
      {FEATURE_KEYS.map((f) => (
        <Checkbox
          key={f}
          id={`${idBase}-${f}`}
          checked={value.includes(f)}
          onChange={(on) => onChange(on ? [...value, f] : value.filter((x) => x !== f))}
        >
          {t(`feature.${f}`)}
        </Checkbox>
      ))}
    </fieldset>
  );
}

/** Platform › Billing › Plans: a plan's defaults for every college on it. */
export function PlanDialog({ plan, onClose }: { plan: PlanView; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(NUMBER_TERMS.map((k) => [k, termInput(k, plan.terms[k])])) as Record<
        NumberTerm,
        string
      >,
  );
  const [features, setFeatures] = useState<Feature[]>(plan.terms.features);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const body: PlanTermsPatch = { features };
    for (const k of NUMBER_TERMS) {
      const v = termValue(k, values[k]);
      if (v === undefined || Number.isNaN(v))
        return setError(t('pbilling.invalidNumber', { field: t(`pbilling.terms.${k}`) }));
      body[k] = v;
    }
    setSaving(true);
    try {
      await api.patch(`/platform/plans/${plan.id}`, body);
      void qc.invalidateQueries({ queryKey: platformPlans().queryKey });
      void qc.invalidateQueries({ queryKey: ['platform-billing'] });
      toast.success(t('common.saved'));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('pbilling.edit', { plan: t(`billing.plan.${plan.id}`) })}
      description={t('pbilling.plans.intro')}
    >
      <div className="grid gap-4">
        <FormError message={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          {NUMBER_TERMS.map((k) => (
            <Field
              key={k}
              label={t(`pbilling.terms.${k}`)}
              hint={MONEY_TERMS.has(k) ? t('pbilling.rupeesHint') : undefined}
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  aria-describedby={describedBy}
                  value={values[k]}
                  onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                />
              )}
            </Field>
          ))}
        </div>
        <FeatureChecks idBase={`plan-${plan.id}`} value={features} onChange={setFeatures} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

type Errors = { root?: string; fields: Record<string, string> };
const noErrors: Errors = { fields: {} };

/** A college's plan, term, invoice details and custom terms (platform console). */
export function SubscriptionForm({ view, onSaved }: { view: PlatformCollegeBillingView; onSaved: Saved }) {
  const { t } = useTranslation();
  const [v, setV] = useState({
    plan: view.plan as PlanId,
    seats: String(view.usage.seats.contracted),
    startedOn: view.startedOn ?? '',
    renewalDate: view.renewalDate ?? '',
    legalName: view.buyer?.legalName ?? '',
    address: view.buyer?.address ?? '',
    gstin: view.buyer?.gstin ?? '',
    stateCode: view.buyer?.stateCode ?? '36',
  });
  const [custom, setCustom] = useState(
    () =>
      Object.fromEntries(NUMBER_TERMS.map((k) => [k, termInput(k, view.custom?.[k])])) as Record<
        NumberTerm,
        string
      >,
  );
  const [customFeatures, setCustomFeatures] = useState<Feature[] | null>(view.custom?.features ?? null);
  const [errors, setErrors] = useState<Errors>(noErrors);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, [k]: e.target.value }));
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const terms: PlanTermsPatch = {};
    for (const k of NUMBER_TERMS) {
      const n = termValue(k, custom[k]);
      if (n !== undefined && Number.isNaN(n))
        return setErrors({
          root: t('pbilling.invalidNumber', { field: t(`pbilling.terms.${k}`) }),
          fields: {},
        });
      if (n !== undefined) terms[k] = n;
    }
    if (customFeatures) terms.features = customFeatures;
    const buyer = v.legalName.trim()
      ? {
          buyer: {
            legalName: v.legalName,
            address: v.address,
            gstin: v.gstin.trim() ? v.gstin.trim() : null,
            stateCode: v.stateCode,
          },
        }
      : {};
    setSaving(true);
    setErrors(noErrors);
    try {
      const data = await api.patch<PlatformCollegeBillingView>(`/platform/billing/${view.tenantId}`, {
        plan: v.plan,
        seats: Number(v.seats),
        ...(v.startedOn ? { startedOn: v.startedOn } : {}),
        renewalDate: v.renewalDate || null,
        terms: Object.keys(terms).length ? terms : null,
        ...buyer,
      });
      onSaved(data);
      toast.success(t('common.saved'));
    } catch (err) {
      setErrors(saveErrors(err, t('errors.generic')));
    } finally {
      setSaving(false);
    }
  };
  const fe = errors.fields;
  return (
    <Card className="p-5">
      <form
        onSubmit={(e) => void onSubmit(e)}
        noValidate
        className="grid gap-4"
        aria-labelledby="pbilling-subscription"
      >
        <h2 id="pbilling-subscription" className="text-heading font-semibold">
          {t('pbilling.subscription')}
        </h2>
        <FormError message={errors.root} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('pbilling.col.plan')}>
            {({ id }) => (
              <Select id={id} value={v.plan} onChange={set('plan')}>
                {PLAN_IDS.map((p) => (
                  <option key={p} value={p}>
                    {t(`billing.plan.${p}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('pbilling.seats')} error={fe.seats}>
            {({ id, invalid }) => (
              <Input
                id={id}
                inputMode="numeric"
                aria-invalid={invalid}
                value={v.seats}
                onChange={set('seats')}
              />
            )}
          </Field>
          <Field label={t('pbilling.startedOn')} error={fe.startedOn}>
            {({ id }) => <Input id={id} type="date" value={v.startedOn} onChange={set('startedOn')} />}
          </Field>
          <Field label={t('pbilling.renewalDate')} error={fe.renewalDate}>
            {({ id }) => <Input id={id} type="date" value={v.renewalDate} onChange={set('renewalDate')} />}
          </Field>
        </div>
        <fieldset className="grid gap-3 rounded-[var(--radius-md)] border border-line p-4">
          <legend className="px-1 text-meta font-semibold">{t('pbilling.buyer')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('pbilling.legalName')} error={fe['buyer.legalName']}>
              {({ id }) => <Input id={id} value={v.legalName} onChange={set('legalName')} />}
            </Field>
            <Field label={t('pbilling.state')}>
              {({ id }) => (
                <Select id={id} value={v.stateCode} onChange={set('stateCode')}>
                  {GST_STATE_CODES.map((c) => (
                    <option key={c} value={c}>
                      {GST_STATES[c]} ({c})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label={t('pbilling.address')} error={fe['buyer.address']}>
            {({ id }) => <Input id={id} value={v.address} onChange={set('address')} />}
          </Field>
          <Field label={t('pbilling.gstin')} error={fe['buyer.gstin']}>
            {({ id }) => (
              <Input id={id} className="font-mono uppercase" value={v.gstin} onChange={set('gstin')} />
            )}
          </Field>
        </fieldset>
        <details className="rounded-[var(--radius-md)] border border-line p-4">
          <summary className="cursor-pointer text-meta font-semibold">{t('pbilling.custom')}</summary>
          <p className="mt-2 text-caption text-fg-3">{t('pbilling.customHint')}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {NUMBER_TERMS.map((k) => (
              <Field
                key={k}
                label={t(`pbilling.terms.${k}`)}
                hint={t('pbilling.planValue', {
                  value: MONEY_TERMS.has(k) ? rupees(view.terms[k]) : String(view.terms[k]),
                })}
              >
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    aria-describedby={describedBy}
                    value={custom[k]}
                    onChange={(e) => setCustom((c) => ({ ...c, [k]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
          </div>
          <div className="mt-3 grid gap-2">
            <Checkbox
              id="custom-features"
              checked={customFeatures !== null}
              onChange={(on) => setCustomFeatures(on ? view.terms.features : null)}
            >
              {t('pbilling.customFeatures')}
            </Checkbox>
            {customFeatures && (
              <FeatureChecks idBase="custom" value={customFeatures} onChange={setCustomFeatures} />
            )}
          </div>
        </details>
        <Button type="submit" variant="primary" className="justify-self-start" loading={saving}>
          {t('common.save')}
        </Button>
      </form>
    </Card>
  );
}

type Line = { key: number; description: string; quantity: string; unit: string };
let lineKey = 0;
const newLine = (l: Partial<Line> = {}): Line => ({
  key: ++lineKey,
  description: '',
  quantity: '1',
  unit: '',
  ...l,
});

/** A new draft invoice, prefilled with what the plan suggests. */
export function InvoiceDialog({
  tenantId,
  suggested,
  onClose,
  onSaved,
}: {
  tenantId: string;
  suggested: PlatformCollegeBillingView['suggested'];
  onClose: () => void;
  onSaved: Saved;
}) {
  const { t } = useTranslation();
  const [key] = useState(() => crypto.randomUUID());
  const [period, setPeriod] = useState({ start: suggested.periodStart, end: suggested.periodEnd });
  const [dueDays, setDueDays] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>(() =>
    suggested.lines.length
      ? suggested.lines.map((l) =>
          newLine({
            description: l.description,
            quantity: String(l.quantity),
            unit: paiseToInput(l.unitPaise),
          }),
        )
      : [newLine()],
  );
  const [errors, setErrors] = useState<Errors>(noErrors);
  const [saving, setSaving] = useState(false);
  const edit = (k: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      periodStart: period.start,
      periodEnd: period.end,
      ...(dueDays.trim() ? { dueDays: Number(dueDays) } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      lines: lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPaise: toPaise(l.unit),
      })),
    };
    if (body.lines.some((l) => Number.isNaN(l.unitPaise) || !Number.isInteger(l.quantity)))
      return setErrors({ root: t('pbilling.invalidLines'), fields: {} });
    setSaving(true);
    setErrors(noErrors);
    try {
      onSaved(
        await api.postOnce<PlatformCollegeBillingView>(`/platform/billing/${tenantId}/invoices`, body, key),
      );
      toast.success(t('pbilling.drafted'));
      onClose();
    } catch (err) {
      setErrors(saveErrors(err, t('errors.generic')));
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('pbilling.newInvoice')}
      description={t('pbilling.newInvoiceHint')}
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-4">
        <FormError message={errors.root} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('pbilling.periodStart')} error={errors.fields.periodStart}>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={period.start}
                onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))}
              />
            )}
          </Field>
          <Field label={t('pbilling.periodEnd')} error={errors.fields.periodEnd}>
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={period.end}
                onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))}
              />
            )}
          </Field>
          <Field label={t('pbilling.dueDays')} hint={t('pbilling.dueDaysHint')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                inputMode="numeric"
                aria-describedby={describedBy}
                value={dueDays}
                onChange={(e) => setDueDays(e.target.value)}
              />
            )}
          </Field>
        </div>
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-meta font-semibold">{t('pbilling.lines')}</legend>
          {lines.map((l, i) => (
            <div key={l.key} className="grid gap-2 rounded-[var(--radius-md)] bg-surface-2 p-3">
              <Field label={t('pbilling.description')} error={errors.fields[`lines.${i}.description`]}>
                {({ id }) => (
                  <Input
                    id={id}
                    value={l.description}
                    onChange={(e) => edit(l.key, { description: e.target.value })}
                  />
                )}
              </Field>
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label={t('pbilling.quantity')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      inputMode="numeric"
                      value={l.quantity}
                      onChange={(e) => edit(l.key, { quantity: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={t('pbilling.unit')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      inputMode="decimal"
                      value={l.unit}
                      onChange={(e) => edit(l.key, { unit: e.target.value })}
                    />
                  )}
                </Field>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  aria-label={t('pbilling.removeLine', { n: i + 1 })}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          ))}
          {lines.length < 10 && (
            <Button
              variant="ghost"
              className="justify-self-start"
              onClick={() => setLines((ls) => [...ls, newLine()])}
            >
              <Plus className="size-4" aria-hidden /> {t('pbilling.addLine')}
            </Button>
          )}
        </fieldset>
        <Field label={t('pbilling.notes')} error={errors.fields.notes}>
          {({ id }) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {t('pbilling.createDraft')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Issuing gives the next number and fixes the invoice for good. */
export function IssueDialog({
  tenantId,
  invoice,
  onClose,
  onSaved,
}: {
  tenantId: string;
  invoice: InvoiceView;
  onClose: () => void;
  onSaved: Saved;
}) {
  const { t } = useTranslation();
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const issue = async () => {
    setBusy(true);
    try {
      onSaved(
        await api.postOnce<PlatformCollegeBillingView>(
          `/platform/billing/${tenantId}/invoices/${invoice.id}/issue`,
          {},
          key,
        ),
      );
      toast.success(t('pbilling.issued'));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.generic'));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('pbilling.issueTitle', { amount: rupees(invoice.totalPaise) })}
      description={t('pbilling.issueConfirm')}
    >
      <div className="grid gap-4">
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void issue()}>
            {t('pbilling.issue')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** D5's primary flow: a bank transfer seen in the account (amount, date, UTR). */
export function PaymentDialog({
  tenantId,
  invoice,
  onClose,
  onSaved,
}: {
  tenantId: string;
  invoice: InvoiceView;
  onClose: () => void;
  onSaved: Saved;
}) {
  const { t } = useTranslation();
  const [key] = useState(() => crypto.randomUUID());
  const [v, setV] = useState({
    amount: paiseToInput(invoice.balancePaise),
    paidOn: new Date().toISOString().slice(0, 10),
    utr: '',
    note: '',
  });
  const [errors, setErrors] = useState<Errors>(noErrors);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, [k]: e.target.value }));
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const amountPaise = toPaise(v.amount);
    if (Number.isNaN(amountPaise))
      return setErrors({
        fields: { amountPaise: t('pbilling.invalidNumber', { field: t('pbilling.amount') }) },
      });
    setSaving(true);
    setErrors(noErrors);
    try {
      onSaved(
        await api.postOnce<PlatformCollegeBillingView>(
          `/platform/billing/${tenantId}/invoices/${invoice.id}/payments`,
          { amountPaise, paidOn: v.paidOn, utr: v.utr, ...(v.note.trim() ? { note: v.note.trim() } : {}) },
          key,
        ),
      );
      toast.success(t('pbilling.paymentRecorded'));
      onClose();
    } catch (err) {
      setErrors(saveErrors(err, t('errors.generic')));
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('pbilling.recordPaymentFor', { number: invoice.number ?? '' })}
      description={t('pbilling.balance', { amount: rupees(invoice.balancePaise) })}
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-4">
        <FormError message={errors.root} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('pbilling.amount')} error={errors.fields.amountPaise}>
            {({ id, invalid }) => (
              <Input
                id={id}
                inputMode="decimal"
                aria-invalid={invalid}
                value={v.amount}
                onChange={set('amount')}
              />
            )}
          </Field>
          <Field label={t('pbilling.paidOn')} error={errors.fields.paidOn}>
            {({ id }) => <Input id={id} type="date" value={v.paidOn} onChange={set('paidOn')} />}
          </Field>
        </div>
        <Field label={t('pbilling.utr')} hint={t('pbilling.utrHint')} error={errors.fields.utr}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              className="font-mono uppercase"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={v.utr}
              onChange={set('utr')}
            />
          )}
        </Field>
        <Field label={t('pbilling.paymentNote')}>
          {({ id }) => <Input id={id} value={v.note} onChange={set('note')} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {t('pbilling.recordPayment')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Voids an issued invoice with no payments (the number stays used, with the reason). */
export function VoidDialog({
  tenantId,
  invoice,
  onClose,
  onSaved,
}: {
  tenantId: string;
  invoice: InvoiceView;
  onClose: () => void;
  onSaved: Saved;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>(noErrors);
  const [saving, setSaving] = useState(false);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors(noErrors);
    try {
      onSaved(
        await api.post<PlatformCollegeBillingView>(
          `/platform/billing/${tenantId}/invoices/${invoice.id}/void`,
          {
            reason,
          },
        ),
      );
      toast.success(t('pbilling.voided'));
      onClose();
    } catch (err) {
      setErrors(saveErrors(err, t('errors.generic')));
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('pbilling.voidTitle', { number: invoice.number ?? '' })}
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-4">
        <FormError message={errors.root} />
        <Field label={t('pbilling.voidReason')} error={errors.fields.reason}>
          {({ id, invalid }) => (
            <Input
              id={id}
              aria-invalid={invalid}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" loading={saving}>
            {t('pbilling.void')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
