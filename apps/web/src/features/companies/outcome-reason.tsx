import type { MatchReason } from '@campuslink/shared';
import { useTranslation } from '../../i18n/react';

type OutcomeKind = Extract<MatchReason, { kind: 'outcomes' } | { kind: 'referrals' }>;

/** An outcome-proven match reason in plain words (prompt 2, G10), with the `moat` pack's strings. */
export function OutcomeReason({ reason }: { reason: OutcomeKind }) {
  const { t } = useTranslation();
  return (
    <>
      {reason.kind === 'outcomes'
        ? t(`moat.reason.outcomes_${reason.scope}`, { count: reason.count })
        : t('moat.reason.referrals', { count: reason.count })}
    </>
  );
}
