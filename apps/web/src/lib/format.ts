import i18n from 'i18next';

/** Dates and times in the viewer's own timezone and language. */
const locale = () => (i18n.language === 'te' ? 'te-IN' : 'en-IN');

export const formatDay = (iso: string | Date) =>
  new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(iso),
  );
export const formatTime = (iso: string | Date) =>
  new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const formatDateTime = (iso: string | Date) =>
  new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
export const formatRelative = (iso: string | Date) => {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
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
