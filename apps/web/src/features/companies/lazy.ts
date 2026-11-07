import { loadPack } from '../../i18n';
import { lazyPart } from '../../lib/lazy-part';

/**
 * Prompt 2, G10: an outcome-proven match reason on the mentors screen, loaded with the `moat` pack
 * only when a match has one. A part: if it cannot load (offline), the rest of the reasons stay.
 */
export const LazyOutcomeReason = lazyPart(() =>
  Promise.all([import('./outcome-reason'), loadPack('moat')]).then(([m]) => m.OutcomeReason),
);
