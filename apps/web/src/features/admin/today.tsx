import { useQuery } from '@tanstack/react-query';
import type { Count } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { buttonVariants } from '../../components/ui/button-variants';
import { Countdown } from '../../components/ui/countdown';
import { ErrorState } from '../../components/ui/error-state';
import { IntentLink } from '../../components/ui/intent-link';
import { ListRow, ListSection } from '../../components/ui/list-row';
import { Skeleton } from '../../components/ui/misc';
import { formatDay } from '../../lib/format';
import { formatNumber } from '../../lib/numbers';
import { adminOverview } from '../../lib/queries';
import { todayItems } from './today-items';

const shown = (c: Count | number) => (c === '<5' ? '<5' : formatNumber(c));

/**
 * Today (prompt 3, U9; replaces Admin › Overview): what is waiting for this member, most urgent
 * first, each with one action; nothing at zero. All clear says so, with the next drive.
 */
export function StaffToday() {
  const { t } = useTranslation();
  const q = useQuery(adminOverview());
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const v = q.data;
  if (!v)
    return (
      <div className="grid gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[4.5rem] rounded-[var(--radius-md)]" />
        ))}
      </div>
    );
  const items = todayItems(v, t, formatDay);
  const next = v.placements?.next;
  return (
    <div className="grid gap-5">
      {items.length ? (
        <ListSection title={t('staff.today.waiting')}>
          {items.map((it) => (
            <ListRow
              key={it.key}
              title={it.title}
              meta={
                it.key === 'drives' && v.placements?.soonest ? (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{it.meta}</span>
                    <Countdown at={v.placements.soonest.at} urgentWithinMs={48 * 3600_000} />
                  </span>
                ) : (
                  it.meta
                )
              }
              trailing={
                <IntentLink to={it.to} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                  {it.action}
                </IntentLink>
              }
            />
          ))}
        </ListSection>
      ) : (
        <div className="grid gap-2 rounded-[var(--radius-md)] border border-line bg-surface-1 p-4">
          <p className="text-headline font-semibold">{t('staff.today.clear')}</p>
          {next && (
            <IntentLink
              to={`/admin/placements/${next.id}`}
              className="inline-flex min-h-11 w-fit items-center text-callout font-semibold text-brand-ink hover:underline"
            >
              {t('staff.today.next', { company: next.company, date: formatDay(next.at) })}
            </IntentLink>
          )}
        </div>
      )}
      {(v.members || v.activity) && (
        <IntentLink
          to="/admin/analytics"
          className="inline-flex min-h-11 w-fit items-center text-callout text-fg-2 hover:underline"
        >
          {v.members && v.activity
            ? t('staff.today.week', { members: shown(v.members.active), active: shown(v.activity.last7) })
            : v.members
              ? t('staff.today.members', { members: shown(v.members.active) })
              : t('staff.today.active', { active: shown(v.activity?.last7 ?? 0) })}
        </IntentLink>
      )}
    </div>
  );
}
