import { useEffect, useRef, useState } from 'react';
import { useMatches } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowDown, RefreshCw } from 'lucide-react';

/** Travel (after resistance) that refreshes on release, and the most the indicator moves. */
const PULL = 72;
const MAX = 112;
/** Eases towards MAX, so the pull feels like it stretches rather than tracking the finger 1:1. */
const resist = (dy: number) => MAX * (1 - Math.exp(-dy / (MAX * 1.6)));

/** Where a pull must not start: overlays, fields, inner scrollers that are not at their top. */
function blocked(target: EventTarget | null) {
  if (document.querySelector('[role="dialog"]')) return true;
  for (
    let el = target instanceof Element ? target : null;
    el && el !== document.body;
    el = el.parentElement
  ) {
    if (el.matches('[data-no-pull], input, textarea, select, [contenteditable="true"]')) return true;
    const s = getComputedStyle(el);
    if (s.touchAction.includes('none')) return true;
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollTop > 0) return true;
  }
  return false;
}

/**
 * Pull to refresh on phones (master prompt §6, audit PW-4): at the top of a screen, pull down past
 * the aurora ring and let go, and the screen's reads refetch, as re-tapping its tab does. It never
 * reloads the page (the browser's own pull is off: `overscroll-behavior-y: none`). Forms and
 * editors opt out (`pull: false` on their route), so nothing refetches under someone typing.
 * Listeners are passive; the indicator moves by transform and fades by opacity, set directly on
 * the element rather than through React state on every touch move.
 */
export function PullToRefresh() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const matches = useMatches();
  const off = matches.some((m) => (m.handle as { pull?: boolean } | undefined)?.pull === false);
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'idle' | 'pulling' | 'refreshing'>('idle');
  const refreshing = useRef(false);

  // One set of listeners per screen kind; the gesture's own state lives in this closure, so a
  // phase change (a re-render) never interrupts a pull in progress.
  useEffect(() => {
    if (off) return;
    const el = ref.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    let pulling = false;
    let distance = 0;
    const show = (d: number) => {
      distance = d;
      el.style.setProperty('--pull', `${d}px`);
      el.style.setProperty('--pull-p', String(Math.min(1, d / PULL)));
    };
    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      start =
        !refreshing.current && e.touches.length === 1 && touch && window.scrollY <= 0 && !blocked(e.target)
          ? { x: touch.clientX, y: touch.clientY }
          : null;
      pulling = false;
    };
    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!pulling) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        // Sideways or upward first: a swipe or a scroll, not a pull.
        if (dy <= 0 || Math.abs(dx) > dy || window.scrollY > 0) {
          start = null;
          return;
        }
        pulling = true;
        setPhase('pulling');
      }
      show(resist(Math.max(0, dy)));
    };
    const onEnd = () => {
      if (!pulling) return;
      start = null;
      pulling = false;
      if (distance >= PULL) {
        refreshing.current = true;
        setPhase('refreshing');
      } else {
        el.dataset.phase = 'idle'; // springs back with the transition, before React re-renders
        show(0);
        setPhase('idle');
      }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [off]);

  useEffect(() => {
    if (phase !== 'refreshing') return;
    const el = ref.current;
    el?.style.setProperty('--pull', `${PULL * 0.8}px`);
    el?.style.setProperty('--pull-p', '1');
    let live = true;
    // Long enough to read as "refreshed", even when every read answers at once.
    const settle = new Promise((r) => setTimeout(r, 600));
    void Promise.allSettled([qc.refetchQueries({ type: 'active' }), settle]).then(() => {
      if (!live) return;
      el?.style.setProperty('--pull', '0px');
      el?.style.setProperty('--pull-p', '0');
      refreshing.current = false;
      setPhase('idle');
    });
    return () => {
      live = false;
    };
  }, [phase, qc]);

  return (
    <div
      ref={ref}
      data-phase={phase}
      className="pull-indicator pointer-events-none fixed inset-x-0 top-[var(--chrome-top)] z-30 flex justify-center lg:hidden"
    >
      <span className="pull-ring grid size-10 rounded-full shadow-elev-2">
        <span className="pull-spin aurora-ring grid size-full rounded-full p-[2px]">
          <span className="grid size-full place-items-center rounded-full bg-surface-1 text-brand-ink">
            {phase === 'refreshing' ? (
              <RefreshCw className="size-[18px]" aria-hidden />
            ) : (
              <ArrowDown className="pull-arrow size-5" aria-hidden />
            )}
          </span>
        </span>
      </span>
      <span role="status" className="sr-only">
        {phase === 'refreshing' ? t('common.refreshing') : ''}
      </span>
    </div>
  );
}
