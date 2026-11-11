import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  INVOICE_REMINDER_DAYS,
  PLANS,
  PLAN_TERM_KEYS,
  READ_ONLY_AFTER_DAYS,
  Role,
  annualPricePaise,
  financialYearOf,
  formatRupees,
  gstSplit,
  invoiceNumber,
  istDay,
  mergeTerms,
  rupeesInWords,
  CREDIT_NOTE_PREFIX,
  type AdminBillingView,
  type PlatformAiPrices,
  type PlatformAiPricesView,
  type CreditNoteView,
  type creditNoteDraftBody,
  type BillingUsageView,
  type BillingWarning,
  type Buyer,
  type InvoiceLineView,
  type InvoiceView,
  type PaymentView,
  type AiUsageFeature,
  type PlanId,
  type PlanTerms,
  type PlanTermsPatch,
  type PlanView,
  type PlatformBillingRow,
  type PlatformCollegeBillingView,
  type invoiceDraftBody,
  type platformSubscriptionBody,
  type recordPaymentBody,
} from '@campuslink/shared';
import { requireTenantId, runInTenant, withPlatformScope } from '../../lib/context.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { ErrorCode } from '@campuslink/shared';
import type { Logger } from '../../lib/logger.js';
import type { JobQueue } from '../../lib/jobs.js';
import type { PaidEvent, PaymentProvider } from '../../lib/payments.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { TenantModel } from '../tenants/tenant.model.js';
import { findTenantById, invalidateTenant, type TenantRecord } from '../tenants/tenant.cache.js';
import type { FilesService } from '../files/files.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { UsersService } from '../users/users.service.js';
import {
  CreditNoteModel,
  InvoiceCounterModel,
  InvoiceModel,
  type CreditNoteDoc,
  PaymentModel,
  PlanSettingModel,
  PlatformSettingModel,
  type InvoiceDoc,
  type PaymentDoc,
} from './billing.model.js';
import type { EntitlementsService } from './entitlements.js';
import { invalidatePlans } from './entitlements.js';
import { renderInvoicePdf } from './invoice-pdf.js';

export const BILLING_DAILY_JOB = 'billing.daily';

/** The seller on every invoice, from env (the platform owner's business). */
export interface SellerConfig {
  name: string;
  address: string;
  gstin: string | null;
  stateCode: string | null;
  registered: boolean;
  gstRate: number;
  sacCode: string;
  prefix: string;
  termsDays: number;
  bankDetails: string | null;
}

export interface BillingDeps {
  seller: SellerConfig;
  files: FilesService;
  notifications: NotificationsService;
  users: UsersService;
  payments: PaymentProvider;
  entitlements: EntitlementsService;
  logger: Logger;
  /** This month's WhatsApp messages, in the current college (B3). */
  whatsappUsed: () => Promise<number>;
  /** This month's AI tokens by feature and key, in the current college (B11). */
  aiUsage: () => Promise<{
    byFeature: { feature: AiUsageFeature; platform: number; own: number }[];
    platform: { chatInput: number; chatOutput: number; embedding: number };
  }>;
  /**
   * What the platform pays per million tokens from env (cost estimate only); null when not set.
   * The defaults until the platform owner saves prices in the console (prompt 1b, R6).
   */
  aiPrices: PlatformAiPrices;
  tenantUrl: (tenant: TenantRecord, path: string) => string;
}

const PLAN_NAMES: Record<PlanId, string> = { pilot: 'Pilot', connect: 'Connect', placement: 'Placement' };
const DAY_MS = 86_400_000;
const addDays = (day: string, n: number) =>
  istDay(new Date(Date.parse(`${day}T00:00:00+05:30`) + n * DAY_MS));
/** Whole days from `a` to `b` (both YYYY-MM-DD). */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
const dayOrNull = (d: Date | null | undefined) => (d ? istDay(d) : null);
const isDuplicate = (e: unknown) => (e as { code?: number }).code === 11000;
/** Only the four price fields (a view or a body may carry more). */
const pick = (p: PlatformAiPrices): PlatformAiPrices => ({
  input: p.input,
  output: p.output,
  embedding: p.embedding,
  currency: p.currency,
});
const OPEN = ['issued', 'overdue'] as const;
/** What is still owed on an invoice: total − payments − credit notes (never below zero). */
const owed = (r: Pick<InvoiceDoc, 'totalPaise' | 'paidPaise' | 'creditedPaise'>) =>
  Math.max(0, r.totalPaise - r.paidPaise - (r.creditedPaise ?? 0));

const toPayment = (p: PaymentDoc): PaymentView => ({
  id: String(p._id),
  invoiceId: String(p.invoiceId),
  amountPaise: p.amountPaise,
  method: p.method,
  paidOn: p.paidOn,
  reference: p.reference,
  recordedAt: p.createdAt.toISOString(),
});

/**
 * Plans, invoices and payments (build B10). The platform owner sets a college's plan, issues
 * invoices and records bank payments (D5); the college's admins see their plan, usage and
 * invoices and may pay online. Non-payment makes a college read-only, never deletes anything.
 */
export class BillingService {
  constructor(private readonly d: BillingDeps) {}

  get payOnline() {
    return this.d.payments.available;
  }

  // ── Plans (platform) ─────────────────────────────

  async plans(): Promise<PlanView[]> {
    const rows = await PlanSettingModel.find({}).lean<{ plan: PlanId; terms: PlanTermsPatch }[]>();
    const byPlan = new Map(rows.map((r) => [r.plan, r.terms]));
    return (Object.keys(PLANS) as PlanId[]).map((id) => {
      const defaults = mergeTerms(PLANS[id]);
      const terms = mergeTerms(PLANS[id], byPlan.get(id));
      const changed = PLAN_TERM_KEYS.filter((k) => JSON.stringify(terms[k]) !== JSON.stringify(defaults[k]));
      return { id, terms, defaults, changed };
    });
  }

