import { useEffect, useState } from 'react';

/** False until the browser's first idle period after mount (Safari: 1.5 s), then true. */
export function useIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const done = () => setIdle(true);
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(done, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(done, 1500);
    return () => clearTimeout(id);
  }, []);
  return idle;
}
