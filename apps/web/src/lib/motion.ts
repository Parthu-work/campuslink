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
