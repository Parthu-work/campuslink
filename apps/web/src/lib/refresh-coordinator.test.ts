import { describe, expect, it } from 'vitest';
import { createRefreshCoordinator, type ChannelLike, type LockLike } from './refresh-coordinator';

/** A fake server: rotation succeeds only with the current cookie; reusing an old one revokes. */
function fakeServer() {
  let cookie = 0;
  let revoked = false;
  let rotations = 0;
  return {
    /** What a tab's fetch would send: the cookie jar value at request time. */
    async rotate(delay = 5): Promise<string | null> {
      const sent = cookie;
      await new Promise((r) => setTimeout(r, delay));
      if (revoked) return null;
      if (sent !== cookie) {
        revoked = true; // reuse detection
        return null;
      }
      cookie += 1;
      rotations += 1;
      return `access-${cookie}`;
    },
    get revoked() {
      return revoked;
    },
    get rotations() {
      return rotations;
    },
  };
}

/** In-process stand-ins for the browser's shared lock manager and broadcast channel. */
function browser() {
  let tail: Promise<unknown> = Promise.resolve();
  const locks: LockLike = {
    request<T>(_name: string, cb: () => Promise<T>) {
      const run = tail.then(cb, cb);
      tail = run.catch(() => undefined);
      return run;
    },
  };
  const listeners: ((e: { data: unknown }) => void)[] = [];
  const channel = (): ChannelLike => {
    const mine: ((e: { data: unknown }) => void)[] = [];
    return {
      postMessage(data) {
        // Like BroadcastChannel: delivered to every other tab, asynchronously.
        for (const l of listeners) if (!mine.includes(l)) queueMicrotask(() => l({ data }));
      },
      addEventListener(_t, l) {
        mine.push(l);
        listeners.push(l);
      },
    };
  };
  return { locks, channel };
}

const deps = (b: ReturnType<typeof browser>, withLocks: boolean) => ({
  locks: withLocks ? b.locks : null,
  channel: b.channel(),
  now: () => Date.now(),
  wait: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
});

describe('refresh coordinator (PW-8)', () => {
  it('shares one rotation between concurrent callers in a tab', async () => {
    const server = fakeServer();
    const b = browser();
    const tab = createRefreshCoordinator(() => server.rotate(), deps(b, true));
    const results = await Promise.all([tab.refresh(), tab.refresh(), tab.refresh()]);
    expect(new Set(results)).toEqual(new Set(['access-1']));
    expect(server.rotations).toBe(1);
    expect(server.revoked).toBe(false);
  });

  it('never presents the same cookie twice when tabs refresh at once (Web Locks)', async () => {
    const server = fakeServer();
    const b = browser();
    const tabs = Array.from({ length: 4 }, () =>
      createRefreshCoordinator(() => server.rotate(), deps(b, true)),
    );
    const results = await Promise.all(tabs.map((t) => t.refresh()));
    expect(server.revoked).toBe(false);
    expect(results.every((r) => r !== null)).toBe(true);
    // Tabs that queued behind another tab adopt its token instead of rotating again.
    expect(server.rotations).toBe(1);
    // Later refreshes keep working.
    expect(await tabs[2]?.refresh()).toBe('access-2');
    expect(server.revoked).toBe(false);
  });

  it('coordinates through BroadcastChannel when Web Locks are missing', async () => {
    const server = fakeServer();
    const b = browser();
    const a = createRefreshCoordinator(() => server.rotate(30), deps(b, false));
    const c = createRefreshCoordinator(() => server.rotate(30), deps(b, false));
    const first = a.refresh();
    await new Promise((r) => setTimeout(r, 5)); // tab c hears "refresh-start" before it starts
    const second = c.refresh();
    expect(await first).toBe('access-1');
    expect(await second).toBe('access-1');
    expect(server.revoked).toBe(false);
  });

  it('reports a dead session as null without retrying', async () => {
    const b = browser();
    let calls = 0;
    const tab = createRefreshCoordinator(
      async () => {
        calls += 1;
        return null;
      },
      deps(b, true),
    );
    expect(await tab.refresh()).toBeNull();
    expect(calls).toBe(1);
  });

  it('tells other tabs about an explicit sign-out', async () => {
    const b = browser();
    const a = createRefreshCoordinator(async () => 'x', deps(b, true));
    const c = createRefreshCoordinator(async () => 'x', deps(b, true));
    let heard = 0;
    c.onSignedOutElsewhere(() => (heard += 1));
    a.announceSignOut();
    await new Promise((r) => setTimeout(r, 0));
    expect(heard).toBe(1);
  });
});
