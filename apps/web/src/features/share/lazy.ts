import { loadPack } from '../../i18n';
import { lazyPart } from '../../lib/lazy-part';

const extras = () => Promise.all([import('./referral-extras'), loadPack('share')]).then(([m]) => m);

/**
 * Prompt 2, G8: the referrals page's outcome picker and impact card, with the `share` pack. Parts,
 * so a load that fails offline leaves the page as it is.
 */
export const LazyReferralOutcome = lazyPart(() => extras().then((m) => m.ReferralOutcomePicker));
export const LazyReferralImpact = lazyPart(() => extras().then((m) => m.ReferralImpact));
