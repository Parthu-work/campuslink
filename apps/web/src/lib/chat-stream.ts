import { API_PREFIX, type ApiResponse, type ChatAskInput, type ChatStreamEvent } from '@campuslink/shared';
import { ApiError, refreshSession } from './api';
import { useSession } from './session';

/** Splits server-sent events out of a growing buffer; returns the events and what is left over. */
export function takeEvents(buffer: string): { events: ChatStreamEvent[]; rest: string } {
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: ChatStreamEvent[] = [];
  for (const b of blocks) {
    const data = b
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as ChatStreamEvent);
    } catch {
      // A malformed event is skipped; the final `done` carries the saved answer anyway.
    }
  }
  return { events, rest };
}

/**
 * Asks the study assistant (POST /study/chat) and hands each server-sent event to `onEvent` as it
 * arrives. Errors before the stream starts (validation, access, limits) throw an ApiError like any
 * other request; aborting (Stop) ends quietly and the server keeps what was written.
 */
export async function streamChat(
  body: ChatAskInput,
  onEvent: (e: ChatStreamEvent) => void,
  signal: AbortSignal,
  retried = false,
): Promise<void> {
  const token = useSession.getState().accessToken;
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}/study/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal.aborted) return;
    throw new ApiError(0, 'NETWORK', 'You seem to be offline. Check your connection and try again.');
  }
  if (res.status === 401 && token && !retried && (await refreshSession()))
    return streamChat(body, onEvent, signal, true);
  if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').startsWith('text/event-stream')) {
    const b = (await res.json().catch(() => null)) as ApiResponse<unknown> | null;
    if (b && !b.ok)
      throw new ApiError(res.status, b.error.code, b.error.message, b.error.details, b.error.requestId);
    throw new ApiError(res.status, 'INTERNAL', 'Something went wrong. Please try again.');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = takeEvents(buffer);
      buffer = rest;
      for (const e of events) onEvent(e);
    }
    const { events } = takeEvents(`${buffer}${decoder.decode()}\n\n`);
    for (const e of events) onEvent(e);
  } catch {
    if (signal.aborted) return;
    throw new ApiError(0, 'NETWORK', 'The answer was interrupted. Try again.');
  }
}
