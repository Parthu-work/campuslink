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
 * and the screen, never fail with it. `preload()` loads it ahead (a route loader); once loaded,
 * the part renders the component directly, without suspending (a lazy component suspends on its
 * first render even when its code is already there, which swaps the fallback for the part a frame
 * later and can move the page).
 */
export function lazyPart<P extends object>(load: () => Promise<ComponentType<P>>) {
  let resolved: ComponentType<P> | null = null;
  const fetchPart = () =>
    load().then((C) => {
      resolved = C;
      return C;
    });
  const make = () => lazy(() => fetchPart().then((C) => ({ default: C })));
  let Loaded = make();
  let attempt = 0;
  // One extra try when a load fails while already online: it failed as the connection came back,
  // after the `online` event had fired. Only one, so a file a deploy removed is not asked for in a loop.
  let spare = true;
  function LazyPart({ fallback = null, ...props }: P & { fallback?: ReactNode }) {
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
      const back = () => {
        spare = true;
        retry();
      };
      window.addEventListener('online', back);
      let timer: number | undefined;
      if (navigator.onLine && spare) {
        spare = false;
        timer = window.setTimeout(retry, 1000);
      }
      return () => {
        window.removeEventListener('online', back);
        window.clearTimeout(timer);
      };
    }, [failed, tried]);
    // Chosen once per mount: switching from the lazy wrapper to the loaded component mid-life
    // would remount the part (a sheet would lose its state and its history entry).
    const [ready] = useState(() => resolved);
    const Part = ready ?? Loaded;
    return (
      <Quiet key={tried} fallback={fallback} onError={() => setFailed(true)}>
        <Suspense fallback={fallback}>
          <Part {...(props as P)} />
        </Suspense>
      </Quiet>
    );
  }
  return Object.assign(LazyPart, { preload: () => fetchPart().then(() => undefined) });
}
