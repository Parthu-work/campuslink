import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { useTranslation } from '../../i18n/react';
import { cn } from '../../lib/cn';
import { count, day } from '../../lib/billing';
import { billingNotice } from '../../lib/queries';

/**
 * The admin screens' billing banner (B10), for those who manage the college's settings: read-only,
 * overdue invoices, seats over the plan (never blocking anyone), or a pilot about to end.
 */
export function BillingBanner() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const n = useQuery(billingNotice()).data;
  if (!n || pathname.startsWith('/admin/billing')) return null;
  const lines = [
    n.readOnly && t('billing.banner.readOnly'),
    !n.readOnly && n.overdue > 0 && t('billing.banner.overdue', { count: n.overdue }),
    n.overSeats &&
      n.seatsUsed !== null &&
      t('billing.banner.overSeats', { used: count(n.seatsUsed), seats: count(n.seats) }),
    n.pilotEndsOn && t('billing.banner.pilot', { date: day(n.pilotEndsOn) }),
  ].filter((l): l is string => !!l);
  if (!lines.length) return null;
  const urgent = n.readOnly || n.overdue > 0;
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border p-3 text-meta',
        urgent
          ? 'border-danger bg-danger-surface text-danger-ink'
          : 'border-warning bg-warning-surface text-warning-ink',
      )}
    >
      <span className="grid gap-0.5">
        {lines.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </span>
      <Link to="/admin/billing" className="font-semibold underline underline-offset-4">
        {t('billing.banner.open')}
      </Link>
    </div>
  );
}
