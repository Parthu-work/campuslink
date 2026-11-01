import { API_PREFIX, type ClientErrorKind, type MeResponse } from '@campuslink/shared';
import { queryClient } from './query-client';

/**
 * Error reporting from the browser (build B14). Reports go to the college's own API
 * (`POST /client-errors`), which hands them to the platform's error reporter, so no reporting
 * endpoint or key ever reaches the browser and the CSP needs no new source. A report says what
 * broke and where (route with ids masked), with a one-way hash of the member's id, never the id,
 * a name or what was on screen. Each distinct error is sent once per page load.
 */
const sent = new Set<string>();

const maskPath = (p: string) => p.replace(/[a-f0-9]{24}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:n');

async function hashOf(s: string): Promise<string | undefined> {
  try {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(d)]
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return undefined;
  }
}

export async function reportClientError(kind: ClientErrorKind, error: unknown): Promise<void> {
  if (!import.meta.env.PROD) return;
  try {
    const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(
      0,
      300,
    );
    const route = maskPath(location.pathname).slice(0, 200);
    const key = `${kind}|${message}|${route}`;
    if (sent.has(key)) return;
    sent.add(key);
    const me = queryClient.getQueryData<MeResponse>(['me']);
    const userHash = me ? await hashOf(`${location.host}|${me.id}`) : undefined;
    await fetch(`${API_PREFIX}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      keepalive: true,
      body: JSON.stringify({ kind, message, route, ...(userHash ? { userHash } : {}) }),
    });
  } catch {
    /* reporting never breaks the app */
  }
}
