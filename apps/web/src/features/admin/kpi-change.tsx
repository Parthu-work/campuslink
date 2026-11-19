import { kpiChange, type Count } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';
import { Change } from '../../components/ui/change';
import { formatNumber } from '../../lib/numbers';

/**
 * A headline number's change in words (prompt 3, U9c), for the dashboards' `StatCard` hints:
 * "Up 12 on the 6 months before". No change is computed from a figure under 5 (`kpiChange`);
 * the line then says what the earlier figure was, or that there is none yet.
 */
export function KpiChange({
  k,
  against,
  unit = 'count',
  better = 'up',
}: {
  k: { value: Count | null; previous: Count | null };
  /** The earlier period as a phrase: "the 6 months before", "the 2025–26 batch", "last week". */
  against: string;
  unit?: 'count' | 'points';
  better?: 'up' | 'down';
}) {
  const { t } = useTranslation();
  const delta = kpiChange(k);
  const text =
    k.previous === null
      ? t('staff.kpi.noEarlier')
      : delta === null
        ? k.previous === '<5'
          ? t('staff.kpi.wasSmall', { against })
          : t('staff.kpi.was', { n: formatNumber(k.previous), against })
        : delta === 0
          ? t('staff.kpi.same', { against })
          : t(`staff.kpi.${delta > 0 ? 'up' : 'down'}${unit === 'points' ? 'Points' : ''}`, {
              n: formatNumber(Math.abs(delta)),
              against,
            });
  return <Change delta={delta} text={text} better={better} />;
}
