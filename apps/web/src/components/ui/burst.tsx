import { useEffect, type CSSProperties } from 'react';
import { prefersReducedMotion } from '../../lib/preferences';

const PARTICLES = 18;
const COLOURS = ['var(--aurora-1)', 'var(--aurora-2)', 'var(--aurora-3)'];

/**
 * The aurora burst (lib/celebrate.ts): a ring and a scatter of sparks from one point, transform and
 * opacity only, gone in 1.2 s. Under reduced motion, a still glow that fades. Decorative.
 */
export function Burst({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const still = prefersReducedMotion();
  useEffect(() => {
    const t = window.setTimeout(onDone, 1200);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[95] overflow-hidden">
      <div className="absolute" style={{ left: x, top: y }}>
        {still ? (
          <span className="burst-glow absolute -top-16 -left-16 size-32 rounded-full" />
        ) : (
          <>
            <span className="burst-ring absolute -top-14 -left-14 size-28 rounded-full" />
            {Array.from({ length: PARTICLES }, (_, i) => {
              const angle = (360 / PARTICLES) * i + (i % 2 ? 7 : -5);
              const distance = 70 + ((i * 37) % 60);
              const style = {
                '--a': `${angle}deg`,
                '--d': `${distance}px`,
                background: COLOURS[i % COLOURS.length],
                animationDelay: `${(i % 4) * 30}ms`,
              } as CSSProperties;
              return (
                <span
                  key={i}
                  className={`burst-spark absolute rounded-full ${i % 3 === 0 ? 'size-2.5' : 'size-1.5'}`}
                  style={style}
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