  async updatePlan(actorId: string, plan: PlanId, patch: PlanTermsPatch, meta: RequestMetaLite) {
    const current = (await PlanSettingModel.findOne({ plan }).lean<{ terms: PlanTermsPatch }>())?.terms ?? {};
    const terms = { ...current, ...patch };
    await PlanSettingModel.updateOne(
      { plan },
      { $set: { terms, updatedBy: new Types.ObjectId(actorId) } },
      { upsert: true },
    );
    invalidatePlans();
    // Colleges on the plan pick the change up at once here; other instances within a minute.
    const slugs = await TenantModel.find({ 'subscription.plan': plan }).select('slug').lean();
    for (const t of slugs) invalidateTenant(t.slug);
    await audit.record(
      {
        action: 'platform.plan_changed',
        actorId,
        targetType: 'plan',
        targetId: plan,
        meta: { fields: Object.keys(patch) },
      },
      meta,
    );
    return (await this.plans()).find((p) => p.id === plan);
  }

  // ── Views ─────────────────────────────

  async usage(t: TenantRecord, now = new Date()): Promise<BillingUsageView> {
    const [whatsapp, ai] = await Promise.all([this.d.whatsappUsed(), this.d.aiUsage()]);
    const sum = (k: 'platform' | 'own') => ai.byFeature.reduce((n, f) => n + f[k], 0);
    return {
      month: now.toISOString().slice(0, 7),
      whatsapp: { used: whatsapp, allowance: this.d.entitlements.limit(t, 'whatsapp') },
      aiTokens: {
        used: sum('platform'),
        allowance: this.d.entitlements.limit(t, 'aiTokens'),
        ownKey: sum('own'),
      },
      aiByFeature: ai.byFeature,
      seats: {
        used: t.billing?.seatsUsed ?? null,
        contracted: this.d.entitlements.limit(t, 'seats'),
        countedAt: t.billing?.seatsCountedAt ? t.billing.seatsCountedAt.toISOString() : null,
      },
    };
  }

  private termsOf(t: TenantRecord): PlanTerms {
    return t.terms ?? mergeTerms(PLANS.pilot);
  }

  /** Admin › Billing: in the college's context. Drafts are the platform's and never shown here. */
  async adminView(t: TenantRecord, opts: { drafts?: boolean } = {}): Promise<AdminBillingView> {
    const plan = t.subscription?.plan ?? 'pilot';
    const terms = this.termsOf(t);
    const seats = t.subscription?.seats ?? 0;
    const startedOn = dayOrNull(t.subscription?.startedOn);
    const renewalDate = dayOrNull(t.subscription?.renewalDate);
    const usage = await this.usage(t);
    return {
      plan,
      terms,
      customDeal: !!t.subscription?.terms && Object.keys(t.subscription.terms).length > 0,
      startedOn,
      renewalDate,
      pilotEndsOn:
        plan === 'pilot'
          ? (renewalDate ?? (startedOn && terms.days ? addDays(startedOn, terms.days - 1) : null))
          : null,
      annualPricePaise: annualPricePaise(terms, seats),
      usage,
      overSeats: usage.seats.used !== null && usage.seats.used > seats,
      readOnly: !!t.billing?.readOnlyAt,
      readOnlySince: t.billing?.readOnlyAt ? t.billing.readOnlyAt.toISOString() : null,
      invoices: await this.invoices(opts.drafts ?? false),
      creditNotes: await this.creditNotes(opts.drafts ?? false),
      payOnline: this.d.payments.available,
      buyer: t.billing?.buyer ?? null,
    };
  }

  /** The small notice the admin screens show (over seats, pilot ending, overdue, read-only). */
  async notice(t: TenantRecord, now = new Date()) {
    const today = istDay(now);
    const v = { plan: t.subscription?.plan ?? 'pilot', seats: t.subscription?.seats ?? 0 } as const;
    const terms = this.termsOf(t);
    const startedOn = dayOrNull(t.subscription?.startedOn);
    const pilotEndsOn =
      v.plan === 'pilot'
        ? (dayOrNull(t.subscription?.renewalDate) ??
          (startedOn && terms.days ? addDays(startedOn, terms.days - 1) : null))
        : null;
    const overdue = await InvoiceModel.countDocuments({ status: 'overdue' });
    return {
      readOnly: !!t.billing?.readOnlyAt,
      overdue,
      overSeats: t.billing?.seatsUsed != null && t.billing.seatsUsed > v.seats,
      seatsUsed: t.billing?.seatsUsed ?? null,
      seats: v.seats,
      /** The pilot's last day when it is within 14 days or past. */
      pilotEndsOn: pilotEndsOn && daysBetween(today, pilotEndsOn) <= 14 ? pilotEndsOn : null,
    };
  }

