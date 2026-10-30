import { formatRupees, type InvoiceStatus } from '@campuslink/shared';
import { ApiError } from './api';
import { perLocale } from './format';
import { formatCompact, formatNumber } from './numbers';

/** Billing helpers (B10) for Admin › Billing and the platform console. */
export const INVOICE_TONE: Record<InvoiceStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  draft: 'neutral',
  issued: 'info',
  paid: 'success',
  overdue: 'danger',
  void: 'neutral',
};

/** Paise as rupees: `₹1,20,000.00`, or whole rupees with `{ paise: false }`. */
export const rupees = (paise: number, opts?: { paise?: boolean }) => formatRupees(paise, opts);

/** A rupee amount typed in a form (`1,20,000.50`) as paise; NaN when it is not a number. */
export function toPaise(input: string): number {
  const clean = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return Number.NaN;
  return Math.round(Number(clean) * 100);
}

/** Paise as the plain rupee figure a form shows (`120000` or `120000.50`). */
export const paiseToInput = (paise: number) => (paise % 100 ? (paise / 100).toFixed(2) : String(paise / 100));

/** Exact figures (`1,800`). */
export const count = (n: number) => formatNumber(n);
/** Big meter figures in the locale's short form (`1.8Cr`), exact below 1,00,000. */
export const compact = (n: number) => formatCompact(n);

const dayFormat = perLocale(
  (l) => new Intl.DateTimeFormat(l, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
);
/** An invoice date (`YYYY-MM-DD`, the day in India) for display, e.g. "30 Oct 2026". */
export const day = (d: string | null) => (d ? dayFormat().format(new Date(`${d}T00:00:00Z`)) : '—');

/** A failed save as messages: one for the form, and one per field the API named (`buyer.gstin`). */
export function saveErrors(err: unknown, fallback: string): { root: string; fields: Record<string, string> } {
  if (!(err instanceof ApiError)) return { root: fallback, fields: {} };
  const fields: Record<string, string> = {};
  if (err.code === 'VALIDATION_FAILED' && Array.isArray(err.details))
    for (const d of err.details as { path?: string; message?: string }[])
      if (d.path) fields[d.path] = d.message ?? err.message;
  return { root: err.message, fields };
}
