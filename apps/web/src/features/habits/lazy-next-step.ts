import { lazy } from 'react';
import { loadPack } from '../../i18n';

/** Prompt 2, G7: Home's Next Step card, loaded with the `habits` pack only for students who get one. */
export const LazyNextStepCard = lazy(() =>
  Promise.all([import('./next-step'), loadPack('habits')]).then(([m]) => ({ default: m.NextStepCard })),
);
