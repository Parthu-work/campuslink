import { lazyPart } from '../../lib/lazy-part';
import { useCelebration } from '../../lib/celebrate';

const Burst = lazyPart(() => import('../ui/burst').then((m) => m.Burst));

/** Draws the current celebration; the burst's code loads the first time something is celebrated. */
export function CelebrationHost() {
  const current = useCelebration((s) => s.current);
  const clear = useCelebration((s) => s.clear);
  if (!current) return null;
  return <Burst key={current.id} x={current.x} y={current.y} onDone={clear} />;
}
