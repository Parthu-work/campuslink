import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../../lib/preferences';

/** Animated mesh gradient drawn on a 64×40 canvas and scaled by CSS: cheap on low-end phones. */
export function Mesh({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    let raf = 0;
    const draw = (ts: number) => {
      const k = ts / 9000;
      ctx.globalAlpha = 1;
      ctx.fillStyle = css('--bg');
      ctx.fillRect(0, 0, 64, 40);
      const blob = (x: number, y: number, r: number, col: string, a: number) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, col);
        g.addColorStop(1, 'transparent');
        ctx.globalAlpha = a;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 40);
      };
      blob(16 + Math.sin(k) * 10, 10 + Math.cos(k * 1.3) * 6, 30, css('--brand-2'), 0.9);
      blob(48 + Math.cos(k * 0.8) * 10, 8 + Math.sin(k * 1.1) * 5, 26, css('--brand'), 0.75);
      blob(40 + Math.sin(k * 1.4) * 12, 26 + Math.cos(k * 0.7) * 6, 18, css('--accent'), 0.45);
      blob(6 + Math.cos(k * 0.6) * 6, 32, 20, css('--brand-2'), 0.5);
    };
    const loop = (ts: number) => {
      draw(ts);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (prefersReducedMotion() || document.hidden) draw(0);
      else raf = requestAnimationFrame(loop);
    };
    start();
    const obs = new MutationObserver(start);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-motion', 'style'],
    });
    document.addEventListener('visibilitychange', start);
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      document.removeEventListener('visibilitychange', start);
    };
  }, []);
  return <canvas ref={ref} width={64} height={40} aria-hidden className={className} />;
}
