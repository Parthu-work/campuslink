import { Schema, type Types } from 'mongoose';
import {
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PLAN_IDS,
  type GstSplit,
  type InvoiceStatus,
} from '@campuslink/shared';
import { baseSchemaOptions, definePlatformModel, defineTenantModel } from '../../db/models.js';

/**
 * Billing (build B10). Invoices and payments belong to the college (tenant models). Two small
 * platform collections hold what is the seller's, not any college's: the plan settings the platform
 * owner edits, and the invoice number sequence (one series per financial year for every college).
 */

/** The platform owner's changes to a plan's default terms (only the terms changed). */
const planSettingSchema = new Schema(
  {
    plan: { type: String, enum: PLAN_IDS, required: true },
    terms: { type: Schema.Types.Mixed, default: {} },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
planSettingSchema.index({ plan: 1 }, { unique: true });
export const PlanSettingModel = definePlatformModel('PlanSetting', planSettingSchema);

/** The invoice sequence: `{prefix, fy}` is unique, and `$inc` hands out each number once. */
const invoiceCounterSchema = new Schema(
  {
    prefix: { type: String, required: true },
    fy: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    seq: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);
invoiceCounterSchema.index({ prefix: 1, fy: 1 }, { unique: true });
export const InvoiceCounterModel = definePlatformModel('InvoiceCounter', invoiceCounterSchema);

const partySchema = new Schema(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    gstin: { type: String, default: null },
    stateCode: { type: String, default: null },
  },
  { _id: false, strict: 'throw' },
);

const lineSchema = new Schema(
  {
    description: { type: String, required: true, maxlength: 200 },
    quantity: { type: Number, required: true },
    unitPaise: { type: Number, required: true },
    amountPaise: { type: Number, required: true },
  },
  { _id: false, strict: 'throw' },
);

const gstSchema = new Schema(
  {
    kind: { type: String, enum: ['intra', 'inter', 'none'], required: true },
    stateTaxName: { type: String, enum: ['SGST', 'UTGST'], required: true },
    ratePercent: { type: Number, required: true },
    cgstPaise: { type: Number, required: true },
    sgstPaise: { type: Number, required: true },
    igstPaise: { type: Number, required: true },
    taxPaise: { type: Number, required: true },
  },
  { _id: false, strict: 'throw' },
);

export interface InvoiceDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  number: string | null;
  fy: string | null;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  dueDays: number;
  issuedOn: string | null;
  dueOn: string | null;
  lines: { description: string; quantity: number; unitPaise: number; amountPaise: number }[];
  taxablePaise: number;
  gst: GstSplit;
  totalPaise: number;
  paidPaise: number;
  sacCode: string;
  seller: { name: string; address: string; gstin: string | null; stateCode: string | null } | null;
  buyer: { name: string; address: string; gstin: string | null; stateCode: string | null } | null;
  notes: string | null;
  voidReason: string | null;
  pdfFileId: Types.ObjectId | null;
  payLink: { provider: string; id: string; url: string; createdAt: Date } | null;
  payLinkIds: string[];
  remindersSent: number[];
  paidAt: Date | null;
  createdAt: Date;
}

const invoiceSchema = new Schema(
  {
    /** Given on issue (drafts have none, so numbers never skip). */
    number: { type: String, default: null },
    fy: { type: String, default: null },
    status: { type: String, enum: INVOICE_STATUSES, default: 'draft', required: true },
    periodStart: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    periodEnd: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    dueDays: { type: Number, required: true },
    issuedOn: { type: String, default: null },
    dueOn: { type: String, default: null },
    lines: { type: [lineSchema], default: [] },
    taxablePaise: { type: Number, required: true },
    gst: { type: gstSchema, required: true },
    totalPaise: { type: Number, required: true },
    paidPaise: { type: Number, default: 0 },
    sacCode: { type: String, default: '' },
    /** Both parties as they were on the day of issue (an invoice never changes afterwards). */
    seller: { type: partySchema, default: null },
    buyer: { type: partySchema, default: null },
    notes: { type: String, default: null, maxlength: 500 },
    voidReason: { type: String, default: null, maxlength: 200 },
    /** The rendered PDF (file purpose `invoice`); rendered again on download if missing. */
    pdfFileId: { type: Schema.Types.ObjectId, default: null },
    payLink: {
      type: new Schema(
        {
          provider: { type: String, required: true },
          id: { type: String, required: true },
          url: { type: String, required: true },
          createdAt: { type: Date, required: true },
        },
        { _id: false, strict: 'throw' },
      ),
      default: null,
    },
    /** Every link ever made for this invoice: a payment on any of them counts (webhooks check it). */
    payLinkIds: { type: [String], default: [] },
    /** Reminder offsets already sent (days from the due date), so each goes once. */
    remindersSent: { type: [Number], default: [] },
    paidAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
invoiceSchema.index(
  { tenantId: 1, number: 1 },
  { unique: true, partialFilterExpression: { number: { $type: 'string' } } },
);
invoiceSchema.index({ tenantId: 1, status: 1, dueOn: 1 });
invoiceSchema.index({ tenantId: 1, createdAt: -1 });
export const InvoiceModel = defineTenantModel('Invoice', invoiceSchema);

export interface PaymentDoc {
  _id: Types.ObjectId;
  invoiceId: Types.ObjectId;
  amountPaise: number;
  method: 'bank' | 'online';
  paidOn: string;
  reference: string;
  note: string | null;
  recordedBy: Types.ObjectId | null;
  createdAt: Date;
}

/** A payment against an invoice: a bank transfer (UTR) or an online payment (provider id). */
const paymentSchema = new Schema(
  {
    invoiceId: { type: Schema.Types.ObjectId, required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    paidOn: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    /** UTR or the provider's payment id: unique per college, so a payment is recorded once. */
    reference: { type: String, required: true, maxlength: 60 },
    note: { type: String, default: null, maxlength: 200 },
    /** The platform admin who recorded a bank payment (null for online payments). */
    recordedBy: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
paymentSchema.index({ tenantId: 1, method: 1, reference: 1 }, { unique: true });
paymentSchema.index({ tenantId: 1, invoiceId: 1 });
export const PaymentModel = defineTenantModel('Payment', paymentSchema);
