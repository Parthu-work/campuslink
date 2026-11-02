import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';
import { OFFLINE_MAX_AGE_DAYS, type MeResponse } from '@campuslink/shared';
import i18n from '../i18n/core';
import { ApiError, apiRequest, refreshSession } from './api';
import { forgetRestored, markRestored, restoredHashes } from './offline-state';
import { persistable, toSaved } from './offline-rules';
import { useSession } from './session';
import { toast } from './toast';

/**
 * The offline copy (build B13): a small, hand-written IndexedDB persister for the member's own
 * reads, so the core screens open on a bad connection and stay readable offline. It loads in its
 * own chunk at boot (lib/boot.ts); nothing here is in the first load.
 *
 * - Only the reads `persistable()` names are kept: the member's profile, sessions, conversations
 *   and their last 50 messages, the job tracker, followed roadmaps, registered drives, study
 *   material they opened and the first page of their feed. Other members' profiles never are, and
 *   contact fields are stripped from everything except the member's own profile (`stripContacts`).
 * - Everything is wiped when the member signs out, or the session turns out to be gone (shared
 *   phones), and when a different member signs in on the device.
 * - Safe writes made offline (RSVP, save a job, mark a roadmap step) wait in an outbox and are
 *   replayed with their Idempotency-Key when the connection is back (`queueWrite`, `replayOutbox`).
 */

const DB_NAME = 'cl-offline';
const QUERIES = 'queries';
const OUTBOX = 'outbox';
const MAX_AGE_MS = OFFLINE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
/** Detail reads (a roadmap, a material, a drive, a conversation) kept at most, newest first. */
const MAX_ENTRIES = 80;
const WRITE_DELAY_MS = 800;

interface SavedQuery {
  hash: string;
  key: QueryKey;
  data: unknown;
  /** When the server answered (the query's dataUpdatedAt). */
  at: number;
  /** The member it belongs to (null for the college's public details). */
  owner: string | null;
}

export interface QueuedWrite {
  /** The Idempotency-Key, so a replay after a lost answer never applies twice. */
  id: string;
  method: 'PUT';
  path: string;
  body: unknown;
  /** Query keys to refresh once it is saved. */
  invalidate: QueryKey[];
  owner: string;
  queuedAt: number;
}

// ── IndexedDB ─────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(QUERIES, { keyPath: 'hash' });
      req.result.createObjectStore(OUTBOX, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
  return dbPromise;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | undefined,
) {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      }),
  );
}

const all = <T>(store: string) =>
  run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>).then((rows) => rows ?? []);

/** Removes everything this device saved for any member (sign-out, a dead session, another member). */
export async function clearOfflineCopy(): Promise<void> {
  await Promise.all([
    run(QUERIES, 'readwrite', (s) => s.clear()),
    run(OUTBOX, 'readwrite', (s) => s.clear()),
  ]);
}

// ── Restore, save, wipe ─────────────────────────────

let started: Promise<{ owner: string | null }> | null = null;

/**
 * Restores the saved copy into the cache (only where the cache has nothing yet), then keeps it up
 * to date. Resolves with the member the copy belongs to, or null when there is none.
 */
export function startOfflineCache(qc: QueryClient): Promise<{ owner: string | null }> {
  started ??= restore(qc)
    .catch(() => ({ owner: null }))
    .then((r) => {
      watch(qc);
      return r;
    });
  return started;
}

async function restore(qc: QueryClient): Promise<{ owner: string | null }> {
  if (typeof indexedDB === 'undefined') return { owner: null };
  const rows = await all<SavedQuery>(QUERIES);
  const now = Date.now();
  const me = rows.find((r) => r.hash === hashOf(['me']));
  const owner = me?.owner ?? null;
  const fresh = rows.filter((r) => now - r.at < MAX_AGE_MS && (r.owner === null || r.owner === owner));
  const stale = rows.filter((r) => !fresh.includes(r)).map((r) => r.hash);
  if (stale.length) await run(QUERIES, 'readwrite', (s) => void stale.forEach((h) => s.delete(h)));
  for (const r of fresh) {
    if (qc.getQueryData(r.key) !== undefined) continue;
    qc.setQueryData(r.key, r.data, { updatedAt: r.at });
    markRestored(r.hash, r.at);
  }
  // Shown at once, but never trusted as fresh: every screen asks the server again on mount (a copy
  // saved seconds ago would otherwise count as fresh and hide what changed since).
  const restored = new Set(fresh.map((r) => r.hash));
  await qc.invalidateQueries({ predicate: (q) => restored.has(q.queryHash), refetchType: 'none' });
  return { owner: me && now - me.at < MAX_AGE_MS ? owner : null };
}

const hashOf = (key: QueryKey) => JSON.stringify(key);
const meId = (qc: QueryClient) => qc.getQueryData<MeResponse>(['me'])?.id ?? null;

