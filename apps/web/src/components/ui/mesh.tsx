import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../../lib/preferences';

/** About 24 frames a second: the canvas is 64×40 scaled up, so more frames would not look smoother. */
const FRAME_MS = 1000 / 24;
/** The animation waits for the page's first screen to settle (prompt 3, U10: it was load-time work). */
const START_AFTER_MS = 2500;

type Colours = { bg: string; brand: string; brand2: string; accent: string; strength: number };

/**
 * Animated mesh gradient drawn on a 64×40 canvas and scaled by CSS: cheap on low-end phones. One
 * still frame paints at once; the motion starts once the page has settled. The theme's colours are
 * read once and again only when the theme changes, never per frame (reading them forces style work).
 */
export function Mesh({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const readColours = (): Colours => {
      const s = getComputedStyle(document.documentElement);
      const v = (n: string) => s.getPropertyValue(n).trim();
      return {
        bg: v('--bg'),
        brand: v('--brand'),
        brand2: v('--brand-2'),
        accent: v('--accent'),
        strength: Number(v('--mesh-strength')) || 1,
      };
    };
    let colours = readColours();
    const draw = (ts: number) => {
      const { bg, brand, brand2, accent, strength } = colours;
      const k = ts / 9000;
      ctx.globalAlpha = 1;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 64, 40);
      const blob = (x: number, y: number, r: number, col: string, a: number) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, col);
        g.addColorStop(1, 'transparent');
        ctx.globalAlpha = a * strength;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 40);
      };
      blob(16 + Math.sin(k) * 10, 10 + Math.cos(k * 1.3) * 6, 30, brand2, 0.9);
      blob(48 + Math.cos(k * 0.8) * 10, 8 + Math.sin(k * 1.1) * 5, 26, brand, 0.75);
      blob(40 + Math.sin(k * 1.4) * 12, 26 + Math.cos(k * 0.7) * 6, 18, accent, 0.45);
      blob(6 + Math.cos(k * 0.6) * 6, 32, 20, brand2, 0.5);
    };
    let raf = 0;
    let last = 0;
    let moving = false;
    const loop = (ts: number) => {
      if (ts - last >= FRAME_MS) {
        last = ts;
        draw(ts);
      }
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (!moving || prefersReducedMotion() || document.hidden) draw(performance.now());
      else raf = requestAnimationFrame(loop);
    };
    start();
    const wake = window.setTimeout(() => {
      moving = true;
      start();
    }, START_AFTER_MS);
    // The theme changed: new colours, then carry on as before.
    const obs = new MutationObserver(() => {
      colours = readColours();
      start();
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-motion', 'style'],
    });
    document.addEventListener('visibilitychange', start);
    return () => {
      window.clearTimeout(wake);
      cancelAnimationFrame(raf);
      obs.disconnect();
      document.removeEventListener('visibilitychange', start);
    };
  }, []);
  return <canvas ref={ref} width={64} height={40} aria-hidden className={className} />;
}
