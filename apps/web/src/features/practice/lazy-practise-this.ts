import { loadPack } from '../../i18n';
import { lazyPart } from '../../lib/lazy-part';

/**
 * "Practise this" on a career path's step (prompt 3, U7), with the `practice` pack: loaded only
 * when an open step names a practice topic. A part: if it cannot load, the step stays.
 */
export const LazyPractiseThis = lazyPart(() =>
  Promise.all([import('./practise-this'), loadPack('practice')]).then(([m]) => m.PractiseThis),
);
