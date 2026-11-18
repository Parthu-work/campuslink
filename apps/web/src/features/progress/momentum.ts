import type { ReadinessMomentum } from '@campuslink/shared';
import type { TFunction } from '../../i18n/core';
import { formatDay } from '../../lib/format';

const DAY = 86_400_000;

/**
 * "+6 this week" (prompt 3, U7): only when the score went up; "this week" when the earlier score
 * is from the last 8 days, otherwise "+6 since 3 Nov". Never a minus (no shame language, A17).
 */
export function momentumText(t: TFunction, m: ReadinessMomentum | null | undefined, now = Date.now()) {
  if (!m || m.delta <= 0) return '';
  return now - Date.parse(m.since) <= 8 * DAY
    ? t('readiness.momentumWeek', { n: m.delta })
    : t('readiness.momentumSince', { n: m.delta, date: formatDay(m.since) });
}
