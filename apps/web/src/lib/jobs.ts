import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from './toast';
import { useTranslation } from '../i18n/react';
import i18n from '../i18n/core';
import { LOCALE_TAGS, toLocale, type JobView, type Salary, type TrackStatus } from '@campuslink/shared';
import { api, ApiError } from './api';
import { putOrQueue } from './offline-writes';

/** Number formatters by locale and options; building an Intl formatter is slow and lists show many. */
const numberFormats = new Map<string, Intl.NumberFormat>();
const numberFormat = (locale: string, options: Intl.NumberFormatOptions = {}) => {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = numberFormats.get(key);
  if (!f) numberFormats.set(key, (f = new Intl.NumberFormat(locale, options)));
  return f;
};

/** "₹4.5L–6L a year" / "₹30k–40k a month" (Indian lakh notation for INR). */
export function formatSalary(s: Salary): string {
  const locale = LOCALE_TAGS[toLocale(i18n.language)];
  const inr = s.currency === 'INR';
  const short = (n: number) => {
    if (inr && n >= 100_000)
      return `${numberFormat(locale, { maximumFractionDigits: 1 }).format(n / 100_000)}L`;
    if (n >= 1000) return `${numberFormat(locale, { maximumFractionDigits: 0 }).format(n / 1000)}k`;
    return numberFormat(locale).format(n);
  };
  const sym = numberFormat(locale, { style: 'currency', currency: s.currency, maximumFractionDigits: 0 })
    .formatToParts(0)
    .find((p) => p.type === 'currency')?.value;
  const range =
    s.min && s.min !== s.max ? `${sym ?? ''}${short(s.min)}–${short(s.max)}` : `${sym ?? ''}${short(s.max)}`;
  return i18n.t(s.period === 'month' ? 'jobs.salaryMonth' : 'jobs.salaryYear', { range });
}

/** Within a week of the listing's end. */
export const closingSoon = (expiresAt: string) => new Date(expiresAt).getTime() - Date.now() < 7 * 86_400_000;

/** Keys of every cached query that holds job views. */
const JOB_KEYS = [['jobs'], ['job'], ['job-tracker']] as const;

function patchJob(value: unknown, id: string, fn: (j: JobView) => JobView): unknown {
  if (value && typeof value === 'object' && (value as JobView).id === id && 'applyUrl' in value)
    return fn(value as JobView);
  if (Array.isArray(value)) return value.map((v) => patchJob(v, id, fn));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, patchJob(v, id, fn)]));
  return value;
}

/** Save, track and unsave with instant feedback (rolled back on error). */
export function useTrack(job: Pick<JobView, 'id'>) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const apply = (fn: (j: JobView) => JobView) => {
    const snaps = JOB_KEYS.flatMap((k) => qc.getQueriesData({ queryKey: k }));
    for (const k of JOB_KEYS) qc.setQueriesData({ queryKey: k }, (old: unknown) => patchJob(old, job.id, fn));
    return () => snaps.forEach(([k, d]) => qc.setQueryData(k, d));
  };
  return useMutation({
    mutationFn: (v: { status: TrackStatus | null; note?: string }) =>
      v.status === null
        ? api.delete(`/jobs/${job.id}/track`)
        : // Saving and tracking wait in the outbox when offline (B13); unsaving needs a connection.
          putOrQueue(
            qc,
            `/jobs/${job.id}/track`,
            { status: v.status, ...(v.note !== undefined ? { note: v.note } : {}) },
            [['job-tracker'], ['jobs'], ['job', job.id]],
          ),
    onMutate: (v) => ({
      rollback: apply((j) => ({
        ...j,
        track:
          v.status === null
            ? null
            : { status: v.status, note: v.note ?? j.track?.note ?? '', updatedAt: new Date().toISOString() },
      })),
    }),
    onError: (e, _v, c) => {
      c?.rollback();
      toast.error(e instanceof ApiError ? e.message : t('errors.generic'));
    },
    onSuccess: (d, v) => {
      // Queued offline: the change stays on screen and the outbox says it will be sent.
      if (d === undefined && v.status !== null) return;
      if (v.status === 'saved') toast.success(t('jobs.savedToast'));
      void qc.invalidateQueries({ queryKey: ['job-tracker'] });
    },
  });
}
