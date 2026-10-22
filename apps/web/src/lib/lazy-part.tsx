import { Component, lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';

class Quiet extends Component<
  { fallback: ReactNode; onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onError();
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * A part of the shell whose code loads after the first screen (the palette, the account menu, the
 * sheets). When that load fails (offline before it arrived, a deploy that removed the file) the
 * fallback stays and the load is tried again when the connection returns; the shell around it,
 * and the screen, never fail with it.
 */
export function lazyPart<P extends object>(load: () => Promise<ComponentType<P>>) {
  const make = () => lazy(() => load().then((C) => ({ default: C })));
  let Loaded = make();
  let attempt = 0;
  return function LazyPart({ fallback = null, ...props }: P & { fallback?: ReactNode }) {
    const [tried, setTried] = useState(attempt);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if (!failed) return;
      const retry = () => {
        // The first instance back online starts a fresh load; the others share it.
        if (tried === attempt) {
          attempt += 1;
          Loaded = make();
        }
        setTried(attempt);
        setFailed(false);
      };
      window.addEventListener('online', retry);
      return () => window.removeEventListener('online', retry);
    }, [failed, tried]);
    const Part = Loaded;
    return (
      <Quiet key={tried} fallback={fallback} onError={() => setFailed(true)}>
        <Suspense fallback={fallback}>
          <Part {...(props as P)} />
        </Suspense>
      </Quiet>
    );
  };
}
