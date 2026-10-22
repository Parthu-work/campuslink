import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Finds an item the member has already seen in a list (feed pages, radar rows, mentor tiles), so
 * a detail screen can draw it at once while the full record loads (audit PF-3, quick win 6).
 */
export function findCached<T>(
  qc: QueryClient,
  prefixes: readonly QueryKey[],
  match: (value: unknown) => value is T,
): T | undefined {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): T | undefined => {
    if (depth > 5 || value === null || typeof value !== 'object' || seen.has(value)) return undefined;
    seen.add(value);
    if (match(value)) return value;
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const hit = visit(child, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const queryKey of prefixes) {
    for (const [, data] of qc.getQueriesData({ queryKey })) {
      const hit = visit(data, 0);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** True for an object with this `field` equal to `id` and every listed key present. */
export const hasId =
  <T>(field: string, id: string, keys: readonly string[]) =>
  (value: unknown): value is T =>
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)[field] === id &&
    keys.every((k) => k in value);
