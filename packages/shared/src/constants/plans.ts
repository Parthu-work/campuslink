import { FEATURE_KEYS, type Feature } from '../features.js';

/**
 * Plans, entitlements and billing (build B10, decision D9). Zod-free on purpose: Admin › Billing
 * and the platform console format prices and quotes without loading Zod (bundle budget).
 *
 * Money is always whole paise (integers), never floating-point rupees.
 */
import { PLAN_IDS, type PlanId } from './plan-ids.js';

export { PLAN_IDS, type PlanId };

export interface PlanTerms {
  /** Price per enrolled student per year, in paise (students and alumni never pay). */
  pricePerStudentPaise: number;
  /** The least a college pays for a year, in paise. */
  annualMinimumPaise: number;
  /** The feature switches (B1) the plan includes; the college still chooses which are on. */
  features: Feature[];
  /** WhatsApp messages per student per month; the college's allowance is this × its students. */
  whatsappPerStudentMonthly: number;
  /** AI tokens per student per month on the platform's provider (B11 applies the allowance). */
  aiTokensPerStudentMonthly: number;
  /** How long the plan runs from its start, in days (0: a yearly subscription, renewed). */
  days: number;
}

/** The terms a platform owner or a custom deal may change (the plan id itself never changes). */
export const PLAN_TERM_KEYS = [
  'pricePerStudentPaise',
  'annualMinimumPaise',
  'features',
  'whatsappPerStudentMonthly',
  'aiTokensPerStudentMonthly',
  'days',
] as const satisfies readonly (keyof PlanTerms)[];

const ALL: Feature[] = [...FEATURE_KEYS];

/**
 * The defaults (D9). The platform console overrides any term per plan, and per college for a
 * custom deal; what applies is default ← platform plan setting ← the college's deal.
 */
export const PLANS: Readonly<Record<PlanId, Readonly<PlanTerms>>> = {
  pilot: {
    pricePerStudentPaise: 0,
    annualMinimumPaise: 0,
    features: ALL,
    whatsappPerStudentMonthly: 2,
    aiTokensPerStudentMonthly: 5_000,
    days: 90,
  },
  connect: {
    pricePerStudentPaise: 40_00,
    annualMinimumPaise: 60_000_00,
    // Connect is the network: everything except placement drives.
    features: ALL.filter((f) => f !== 'placements'),
    whatsappPerStudentMonthly: 2,
    aiTokensPerStudentMonthly: 5_000,
    days: 0,
  },
  placement: {
    pricePerStudentPaise: 75_00,
    annualMinimumPaise: 1_20_000_00,
    features: ALL,
    whatsappPerStudentMonthly: 4,
    aiTokensPerStudentMonthly: 10_000,
    days: 0,
  },
};

/** Some of a plan's terms (a platform setting or a custom deal). */
export type PlanTermsLayer = { [K in keyof PlanTerms]?: PlanTerms[K] | undefined };

/** Applies overrides on top of a plan's terms (unknown keys and wrong types are ignored). */
export function mergeTerms(base: Readonly<PlanTerms>, ...layers: (PlanTermsLayer | null | undefined)[]) {
  const out: PlanTerms = { ...base, features: [...base.features] };
  for (const layer of layers) {
    if (!layer) continue;
    for (const k of PLAN_TERM_KEYS) {
      const v = layer[k];
      if (k === 'features') {
        if (Array.isArray(v)) out.features = FEATURE_KEYS.filter((f) => (v as string[]).includes(f));
      } else if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[k] = v;
    }
  }
  return out;
}

/**
 * The students a plan's allowances are sized for: the contracted seats, or as many as the annual
 * minimum pays for when that is more (a college paying the minimum gets the minimum's worth).
 */
export function allowanceStudents(terms: PlanTerms, seats: number): number {
  const byMinimum =
    terms.pricePerStudentPaise > 0 ? Math.ceil(terms.annualMinimumPaise / terms.pricePerStudentPaise) : 0;
  return Math.max(seats, byMinimum);
}

/** The year's price for `seats` students: seats × price, or the annual minimum when that is more. */
export function annualPricePaise(terms: PlanTerms, seats: number): number {
  return Math.max(seats * terms.pricePerStudentPaise, terms.annualMinimumPaise);
}

/** What a seat is (D9): verified students, plus alumni active in the last 12 months. */
export const SEAT_ALUMNI_ACTIVE_DAYS = 365;

// ── Invoices ──────────────────────────────────────────────────────────

export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'overdue', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Reminders to the college's admins, in days relative to the due date. */
export const INVOICE_REMINDER_DAYS = [-7, 0, 7] as const;
/** Days overdue after which the college becomes read-only (never deleted). */
export const READ_ONLY_AFTER_DAYS = 30;

