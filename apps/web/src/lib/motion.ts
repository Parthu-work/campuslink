/**
 * Motion, the lazy way (master prompt §7d): screens render `m.*` components inside
 * `<LazyMotion features={motionFeatures} strict>`, so only a small core loads with the screen and the
 * animation and gesture features follow in their own chunk. Import motion from here, never from
 * 'motion/react'.
 */
export {
  LazyMotion,
  m,
  useAnimationControls,
  useMotionValue,
  useTransform,
  type PanInfo,
} from 'motion/react';

export const motionFeatures = () => import('./motion-features').then((r) => r.default);

/**
 * Spring presets (master prompt §6); tokens.css has the same curves as CSS `linear()` easings.
 * Snappy for buttons and toggles, smooth for sheets and cards, bouncy for celebrations only.
 */
export const springs = {
  snappy: { type: 'spring', stiffness: 520, damping: 38 },
  smooth: { type: 'spring', stiffness: 260, damping: 30 },
  bouncy: { type: 'spring', stiffness: 380, damping: 15 },
} as const;
