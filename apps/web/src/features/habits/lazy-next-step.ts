import { loadPack } from '../../i18n';
import { lazyPart } from '../../lib/lazy-part';

/**
 * Home's "Your next steps" (prompt 2, G7; rows since prompt 3, U5), loaded with the `habits` pack
 * only for students who get a Next Step. A part (not a bare lazy): if its code cannot load
 * (offline), Home stays and the rows come later.
 */
export const LazyNextSteps = lazyPart(() =>
  Promise.all([import('./next-step'), loadPack('habits')]).then(([m]) => m.NextStepsList),
);
/** Home's route loader loads the rows' code and pack with the page, so they paint with it (no shift). */
export const preloadNextSteps = () => LazyNextSteps.preload();
