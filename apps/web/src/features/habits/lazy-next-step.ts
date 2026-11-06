import { loadPack } from '../../i18n';
import { lazyPart } from '../../lib/lazy-part';

/**
 * Prompt 2, G7: Home's Next Step card, loaded with the `habits` pack only for students who get one.
 * A part (not a bare lazy): if its code cannot load (offline), Home stays and the card comes later.
 */
export const LazyNextStepCard = lazyPart(() =>
  Promise.all([import('./next-step'), loadPack('habits')]).then(([m]) => m.NextStepCard),
);