  private async invoices(drafts: boolean): Promise<InvoiceView[]> {
    const rows = await InvoiceModel.find(drafts ? {} : { status: { $ne: 'draft' } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<InvoiceDoc[]>();
    const payments = await PaymentModel.find({ invoiceId: { $in: rows.map((r) => r._id) } })
      .sort({ createdAt: 1 })
      .lean<PaymentDoc[]>();
    return rows.map((r) =>
      this.toView(
        r,
        payments.filter((p) => String(p.invoiceId) === String(r._id)),
      ),
    );
  }

  private toView(r: InvoiceDoc, payments: PaymentDoc[]): InvoiceView {
    const buyer: Buyer | null = r.buyer
      ? {
          legalName: r.buyer.name,
          address: r.buyer.address,
          gstin: r.buyer.gstin,
          stateCode: r.buyer.stateCode as Buyer['stateCode'],
        }
      : null;
    return {
      id: String(r._id),
      number: r.number,
      status: r.status,
      issuedOn: r.issuedOn,
      dueOn: r.dueOn,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      lines: r.lines.map((l) => ({ ...l })),
      taxablePaise: r.taxablePaise,
      gst: { ...r.gst },
      totalPaise: r.totalPaise,
      paidPaise: r.paidPaise,
      creditedPaise: r.creditedPaise ?? 0,
      balancePaise: r.status === 'void' ? 0 : owed(r),
      totalInWords: rupeesInWords(r.totalPaise),
      sacCode: r.sacCode,
      buyer,
      notes: r.notes,
      voidReason: r.voidReason,
      hasPdf: r.status !== 'draft',
      payLinkOpen: !!r.payLink && (r.status === 'issued' || r.status === 'overdue'),
      payments: payments.map(toPayment),
    };
  }

  /** What the plan suggests invoicing for the current term (the platform owner may edit it). */
  suggestedInvoice(t: TenantRecord, now = new Date()): PlatformCollegeBillingView['suggested'] {
    const plan = t.subscription?.plan ?? 'pilot';
    const terms = this.termsOf(t);
    const seats = t.subscription?.seats ?? 0;
    const fy = financialYearOf(now);
    const start = dayOrNull(t.subscription?.startedOn) ?? `${fy.slice(0, 4)}-04-01`;
    const end =
      dayOrNull(t.subscription?.renewalDate) ??
      addDays(`${Number(start.slice(0, 4)) + 1}${start.slice(4)}`, -1);
    const lines: InvoiceLineView[] = [];
    if (terms.pricePerStudentPaise > 0 || terms.annualMinimumPaise > 0) {
      const bySeats = seats * terms.pricePerStudentPaise;
      if (bySeats >= terms.annualMinimumPaise)
        lines.push({
          description: `${PLAN_NAMES[plan]} plan: ${seats.toLocaleString('en-IN')} students at ${formatRupees(terms.pricePerStudentPaise)} per student per year`,
          quantity: seats,
          unitPaise: terms.pricePerStudentPaise,
          amountPaise: bySeats,
        });
      else
        lines.push({
          description: `${PLAN_NAMES[plan]} plan: annual minimum (covers up to ${Math.ceil(terms.annualMinimumPaise / Math.max(1, terms.pricePerStudentPaise)).toLocaleString('en-IN')} students)`,
          quantity: 1,
          unitPaise: terms.annualMinimumPaise,
          amountPaise: terms.annualMinimumPaise,
        });
    }
    return { periodStart: start, periodEnd: end, lines };
  }

  // ── AI prices (prompt 1b, R6) ─────────────────────────────

  /** The console's prices: the saved ones once the platform owner saved some, else env's. */
  async aiPrices(): Promise<PlatformAiPricesView> {
    const saved = await PlatformSettingModel.findOne({ key: 'ai_prices' }).lean<{
      value: PlatformAiPrices;
      updatedAt: Date;
    }>();
    const defaults = { ...this.d.aiPrices };
    return saved
      ? { ...pick(saved.value), source: 'saved', defaults, updatedAt: saved.updatedAt.toISOString() }
      : { ...defaults, source: 'env', defaults, updatedAt: null };
  }

  /** Saves what the platform pays per million tokens; audited with the old and new values. */
  async updateAiPrices(actorId: string, body: PlatformAiPrices, meta: RequestMetaLite) {
    const old = pick(await this.aiPrices());
    const value = pick(body);
    await PlatformSettingModel.updateOne(
      { key: 'ai_prices' },
      { $set: { value, updatedBy: new Types.ObjectId(actorId) } },
      { upsert: true },
    );
    await audit.record(
      {
        action: 'platform.ai_prices_changed',
        actorId,
        targetType: 'platform',
        targetId: 'ai_prices',
        // Flat values (the audit log keeps primitives): each price before and after.
        meta: Object.fromEntries(
          (Object.keys(value) as (keyof PlatformAiPrices)[]).flatMap((k) => [
            [`${k}Before`, old[k]],
            [`${k}After`, value[k]],
          ]),
        ),
      },
      meta,
    );
    return this.aiPrices();
  }

  /** The platform's cost for a college's tokens on its provider, at the prices it set. */
  private async aiCost(p: { chatInput: number; chatOutput: number; embedding: number }) {
    const { input, output, embedding, currency } = await this.aiPrices();
    const priced = input !== null || output !== null || embedding !== null;
    const estimate = priced
      ? Math.round(
          ((p.chatInput * (input ?? 0) + p.chatOutput * (output ?? 0) + p.embedding * (embedding ?? 0)) /
            1_000_000) *
            100,
        ) / 100
      : null;
    return { ...p, estimate, currency };
  }

  private warnings(t: TenantRecord): BillingWarning[] {
    const w: BillingWarning[] = [];
    if (!this.d.seller.sacCode) w.push('no_sac_code');
    if (!t.billing?.buyer) w.push('no_buyer');
    if (!this.d.seller.registered) w.push('seller_unregistered');
    return w;
  }

  // ── Platform: colleges ─────────────────────────────

  private async college(id: string): Promise<TenantRecord> {
    const t = await findTenantById(id).catch(() => null);
    if (!t || t.kind !== 'college') throw notFound('College');
    return t;
  }

  async overview(): Promise<PlatformBillingRow[]> {
    const tenants = await TenantModel.find({ kind: 'college' })
      .sort({ createdAt: -1 })
      .lean<(TenantRecord & { createdAt: Date })[]>();
    // One grouped read of every college's open invoices: sums only, nothing about members.
    const open = await withPlatformScope('billing:outstanding', () =>
      InvoiceModel.aggregate<{ _id: Types.ObjectId; outstanding: number; overdue: number }>([
        { $match: { tenantId: { $in: tenants.map((t) => t._id) }, status: { $in: [...OPEN] } } },
        {
          $group: {
            _id: '$tenantId',
            outstanding: {
              $sum: {
                $max: [
                  0,
                  {
                    $subtract: ['$totalPaise', { $add: ['$paidPaise', { $ifNull: ['$creditedPaise', 0] }] }],
                  },
                ],
              },
            },
            overdue: { $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] } },
          },
        },
      ]),
    );
    const byId = new Map(open.map((o) => [String(o._id), o]));
    return tenants.map((t) => ({
      tenantId: String(t._id),
      slug: t.slug,
      name: t.branding.displayName,
      plan: (t.subscription?.plan ?? 'pilot') as PlanId,
      seats: t.subscription?.seats ?? 0,
      seatsUsed: t.billing?.seatsUsed ?? null,
      renewalDate: dayOrNull(t.subscription?.renewalDate),
      outstandingPaise: byId.get(String(t._id))?.outstanding ?? 0,
      overdue: byId.get(String(t._id))?.overdue ?? 0,
      readOnly: !!t.billing?.readOnlyAt,
    }));
  }

