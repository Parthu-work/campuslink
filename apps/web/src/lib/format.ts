import i18n from '../i18n/core';

/** Dates and times in the viewer's own timezone and language. */
export const locale = () => (i18n.language === 'te' ? 'te-IN' : 'en-IN');

/** One formatter per language, made on first use: building an Intl formatter is slow. */
export const perLocale = <T>(make: (locale: string) => T) => {
  let made: { locale: string; value: T } | null = null;
  return () => {
    const l = locale();
    if (made?.locale !== l) made = { locale: l, value: make(l) };
    return made.value;
  };
};
const day = perLocale(
  (l) => new Intl.DateTimeFormat(l, { weekday: 'short', day: 'numeric', month: 'short' }),
);
const weekday = perLocale((l) => new Intl.DateTimeFormat(l, { weekday: 'short' }));
const month = perLocale((l) => new Intl.DateTimeFormat(l, { month: 'short' }));
const time = perLocale((l) => new Intl.DateTimeFormat(l, { hour: 'numeric', minute: '2-digit' }));
const dateTime = perLocale((l) => new Intl.DateTimeFormat(l, { dateStyle: 'medium', timeStyle: 'short' }));
const relative = perLocale((l) => new Intl.RelativeTimeFormat(l, { numeric: 'auto' }));
export const formatDay = (iso: string | Date) => day().format(new Date(iso));
/** Short weekday ("Thu"), for date tiles. */
export const formatWeekday = (iso: string | Date) => weekday().format(new Date(iso));
/** Short month ("Oct"), for date tiles. */
export const formatMonth = (iso: string | Date) => month().format(new Date(iso));
export const formatTime = (iso: string | Date) => time().format(new Date(iso));
export const formatDateTime = (iso: string | Date) => dateTime().format(new Date(iso));
export const formatRelative = (iso: string | Date) => {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = relative();
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86_400), 'day');
};
/** YYYY-MM-DD of an instant in the viewer's timezone (grouping slots and sessions by day). */
export const localDateKey = (iso: string | Date) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const viewerTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const newIdempotencyKey = () => crypto.randomUUID();
