import { locale, perLocale } from './format';

// Number formats for the dashboards (a separate file so screens without figures do not load them).
const compact = perLocale((l) => new Intl.NumberFormat(l, { notation: 'compact', maximumFractionDigits: 1 }));
const whole = perLocale((l) => new Intl.NumberFormat(l));
const utcDay = perLocale(
  (l) => new Intl.DateTimeFormat(l, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
);

/** 1,284 → "1.3K" (axis ticks and dense figures). */
export const formatCompact = (n: number) => compact().format(n);
export const formatNumber = (n: number) => whole().format(n);
/** A UTC calendar day (`YYYY-MM-DD`, as usage is counted), e.g. "23 Oct". */
export const formatUtcDay = (d: string) => utcDay().format(new Date(`${d}T00:00:00Z`));
/** An amount in a currency the admin chose (small amounts keep more decimals). */
export const formatMoney = (n: number, currency: string) =>
  new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency,
    maximumFractionDigits: n > 0 && n < 1 ? 4 : 2,
  }).format(n);
