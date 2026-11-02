import { ctcBand, gradYearLabel, SMALL_CELL, type CtcBand, type ReportColumn } from '@campuslink/shared';
import type { OfferRow, ReportParams } from '../report-data.js';

export const col = (key: string, label: string, kind: ReportColumn['kind'] = 'text'): ReportColumn => ({
  key,
  label,
  kind,
});
export const yearCol = col('year', 'Academic year');
export const programmeCol = col('programme', 'Programme');
export const label = gradYearLabel;

/** Rows of the chosen programme, or all of them. */
export const inBranch = <T extends { branch: string | null }>(rows: T[], p: Pick<ReportParams, 'branch'>) =>
  p.branch ? rows.filter((r) => r.branch === p.branch) : rows;

export const distinct = <T>(rows: T[], key: (r: T) => string) => new Set(rows.map(key)).size;

export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/** Job offers only: an internship is not a placement. */
export const jobOffers = (rows: OfferRow[]) => rows.filter((r) => r.type !== 'internship');

/** Each student's best offer (highest exact CTC, else highest band). */
export function bestOffers(rows: OfferRow[]): OfferRow[] {
  const BANDS: CtcBand[] = ['under_3', '3_5', '5_8', '8_12', '12_20', '20_plus'];
  const best = new Map<string, OfferRow>();
  for (const r of rows) {
    const cur = best.get(r.subject);
    const score = (o: OfferRow) => o.ctcLpa ?? BANDS.indexOf(o.ctcBand) * 0.001;
    if (!cur || score(r) > score(cur)) best.set(r.subject, r);
  }
  return [...best.values()];
}

/** The band of the median offer: exact CTCs where known (anonymised offers keep only a band). */
export function medianBand(rows: OfferRow[]): CtcBand | null {
  const exact = rows.flatMap((r) => (r.ctcLpa === null ? [] : [r.ctcLpa]));
  if (exact.length === rows.length && exact.length) return ctcBand(median(exact) as number);
  const BANDS: CtcBand[] = ['under_3', '3_5', '5_8', '8_12', '12_20', '20_plus'];
  const idx = median(rows.map((r) => BANDS.indexOf(r.ctcBand)));
  return idx === null ? null : (BANDS[Math.floor(idx)] ?? null);
}

/** A ratio or percentage is shown only when the count it is built on is not suppressed. */
export const shown = (n: number) => n === 0 || n >= SMALL_CELL;

export const BAND_LABEL: Record<CtcBand, string> = {
  under_3: 'Under ₹3 LPA',
  '3_5': '₹3–5 LPA',
  '5_8': '₹5–8 LPA',
  '8_12': '₹8–12 LPA',
  '12_20': '₹12–20 LPA',
  '20_plus': '₹20 LPA and above',
};