export const PAYMENT_METHODS = ['bank', 'online'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** India Standard Time, for financial years and invoice dates (UTC+05:30, no daylight saving). */
const IST_MS = 330 * 60_000;

/** The Indian financial year (1 April to 31 March) a moment falls in, as `2026-27`. */
export function financialYearOf(at: Date): string {
  const ist = new Date(at.getTime() + IST_MS);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** The calendar day in India, `YYYY-MM-DD` (invoice and due dates). */
export const istDay = (at: Date): string => new Date(at.getTime() + IST_MS).toISOString().slice(0, 10);

/** `CL/2026-27/0001`: prefix, financial year, sequence within that year. */
export const invoiceNumber = (prefix: string, fy: string, seq: number): string =>
  `${prefix}/${fy}/${String(seq).padStart(4, '0')}`;

/**
 * GST state codes (the first two digits of a GSTIN), for the place of supply. Union territories
 * without a legislature charge UTGST in place of SGST.
 */
export const GST_STATES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
} as const;
export type GstStateCode = keyof typeof GST_STATES;
export const GST_STATE_CODES = Object.keys(GST_STATES) as [GstStateCode, ...GstStateCode[]];
const UT_WITHOUT_LEGISLATURE = new Set<string>(['04', '26', '31', '35', '38']);

/** A GSTIN: state code, PAN, entity number, `Z`, check character. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export interface GstSplit {
  /** CGST + SGST (or UTGST) inside the seller's state, IGST across states, none when unregistered. */
  kind: 'intra' | 'inter' | 'none';
  /** `SGST` or `UTGST` for an intra-state supply. */
  stateTaxName: 'SGST' | 'UTGST';
  ratePercent: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
}

/**
 * GST on a taxable value. Inside the seller's state the rate is split in half (CGST and SGST or
 * UTGST, each rounded to the paisa); across states it is IGST. An unregistered seller charges none.
 */
export function gstSplit(input: {
  taxablePaise: number;
  ratePercent: number;
  registered: boolean;
  sellerState: string;
  placeOfSupply: string;
}): GstSplit {
  const { taxablePaise, ratePercent, registered, sellerState, placeOfSupply } = input;
  const stateTaxName = UT_WITHOUT_LEGISLATURE.has(placeOfSupply) ? 'UTGST' : 'SGST';
  if (!registered || ratePercent === 0)
    return {
      kind: 'none',
      stateTaxName,
      ratePercent: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      taxPaise: 0,
    };
  if (sellerState === placeOfSupply) {
    // Basis points keep the half rate exact (9% of 18%): round(value × bps / 20000).
    const half = Math.round((taxablePaise * Math.round(ratePercent * 100)) / 20_000);
    return {
      kind: 'intra',
      stateTaxName,
      ratePercent,
      cgstPaise: half,
      sgstPaise: half,
      igstPaise: 0,
      taxPaise: 2 * half,
    };
  }
  const igst = Math.round((taxablePaise * Math.round(ratePercent * 100)) / 10_000);
  return {
    kind: 'inter',
    stateTaxName,
    ratePercent,
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: igst,
    taxPaise: igst,
  };
}

/** `₹1,20,000.00`: Indian digit grouping (lakhs and crores). */
export function formatRupees(paise: number, opts: { paise?: boolean } = {}): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = String(Math.floor(abs / 100));
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  const fraction = opts.paise === false ? '' : `.${String(abs % 100).padStart(2, '0')}`;
  return `${neg ? '-' : ''}₹${grouped}${fraction}`;
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function underHundred(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const t = TENS[Math.floor(n / 10)] ?? '';
  return n % 10 ? `${t}-${ONES[n % 10] ?? ''}` : t;
}

function underThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h] ?? ''} Hundred` : '', r ? underHundred(r) : ''].filter(Boolean).join(' ');
}

/** A whole number in the Indian system: crore, lakh, thousand, hundred. */
export function indianWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('A whole, non-negative number');
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  const rest = n % 1_00_00_000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  const lakh = Math.floor(rest / 1_00_000);
  const thousand = Math.floor((rest % 1_00_000) / 1000);
  const below = rest % 1000;
  if (lakh) parts.push(`${underHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${underHundred(thousand)} Thousand`);
  if (below) parts.push(underThousand(below));
  return parts.join(' ');
}

/** The total in words for the invoice: `Rupees One Lakh Twenty Thousand and Fifty Paise Only`. */
export function rupeesInWords(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  return `Rupees ${indianWords(rupees)}${p ? ` and ${underHundred(p)} Paise` : ''} Only`;
}