  async collegeView(id: string): Promise<PlatformCollegeBillingView> {
    const t = await this.college(id);
    return runInTenant(t._id, async () => ({
      ...(await this.adminView(t, { drafts: true })),
      tenantId: String(t._id),
      slug: t.slug,
      name: t.branding.displayName,
      custom: t.subscription?.terms ?? null,
      suggested: this.suggestedInvoice(t),
      warnings: this.warnings(t),
      aiCost: await this.aiCost((await this.d.aiUsage()).platform),
    }));
  }

  async updateSubscription(
    actorId: string,
    id: string,
    body: z.output<typeof platformSubscriptionBody>,
    meta: RequestMetaLite,
  ) {
    const t = await this.college(id);
    const set: Record<string, unknown> = {};
    if (body.plan) set['subscription.plan'] = body.plan;
    if (body.seats !== undefined) set['subscription.seats'] = body.seats;
    if (body.startedOn !== undefined)
      set['subscription.startedOn'] = new Date(`${body.startedOn}T00:00:00+05:30`);
    if (body.renewalDate !== undefined)
      set['subscription.renewalDate'] = body.renewalDate
        ? new Date(`${body.renewalDate}T00:00:00+05:30`)
        : null;
    if (body.terms !== undefined)
      set['subscription.terms'] = body.terms && Object.keys(body.terms).length ? body.terms : null;
    if (body.buyer) set['billing.buyer'] = body.buyer;
    if (Object.keys(set).length) await TenantModel.updateOne({ _id: t._id }, { $set: set });
    invalidateTenant(t.slug);
    const fields = Object.keys(set);
    await audit.record(
      {
        action: 'platform.subscription_changed',
        actorId,
        targetType: 'tenant',
        targetId: id,
        meta: { fields },
      },
      meta,
    );
    await audit.recordInTenant(
      t._id,
      { action: 'billing.subscription_changed', targetType: 'tenant', targetId: id, meta: { fields } },
      meta,
    );
    return this.collegeView(id);
  }

  // ── Invoices ─────────────────────────────

  private totals(lines: { quantity: number; unitPaise: number }[], placeOfSupply: string | null) {
    const taxablePaise = lines.reduce((s, l) => s + l.quantity * l.unitPaise, 0);
    const s = this.d.seller;
    const gst = gstSplit({
      taxablePaise,
      ratePercent: s.gstRate,
      registered: s.registered,
      sellerState: s.stateCode ?? '',
      placeOfSupply: placeOfSupply ?? s.stateCode ?? '',
    });
    return { taxablePaise, gst, totalPaise: taxablePaise + gst.taxPaise };
  }

  async createDraft(
    actorId: string,
    id: string,
    body: z.output<typeof invoiceDraftBody>,
    meta: RequestMetaLite,
  ) {
    const t = await this.college(id);
    const lines = body.lines.map((l) => ({ ...l, amountPaise: l.quantity * l.unitPaise }));
    const inv = await runInTenant(t._id, () =>
      InvoiceModel.create({
        status: 'draft',
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        dueDays: body.dueDays ?? this.d.seller.termsDays,
        lines,
        ...this.totals(lines, t.billing?.buyer?.stateCode ?? null),
        sacCode: this.d.seller.sacCode,
        notes: body.notes ?? null,
      }),
    );
    await audit.record(
      {
        action: 'platform.invoice_drafted',
        actorId,
        targetType: 'invoice',
        targetId: String(inv._id),
        meta: { tenantId: id },
      },
      meta,
    );
    return this.collegeView(id);
  }

  async discardDraft(actorId: string, id: string, invoiceId: string, meta: RequestMetaLite) {
    const t = await this.college(id);
    const r = await runInTenant(t._id, () => InvoiceModel.deleteOne({ _id: invoiceId, status: 'draft' }));
    if (!r.deletedCount) throw notFound('Draft invoice');
    await audit.record(
      {
        action: 'platform.invoice_discarded',
        actorId,
        targetType: 'invoice',
        targetId: invoiceId,
        meta: { tenantId: id },
      },
      meta,
    );
    return this.collegeView(id);
  }

