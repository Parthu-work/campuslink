import { useEffect, useState } from 'react';

/** The current time, refreshed every `everyMs` while the component is mounted (countdowns). */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
