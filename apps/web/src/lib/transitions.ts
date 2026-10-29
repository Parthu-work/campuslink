/**
 * Whether screen changes animate (view transitions, master prompt §7b). A view transition needs a
 * spare frame to snapshot the screen before and after; on a device that is already dropping frames
 * that costs 300–500 ms per tap (measured in the re-audit at 4× CPU). So screens switch without the
 * animation on low-end devices (`data-lowend`, set by boot.js) and once the main thread has shown
 * three tasks of 200 ms or more: taps stay quick there, and every other device keeps the motion.
 */
const LONG_TASK_MS = 200;
const SLOW_AFTER = 3;
let longTasks = 0;

try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.duration >= LONG_TASK_MS) longTasks += 1;
  }).observe({ type: 'longtask', buffered: true });
} catch {
  // No Long Tasks API (Safari, Firefox): only the low-end check applies.
}

export function animateScreens(): boolean {
  return !document.documentElement.hasAttribute('data-lowend') && longTasks < SLOW_AFTER;
}