function watch(qc: QueryClient) {
  const dirty = new Map<string, Query>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastOwner: string | null = null;

  const flush = async () => {
    timer = null;
    // Nothing is saved before the session is known to be signed in; reads that finished earlier
    // (the college, fetched at boot or on the sign-in screen) wait for it rather than being lost.
    const status = useSession.getState().status;
    if (status === 'signed-out') return dirty.clear();
    if (status !== 'signed-in') return;
    const owner = meId(qc);
    const rows: SavedQuery[] = [];
    for (const [hash, q] of dirty) {
      const isPublic = q.queryKey[0] === 'tenant';
      // The member is not known yet (`/me` still loading): keep it for the next write.
      if (!isPublic && !owner) continue;
      dirty.delete(hash);
      rows.push({
        hash,
        key: q.queryKey,
        data: toSaved(q.queryKey, q.state.data),
        at: q.state.dataUpdatedAt,
        owner: isPublic ? null : owner,
      });
    }
    if (!rows.length) return;
    await run(QUERIES, 'readwrite', (s) => void rows.forEach((r) => s.put(r))).catch(() => undefined);
    await prune().catch(() => undefined);
  };

  qc.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' || e.action.type !== 'success' || !persistable(e.query.queryKey)) return;
    if (e.query.queryKey[0] === 'me') {
      // Another member on this device: nothing of the previous one may stay.
      const id = (e.query.state.data as MeResponse | undefined)?.id ?? null;
      if (lastOwner && id && id !== lastOwner) void wipe(qc);
      lastOwner = id;
    }
    forgetRestored(e.query.queryHash);
    dirty.set(e.query.queryHash, e.query);
    timer ??= setTimeout(() => void flush(), WRITE_DELAY_MS);
  });

  // Reads that finished before this module loaded (the college, fetched at boot) are saved too.
  for (const q of qc.getQueryCache().getAll())
    if (q.state.status === 'success' && persistable(q.queryKey) && !restoredHashes().includes(q.queryHash))
      dirty.set(q.queryHash, q);
  if (dirty.size) timer ??= setTimeout(() => void flush(), WRITE_DELAY_MS);

  useSession.subscribe((s, prev) => {
    if (s.status === prev.status) return;
    if (s.status === 'signed-out') void wipe(qc);
    if (s.status === 'signed-in') {
      if (dirty.size) timer ??= setTimeout(() => void flush(), WRITE_DELAY_MS);
      void replayOutbox(qc);
    }
  });

  // Back online: an offline session is checked again; a signed-in one sends what waited.
  const reconnect = () => {
    const status = useSession.getState().status;
    if (status === 'offline') void refreshSession();
    else if (status === 'signed-in') void replayOutbox(qc);
  };
  window.addEventListener('online', reconnect);
  // The API may have been down rather than the network: try again now and then.
  setInterval(() => {
    if (useSession.getState().status === 'offline' && navigator.onLine) void refreshSession();
  }, 30_000);
  if (useSession.getState().status === 'signed-in') void replayOutbox(qc);
}

/** Wipes the device copy and drops what was restored from it from memory. */
async function wipe(qc: QueryClient) {
  const hashes = new Set(restoredHashes());
  qc.removeQueries({ predicate: (q) => hashes.has(q.queryHash) && q.queryKey[0] !== 'tenant' });
  hashes.forEach(forgetRestored);
  await clearOfflineCopy().catch(() => undefined);
}

/** Keeps the newest MAX_ENTRIES saved reads. */
async function prune() {
  const rows = await all<SavedQuery>(QUERIES);
  if (rows.length <= MAX_ENTRIES) return;
  const old = rows
    .sort((a, b) => b.at - a.at)
    .slice(MAX_ENTRIES)
    .map((r) => r.hash);
  await run(QUERIES, 'readwrite', (s) => void old.forEach((h) => s.delete(h)));
}

// ── Offline outbox ─────────────────────────────

/** Keeps a safe write for later (it has its Idempotency-Key already). */
export async function queueWrite(w: Omit<QueuedWrite, 'owner' | 'queuedAt'>, qc: QueryClient): Promise<void> {
  const owner = meId(qc);
  if (!owner) throw new ApiError(0, 'NETWORK', i18n.t('errors.offlineShort'));
  await run(OUTBOX, 'readwrite', (s) => s.put({ ...w, owner, queuedAt: Date.now() }));
}

let replaying: Promise<void> | null = null;

/** Sends what waited, oldest first. A refused write is dropped and reported; a network error stops. */
export function replayOutbox(qc: QueryClient): Promise<void> {
  replaying ??= (async () => {
    try {
      const owner = meId(qc);
      const waiting = (await all<QueuedWrite>(OUTBOX)).sort((a, b) => a.queuedAt - b.queuedAt);
      let sent = 0;
      for (const w of waiting) {
        if (w.owner !== owner) {
          await run(OUTBOX, 'readwrite', (s) => s.delete(w.id));
          continue;
        }
        try {
          await apiRequest(w.path, { method: w.method, body: w.body, idempotencyKey: w.id });
          sent += 1;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'NETWORK') return;
          toast.error(i18n.t('offline.replayFailed'));
        }
        await run(OUTBOX, 'readwrite', (s) => s.delete(w.id));
        for (const k of w.invalidate) void qc.invalidateQueries({ queryKey: k });
      }
      if (sent) toast.success(i18n.t('offline.replayed', { count: sent }));
    } catch {
      /* storage unavailable: nothing waited */
    } finally {
      replaying = null;
    }
  })();
  return replaying;
}