  /** The next number in the seller's series for a financial year (unique index; retried on a race). */
  async nextNumber(fy: string, prefix = this.d.seller.prefix): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        const c = await InvoiceCounterModel.findOneAndUpdate(
          { prefix, fy },
          { $inc: { seq: 1 } },
          { upsert: true, returnDocument: 'after' },
        ).lean<{ seq: number }>();
        if (!c) throw new Error('Invoice counter missing');
        return invoiceNumber(prefix, fy, c.seq);
      } catch (e) {
        // Two first issues of a year can both try to create the counter; one wins, the other retries.
        if (isDuplicate(e) && attempt < 3) continue;
        throw e;
      }
    }
  }

  /**
   * Issues a draft: claims it (once), gives it the next number, fixes both parties and the tax as
   * they are today, and renders the PDF. A failed render is redone on download.
   */
  async issue(actorId: string, id: string, invoiceId: string, meta: RequestMetaLite, now = new Date()) {
    const t = await this.college(id);
    const buyer = t.billing?.buyer;
    if (!buyer)
      throw new AppError(409, ErrorCode.CONFLICT, 'Add the college’s legal name, address and state first');
    const issuedOn = istDay(now);
    const s = this.d.seller;
    const issued = await runInTenant(t._id, async () => {
      const draft = await InvoiceModel.findOne({ _id: invoiceId, status: 'draft' }).lean<InvoiceDoc>();
      if (!draft) throw notFound('Draft invoice');
      const claimed = await InvoiceModel.findOneAndUpdate(
        { _id: invoiceId, status: 'draft' },
        {
          $set: {
            status: 'issued',
            issuedOn,
            dueOn: addDays(issuedOn, draft.dueDays),
            ...this.totals(draft.lines, buyer.stateCode),
            sacCode: s.sacCode,
            seller: { name: s.name, address: s.address, gstin: s.gstin, stateCode: s.stateCode },
            buyer: {
              name: buyer.legalName,
              address: buyer.address,
              gstin: buyer.gstin,
              stateCode: buyer.stateCode,
            },
          },
        },
        { returnDocument: 'after' },
      ).lean<InvoiceDoc>();
      if (!claimed) throw notFound('Draft invoice');
      const fy = financialYearOf(now);
      let number: string;
      try {
        number = await this.nextNumber(fy);
      } catch (e) {
        await InvoiceModel.updateOne(
          { _id: invoiceId },
          { $set: { status: 'draft', issuedOn: null, dueOn: null } },
        );
        throw e;
      }
      await InvoiceModel.updateOne({ _id: invoiceId }, { $set: { number, fy } });
      const inv = { ...claimed, number, fy };
      await this.renderAndStore(inv).catch((err: unknown) =>
        this.d.logger.warn({ err, invoiceId }, 'invoice pdf render failed; it will render on download'),
      );
      for (const admin of await this.d.users.activeIdsWithRole(Role.COLLEGE_ADMIN))
        await this.d.notifications.notify(admin, 'invoice_issued', {
          number,
          amount: formatRupees(inv.totalPaise),
          due: inv.dueOn ?? '',
        });
      await audit.record(
        { action: 'billing.invoice_issued', targetType: 'invoice', targetId: invoiceId, meta: { number } },
        meta,
      );
      return inv;
    });
    await audit.record(
      {
        action: 'platform.invoice_issued',
        actorId,
        targetType: 'invoice',
        targetId: invoiceId,
        meta: { tenantId: id, number: issued.number },
      },
      meta,
    );
    return this.collegeView(id);
  }

  private async renderAndStore(inv: InvoiceDoc): Promise<Buffer> {
    if (!inv.number || !inv.issuedOn || !inv.dueOn || !inv.seller || !inv.buyer) throw notFound('Invoice');
    const pdf = await renderInvoicePdf({
      number: inv.number,
      issuedOn: inv.issuedOn,
      dueOn: inv.dueOn,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      registered: inv.gst.kind !== 'none',
      seller: inv.seller,
      buyer: inv.buyer,
      lines: inv.lines,
      sacCode: inv.sacCode,
      taxablePaise: inv.taxablePaise,
      gst: inv.gst,
      totalPaise: inv.totalPaise,
      totalInWords: rupeesInWords(inv.totalPaise),
      notes: inv.notes,
      bankDetails: this.d.seller.bankDetails,
    });
    const stored = await this.d.files.storeInvoice(pdf);
    await InvoiceModel.updateOne({ _id: inv._id, pdfFileId: null }, { $set: { pdfFileId: stored.id } });
    return pdf;
  }

  /** An issued invoice's PDF, in the current college (drafts have none). */
  async pdf(invoiceId: string): Promise<{ data: Buffer; name: string }> {
    const inv = await InvoiceModel.findOne({ _id: invoiceId, status: { $ne: 'draft' } }).lean<InvoiceDoc>();
    if (!inv?.number) throw notFound('Invoice');
    const data = inv.pdfFileId
      ? await this.d.files.read(String(inv.pdfFileId))
      : await this.renderAndStore(inv);
    return { data, name: `${inv.number.replaceAll('/', '-')}.pdf` };
  }

  async platformPdf(id: string, invoiceId: string) {
    const t = await this.college(id);
    return runInTenant(t._id, () => this.pdf(invoiceId));
  }

  async voidInvoice(actorId: string, id: string, invoiceId: string, reason: string, meta: RequestMetaLite) {
    const t = await this.college(id);
    await runInTenant(t._id, async () => {
      if (await PaymentModel.exists({ invoiceId }))
        throw conflict('This invoice has payments recorded against it; issue a credit note instead');
      const r = await InvoiceModel.updateOne(
        { _id: invoiceId, status: { $in: [...OPEN] } },
        { $set: { status: 'void', voidReason: reason, payLink: null } },
      );
      if (!r.modifiedCount) throw notFound('Open invoice');
      await audit.record(
        { action: 'billing.invoice_voided', targetType: 'invoice', targetId: invoiceId },
        meta,
      );
      await this.refreshReadOnly(t);
    });
    await audit.record(
      {
        action: 'platform.invoice_voided',
        actorId,
        targetType: 'invoice',
        targetId: invoiceId,
        meta: { tenantId: id },
      },
      meta,
    );
    return this.collegeView(id);
  }

  // ── Credit notes (prompt 1b, R5) ─────────────────────────────

  private async creditNotes(drafts: boolean): Promise<CreditNoteView[]> {
    const rows = await CreditNoteModel.find(drafts ? {} : { status: 'issued' })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<CreditNoteDoc[]>();
    const invoices = await InvoiceModel.find({ _id: { $in: rows.map((r) => r.invoiceId) } })
      .select('number')
      .lean<{ _id: Types.ObjectId; number: string | null }[]>();
    const numberOf = new Map(invoices.map((i) => [String(i._id), i.number ?? '']));
    return rows.map((r) => ({
      id: String(r._id),
      invoiceId: String(r.invoiceId),
      invoiceNumber: numberOf.get(String(r.invoiceId)) ?? '',
      number: r.number,
      status: r.status,
      issuedOn: r.issuedOn,
      lines: r.lines.map((l) => ({ ...l })),
      taxablePaise: r.taxablePaise,
      gst: { ...r.gst },
      totalPaise: r.totalPaise,
      totalInWords: rupeesInWords(r.totalPaise),
      reason: r.reason,
      hasPdf: r.status === 'issued',
    }));
  }

  /**
   * The tax on a credit note mirrors its invoice: the same rate and the same kind (intra-state,
   * inter-state or none) whatever has changed since, so the two always net off.
   */
  private creditTotals(inv: InvoiceDoc, lines: { quantity: number; unitPaise: number }[]) {
    const taxablePaise = lines.reduce((s, l) => s + l.quantity * l.unitPaise, 0);
    const gst = gstSplit({
      taxablePaise,
      ratePercent: inv.gst.ratePercent,
      registered: inv.gst.kind !== 'none',
      // Two codes that are equal (intra) or not (inter): only the kind matters here.
      sellerState: '00',
      placeOfSupply: inv.gst.kind === 'intra' ? '00' : '01',
    });
    return {
      taxablePaise,
      gst: { ...gst, stateTaxName: inv.gst.stateTaxName },
      totalPaise: taxablePaise + gst.taxPaise,
    };
  }

  /** What a new credit note may still take off an invoice (its total less issued credit notes). */
  private creditLeft(inv: InvoiceDoc) {
    return inv.totalPaise - (inv.creditedPaise ?? 0);
  }

  async draftCreditNote(
    actorId: string,
    id: string,
    invoiceId: string,
    body: z.output<typeof creditNoteDraftBody>,
    meta: RequestMetaLite,
  ) {
    const t = await this.college(id);
    const cn = await runInTenant(t._id, async () => {
      const inv = await InvoiceModel.findOne({
        _id: invoiceId,
        status: { $in: ['issued', 'overdue', 'paid'] },
      }).lean<InvoiceDoc>();
      if (!inv?.number) throw notFound('Issued invoice');
      const lines = body.lines.map((l) => ({ ...l, amountPaise: l.quantity * l.unitPaise }));
      const totals = this.creditTotals(inv, lines);
      if (totals.totalPaise > this.creditLeft(inv))
        throw conflict('That is more than what is left of the invoice after earlier credit notes');
      return CreditNoteModel.create({
        invoiceId: inv._id,
        lines,
        ...totals,
        reason: body.reason,
        createdBy: new Types.ObjectId(actorId),
      });
    });
    await audit.record(
      {
        action: 'platform.credit_note_drafted',
        actorId,
        targetType: 'credit_note',
        targetId: String(cn._id),
        meta: { tenantId: id, invoiceId },
      },
      meta,
    );
    return this.collegeView(id);
  }

  /** A draft that will not be issued is voided (kept, never numbered). */
  async voidCreditNote(actorId: string, id: string, creditNoteId: string, meta: RequestMetaLite) {
    const t = await this.college(id);
    const r = await runInTenant(t._id, () =>
      CreditNoteModel.updateOne({ _id: creditNoteId, status: 'draft' }, { $set: { status: 'void' } }),
    );
    if (!r.modifiedCount) throw notFound('Draft credit note');
    await audit.record(
      {
        action: 'platform.credit_note_voided',
        actorId,
        targetType: 'credit_note',
        targetId: creditNoteId,
        meta: { tenantId: id },
      },
      meta,
    );
    return this.collegeView(id);
  }

  /**
   * Issues a draft credit note: claims it, takes its amount off the invoice's balance (never past
   * what is left after earlier credit notes), gives it the next `CN` number and renders the PDF. A
   * credit note that settles the invoice ends read-only like a payment. Issuing twice is a no-op.
   */
  async issueCreditNote(
    actorId: string,
    id: string,
    creditNoteId: string,
    meta: RequestMetaLite,
    now = new Date(),
  ) {
    const t = await this.college(id);
    const issued = await runInTenant(t._id, async () => {
      const current = await CreditNoteModel.findOne({ _id: creditNoteId }).lean<CreditNoteDoc>();
      if (current?.status === 'issued') return null;
      if (current?.status !== 'draft') throw notFound('Draft credit note');
      const claimed = await CreditNoteModel.findOneAndUpdate(
        { _id: creditNoteId, status: 'draft' },
        {
          $set: { status: 'issued', issuedOn: istDay(now), issuedBy: new Types.ObjectId(actorId) },
        },
        { returnDocument: 'after' },
      ).lean<CreditNoteDoc>();
      if (!claimed) return null; // issued by a concurrent request
      const undoClaim = () =>
        CreditNoteModel.updateOne(
          { _id: creditNoteId },
          { $set: { status: 'draft', issuedOn: null, issuedBy: null } },
        );
      // The cap, atomically: the invoice's credited total never exceeds its total.
      const inv = await InvoiceModel.findOneAndUpdate(
        {
          _id: claimed.invoiceId,
          status: { $in: ['issued', 'overdue', 'paid'] },
          $expr: {
            $lte: [{ $add: [{ $ifNull: ['$creditedPaise', 0] }, claimed.totalPaise] }, '$totalPaise'],
          },
        },
        { $inc: { creditedPaise: claimed.totalPaise }, $set: { payLink: null } },
        { returnDocument: 'after' },
      ).lean<InvoiceDoc>();
      if (!inv) {
        await undoClaim();
        throw conflict('That is more than what is left of the invoice after earlier credit notes');
      }
      let number: string;
      const fy = financialYearOf(now);
      try {
        number = await this.nextNumber(fy, CREDIT_NOTE_PREFIX);
      } catch (e) {
        await InvoiceModel.updateOne({ _id: inv._id }, { $inc: { creditedPaise: -claimed.totalPaise } });
        await undoClaim();
        throw e;
      }
      await CreditNoteModel.updateOne({ _id: creditNoteId }, { $set: { number, fy } });
      const cn = { ...claimed, number, fy };
      if (owed(inv) === 0 && (OPEN as readonly string[]).includes(inv.status)) {
        await InvoiceModel.updateOne({ _id: inv._id }, { $set: { status: 'paid', paidAt: now } });
        await this.refreshReadOnly(t, now);
      }
      await this.renderCreditNote(cn, inv).catch((err: unknown) =>
        this.d.logger.warn(
          { err, creditNoteId },
          'credit note pdf render failed; it will render on download',
        ),
      );
      await audit.record(
        {
          action: 'billing.credit_note_issued',
          targetType: 'credit_note',
          targetId: creditNoteId,
          meta: { number, invoice: inv.number, amountPaise: cn.totalPaise },
        },
        meta,
      );
      return cn;
    });
    if (issued)
      await audit.record(
        {
          action: 'platform.credit_note_issued',
          actorId,
          targetType: 'credit_note',
          targetId: creditNoteId,
          meta: { tenantId: id, number: issued.number },
        },
        meta,
      );
    return this.collegeView(id);
  }

  private async renderCreditNote(cn: CreditNoteDoc, inv: InvoiceDoc): Promise<Buffer> {
    if (!cn.number || !cn.issuedOn || !inv.number || !inv.issuedOn || !inv.seller || !inv.buyer)
      throw notFound('Credit note');
    const pdf = await renderInvoicePdf({
      number: cn.number,
      issuedOn: cn.issuedOn,
      registered: inv.gst.kind !== 'none',
      seller: inv.seller,
      buyer: inv.buyer,
      lines: cn.lines,
      sacCode: inv.sacCode,
      taxablePaise: cn.taxablePaise,
      gst: cn.gst,
      totalPaise: cn.totalPaise,
      totalInWords: rupeesInWords(cn.totalPaise),
      notes: null,
      bankDetails: null,
      creditNote: { invoiceNumber: inv.number, invoiceDate: inv.issuedOn, reason: cn.reason },
    });
    const stored = await this.d.files.storeInvoice(pdf);
    await CreditNoteModel.updateOne({ _id: cn._id, pdfFileId: null }, { $set: { pdfFileId: stored.id } });
    return pdf;
  }

  /** An issued credit note's PDF, in the current college. */
  async creditNotePdf(creditNoteId: string): Promise<{ data: Buffer; name: string }> {
    const cn = await CreditNoteModel.findOne({ _id: creditNoteId, status: 'issued' }).lean<CreditNoteDoc>();
    if (!cn?.number) throw notFound('Credit note');
    let data: Buffer;
    if (cn.pdfFileId) data = await this.d.files.read(String(cn.pdfFileId));
    else {
      const inv = await InvoiceModel.findOne({ _id: cn.invoiceId }).lean<InvoiceDoc>();
      if (!inv) throw notFound('Credit note');
      data = await this.renderCreditNote(cn, inv);
    }
    return { data, name: `${cn.number.replaceAll('/', '-')}.pdf` };
  }

  async platformCreditNotePdf(id: string, creditNoteId: string) {
    const t = await this.college(id);
    return runInTenant(t._id, () => this.creditNotePdf(creditNoteId));
  }

  // ── Payments ─────────────────────────────

  /** D5's primary flow: the platform owner records a bank transfer it has seen arrive. */
  async recordBank(
    actorId: string,
    id: string,
    invoiceId: string,
    body: z.output<typeof recordPaymentBody>,
    meta: RequestMetaLite,
  ) {
    const t = await this.college(id);
    await runInTenant(t._id, async () => {
      const inv = await InvoiceModel.findOne({
        _id: invoiceId,
        status: { $in: [...OPEN] },
      }).lean<InvoiceDoc>();
      if (!inv) throw notFound('Open invoice');
      if (body.amountPaise > owed(inv))
        throw new AppError(409, ErrorCode.CONFLICT, 'That is more than the invoice’s balance');
      try {
        await PaymentModel.create({
          invoiceId: inv._id,
          amountPaise: body.amountPaise,
          method: 'bank',
          paidOn: body.paidOn,
          reference: body.utr,
          note: body.note ?? null,
          recordedBy: new Types.ObjectId(actorId),
        });
      } catch (e) {
        if (isDuplicate(e)) throw conflict('A payment with that UTR is already recorded');
        throw e;
      }
      await this.apply(t, inv, body.amountPaise, true);
      await audit.record(
        {
          action: 'billing.payment_recorded',
          targetType: 'invoice',
          targetId: invoiceId,
          meta: { method: 'bank', amountPaise: body.amountPaise },
        },
        meta,
      );
    });
    await audit.record(
      {
        action: 'platform.payment_recorded',
        actorId,
        targetType: 'invoice',
        targetId: invoiceId,
        meta: { tenantId: id, amountPaise: body.amountPaise, utr: body.utr },
      },
      meta,
    );
    return this.collegeView(id);
  }

  /** Adds a payment to an invoice; paid in full → `paid`, admins told, read-only lifted. */
  private async apply(t: TenantRecord, inv: InvoiceDoc, amountPaise: number, clearLink: boolean) {
    const after = await InvoiceModel.findOneAndUpdate(
      { _id: inv._id },
      { $inc: { paidPaise: amountPaise }, ...(clearLink ? { $set: { payLink: null } } : {}) },
      { returnDocument: 'after' },
    ).lean<InvoiceDoc>();
    if (!after) return;
    if (owed(after) === 0 && after.status !== 'paid' && after.status !== 'void') {
      await InvoiceModel.updateOne(
        { _id: inv._id },
        { $set: { status: 'paid', paidAt: new Date(), payLink: null } },
      );
      for (const admin of await this.d.users.activeIdsWithRole(Role.COLLEGE_ADMIN))
        await this.d.notifications.notify(admin, 'payment_received', {
          number: after.number ?? '',
          amount: formatRupees(after.paidPaise),
        });
      await this.refreshReadOnly(t);
    }
  }

  /** "Pay online" (the college's admin): the open link, or a new one for the balance. */
  async payLink(t: TenantRecord, invoiceId: string): Promise<{ url: string }> {
    if (!this.d.payments.available) throw notFound('Online payment');
    const inv = await InvoiceModel.findOne({ _id: invoiceId, status: { $in: [...OPEN] } }).lean<InvoiceDoc>();
    if (!inv?.number) throw notFound('Open invoice');
    if (inv.payLink) return { url: inv.payLink.url };
    const link = await this.d.payments.createLink({
      // A new link after a part payment needs a new reference (they are unique per account).
      reference: inv.creditedPaise
        ? `${inv.number}-${inv.paidPaise}-${inv.creditedPaise}`
        : inv.paidPaise > 0
          ? `${inv.number}-${inv.paidPaise}`
          : inv.number,
      amountPaise: owed(inv),
      description: `Invoice ${inv.number}`,
      payerName: inv.buyer?.name ?? t.branding.displayName,
      callbackUrl: this.d.tenantUrl(t, '/admin/billing?paid=1'),
      notes: { tenantId: String(requireTenantId()), invoiceId: String(inv._id) },
    });
    await InvoiceModel.updateOne(
      { _id: inv._id },
      {
        $set: {
          payLink: { provider: this.d.payments.name, id: link.id, url: link.url, createdAt: new Date() },
        },
        $addToSet: { payLinkIds: link.id },
      },
    );
    return { url: link.url };
  }

  /**
   * A verified webhook's payment, in the college the link was made for. Idempotent: the provider's
   * payment id is unique per college, and deliveries are deduplicated before this runs.
   */
  async recordOnline(e: PaidEvent): Promise<'recorded' | 'duplicate' | 'ignored'> {
    const t = await findTenantById(e.tenantId).catch(() => null);
    if (!t || t.kind !== 'college') return 'ignored';
    return runInTenant(t._id, async () => {
      const inv = await InvoiceModel.findOne({ _id: e.invoiceId }).lean<InvoiceDoc>();
      // Only links we made for this invoice count (the notes alone are not enough).
      if (!inv || !inv.payLinkIds.includes(e.linkId)) return 'ignored';
      try {
        await PaymentModel.create({
          invoiceId: inv._id,
          amountPaise: e.amountPaise,
          method: 'online',
          paidOn: istDay(e.paidAt),
          reference: e.paymentId,
        });
      } catch (err) {
        if (isDuplicate(err)) return 'duplicate';
        throw err;
      }
      await this.apply(t, inv, e.amountPaise, false);
      await audit.record({
        action: 'billing.payment_recorded',
        targetType: 'invoice',
        targetId: String(inv._id),
        meta: { method: 'online', amountPaise: e.amountPaise },
      });
      return 'recorded';
    });
  }

  // ── The daily run (per college) ─────────────────────────────

  /**
   * The scheduler (prompt 4, P5): colleges whose daily billing run has something to do: an invoice
   * waiting for payment, a read-only state to lift, or seats not counted for a week.
   */
  static async dueTenantIds(now = new Date()): Promise<Set<string>> {
    const open = await withPlatformScope('scheduler:billing-open-invoices', () =>
      InvoiceModel.distinct('tenantId', { status: { $in: ['issued', 'overdue'] } }),
    );
    const stale = await TenantModel.find({
      kind: 'college',
      status: 'active',
      $or: [
        { 'billing.readOnlyAt': { $ne: null } },
        { 'billing.seatsCountedAt': null },
        { 'billing.seatsCountedAt': { $lt: new Date(now.getTime() - 7 * 86_400_000) } },
      ],
    })
      .select('_id')
      .lean();
    return new Set([...open, ...stale.map((t) => t._id)].map(String));
  }

  /** Queues one daily billing run per active college (job ids dedupe per day). */
  static async enqueueDaily(jobs: JobQueue, now = new Date(), only?: ReadonlySet<string>) {
    const tenants = (
      await TenantModel.find({ kind: 'college', status: 'active' }).select('_id').lean()
    ).filter((t) => !only || only.has(String(t._id)));
    const day = istDay(now).replaceAll('-', '');
    for (const t of tenants)
      await jobs.enqueue(
        BILLING_DAILY_JOB,
        { tenantId: String(t._id) },
        { jobId: `billing-${String(t._id)}-${day}` },
      );
    return tenants.length;
  }

  /**
   * In one college: counts seats, marks invoices overdue, sends the reminders that are due (each
   * once), and starts or lifts read-only. Idempotent.
   */
  async daily(now = new Date()) {
    const t = await findTenantById(requireTenantId());
    if (!t || t.kind !== 'college') return;
    const seatsUsed = await this.d.users.seatCount(now);
    await TenantModel.updateOne(
      { _id: t._id },
      { $set: { 'billing.seatsUsed': seatsUsed, 'billing.seatsCountedAt': now } },
    );
    const today = istDay(now);
    await InvoiceModel.updateMany(
      { status: 'issued', dueOn: { $lt: today } },
      { $set: { status: 'overdue' } },
    );
    const open = await InvoiceModel.find({ status: { $in: [...OPEN] }, dueOn: { $ne: null } }).lean<
      InvoiceDoc[]
    >();
    const admins = open.length ? await this.d.users.activeIdsWithRole(Role.COLLEGE_ADMIN) : [];
    for (const inv of open) {
      if (!inv.dueOn || !inv.number) continue;
      const fromDue = daysBetween(inv.dueOn, today);
      const due = INVOICE_REMINDER_DAYS.filter((o) => fromDue >= o && !inv.remindersSent.includes(o));
      if (!due.length) continue;
      // Only the latest one that applies (a late first run sends one reminder, not three).
      const latest = Math.max(...due);
      const r = await InvoiceModel.updateOne(
        { _id: inv._id, remindersSent: { $nin: due } },
        { $addToSet: { remindersSent: { $each: due } } },
      );
      if (!r.modifiedCount || fromDue - latest >= 7) continue;
      const type = latest < 0 ? 'invoice_due_soon' : latest === 0 ? 'invoice_due' : 'invoice_overdue';
      for (const admin of admins)
        await this.d.notifications.notify(admin, type, {
          number: inv.number,
          amount: formatRupees(owed(inv)),
          due: inv.dueOn,
        });
    }
    await this.refreshReadOnly(t, now);
    invalidateTenant(t.slug);
  }

  /** Read-only while any invoice is 30 or more days past due; lifted as soon as none is. */
  private async refreshReadOnly(t: TenantRecord, now = new Date()) {
    const cutoff = addDays(istDay(now), -READ_ONLY_AFTER_DAYS);
    const late = await InvoiceModel.findOne({ status: 'overdue', dueOn: { $lte: cutoff } })
      .sort({ dueOn: 1 })
      .lean<InvoiceDoc>();
    const fresh = await TenantModel.findById(t._id)
      .select('billing.readOnlyAt')
      .lean<{ billing?: { readOnlyAt: Date | null } }>();
    const was = !!fresh?.billing?.readOnlyAt;
    if (late && !was) {
      await TenantModel.updateOne({ _id: t._id }, { $set: { 'billing.readOnlyAt': now } });
      await audit.record({
        action: 'billing.read_only_started',
        targetType: 'invoice',
        targetId: String(late._id),
      });
      for (const admin of await this.d.users.activeIdsWithRole(Role.COLLEGE_ADMIN))
        await this.d.notifications.notify(admin, 'college_read_only', { number: late.number ?? '' });
    } else if (!late && was) {
      await TenantModel.updateOne({ _id: t._id }, { $set: { 'billing.readOnlyAt': null } });
      await audit.record({
        action: 'billing.read_only_ended',
        targetType: 'tenant',
        targetId: String(t._id),
      });
    }
    if (!!late !== was) invalidateTenant(t.slug);
  }
}
