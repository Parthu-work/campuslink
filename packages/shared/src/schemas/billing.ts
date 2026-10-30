import { z } from 'zod';
import { FEATURE_KEYS } from '../features.js';
import {
  GST_STATE_CODES,
  GSTIN_PATTERN,
  PLAN_IDS,
  type GstSplit,
  type InvoiceStatus,
  type PaymentMethod,
  type PlanId,
  type PlanTerms,
} from '../constants/plans.js';

/** Plans, entitlements and billing (build B10). Money is whole paise. */
const paise = (max: number) => z.number().int().min(0).max(max);
const day = z.iso.date();
const plain = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !/[<>]/.test(s), 'Plain text only');

/** Any subset of a plan's terms: a platform plan setting, or one college's custom deal. */
export const planTermsPatch = z
  .strictObject({
    pricePerStudentPaise: paise(10_000_00),
    annualMinimumPaise: paise(1_00_00_000_00),
    features: z.array(z.enum(FEATURE_KEYS)).max(FEATURE_KEYS.length),
    whatsappPerStudentMonthly: z.number().int().min(0).max(100),
    aiTokensPerStudentMonthly: z.number().int().min(0).max(1_000_000),
    days: z.number().int().min(0).max(366),
  })
  .partial();
export type PlanTermsPatch = z.infer<typeof planTermsPatch>;

export const planParams = z.strictObject({ plan: z.enum(PLAN_IDS) });

/** The college as the buyer on its invoices. The state is the place of supply for GST. */
export const buyerSchema = z.strictObject({
  legalName: plain(3, 160),
  address: plain(10, 400),
  gstin: z.string().trim().toUpperCase().regex(GSTIN_PATTERN, 'Enter a 15-character GSTIN').nullable(),
  stateCode: z.enum(GST_STATE_CODES),
});
export type Buyer = z.infer<typeof buyerSchema>;

/** Platform console: a college's plan, seats, term, custom deal and invoice details. */
export const platformSubscriptionBody = z
  .strictObject({
    plan: z.enum(PLAN_IDS),
    /** Contracted seats: the enrolled students the college is quoted for. */
    seats: z.number().int().min(10).max(100_000),
    startedOn: day,
    renewalDate: day.nullable(),
    /** A custom deal on top of the plan; null clears it. */
    terms: planTermsPatch.nullable(),
    buyer: buyerSchema,
  })
  .partial()
  .refine((b) => !b.buyer?.gstin || b.buyer.gstin.startsWith(b.buyer.stateCode), {
    message: 'The GSTIN starts with the state code',
    path: ['buyer', 'gstin'],
  });

export const invoiceLineSchema = z.strictObject({
  description: plain(3, 200),
  quantity: z.number().int().min(1).max(1_000_000),
  unitPaise: paise(1_00_00_000_00),
});

export const invoiceDraftBody = z
  .strictObject({
    periodStart: day,
    periodEnd: day,
    lines: z.array(invoiceLineSchema).min(1).max(10),
    /** Days from issue to due; the deployment's payment terms when left out. */
    dueDays: z.number().int().min(0).max(90).optional(),
    notes: plain(1, 500).optional(),
  })
  .refine((b) => b.periodStart <= b.periodEnd, {
    message: 'The period ends after it starts',
    path: ['periodEnd'],
  });

export const invoiceParams = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  invoiceId: z.string().regex(/^[a-f0-9]{24}$/),
});
export const ownInvoiceParams = z.strictObject({ invoiceId: z.string().regex(/^[a-f0-9]{24}$/) });

export const voidInvoiceBody = z.strictObject({ reason: plain(3, 200) });

/** A bank transfer the platform owner has seen arrive (D5: the primary flow). */
export const recordPaymentBody = z.strictObject({
  amountPaise: z.number().int().min(1).max(1_00_00_000_00),
  paidOn: day,
  /** The bank's transaction reference (NEFT/RTGS UTR, IMPS reference). */
  utr: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,30}$/, 'Letters and digits, as the bank shows it'),
  note: plain(1, 200).optional(),
});

// ── Views ────────────────────────────────────────────────────────────

export interface PlanView {
  id: PlanId;
  terms: PlanTerms;
  defaults: PlanTerms;
  /** Terms the platform owner changed from the defaults. */
  changed: (keyof PlanTerms)[];
}

export interface InvoiceLineView {
  description: string;
  quantity: number;
  unitPaise: number;
  amountPaise: number;
}

export interface PaymentView {
  id: string;
  invoiceId: string;
  amountPaise: number;
  method: PaymentMethod;
  paidOn: string;
  /** The bank reference, or the provider's payment id for online payments. */
  reference: string;
  recordedAt: string;
}

export interface InvoiceView {
  id: string;
  /** Null while a draft (numbers are given on issue, so drafts never leave gaps). */
  number: string | null;
  status: InvoiceStatus;
  issuedOn: string | null;
  dueOn: string | null;
  periodStart: string;
  periodEnd: string;
  lines: InvoiceLineView[];
  taxablePaise: number;
  gst: GstSplit;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  totalInWords: string;
  sacCode: string;
  buyer: Buyer | null;
  notes: string | null;
  voidReason: string | null;
  hasPdf: boolean;
  /** An online payment link is open for this invoice. */
  payLinkOpen: boolean;
  payments: PaymentView[];
}

export interface MeterView {
  used: number;
  allowance: number;
}

export interface BillingUsageView {
  /** The calendar month (UTC), YYYY-MM. */
  month: string;
  whatsapp: MeterView;
  aiTokens: MeterView;
  seats: {
    used: number | null;
    contracted: number;
    countedAt: string | null;
  };
}

/** Admin › Billing (the college). */
export interface AdminBillingView {
  plan: PlanId;
  terms: PlanTerms;
  customDeal: boolean;
  startedOn: string | null;
  renewalDate: string | null;
  /** The pilot's last day (pilot only). */
  pilotEndsOn: string | null;
  annualPricePaise: number;
  usage: BillingUsageView;
  overSeats: boolean;
  readOnly: boolean;
  readOnlySince: string | null;
  invoices: InvoiceView[];
  /** "Pay online" works at this deployment (a payment provider is set up). */
  payOnline: boolean;
  buyer: Buyer | null;
}

/** Platform console: one row per college. */
export interface PlatformBillingRow {
  tenantId: string;
  slug: string;
  name: string;
  plan: PlanId;
  seats: number;
  seatsUsed: number | null;
  renewalDate: string | null;
  outstandingPaise: number;
  overdue: number;
  readOnly: boolean;
}

/** Platform console: one college's subscription, usage and invoices. */
export interface PlatformCollegeBillingView extends AdminBillingView {
  tenantId: string;
  slug: string;
  name: string;
  /** The custom deal as entered (only the terms it changes). */
  custom: PlanTermsPatch | null;
  /** The invoice the plan suggests for the current term (the platform owner may edit it). */
  suggested: { periodStart: string; periodEnd: string; lines: InvoiceLineView[] };
  warnings: BillingWarning[];
}

/** Things to fix before invoicing (shown to the platform owner, never blocking). */
export type BillingWarning = 'no_sac_code' | 'no_buyer' | 'seller_unregistered' | 'no_seller_state';

/** A link to pay an invoice online. */
export interface PayLinkView {
  url: string;
}
