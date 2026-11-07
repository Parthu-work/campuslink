import {
  API_PREFIX,
  type ApiResponse,
  type CopilotAskInput,
  type CopilotStreamEvent,
} from '@campuslink/shared';
import { ApiError, refreshSession } from '../../lib/api';
import { useSession } from '../../lib/session';

/** Splits server-sent events out of a growing buffer (the study assistant's format). */
function take(buffer: string): { events: CopilotStreamEvent[]; rest: string } {
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: CopilotStreamEvent[] = [];
  for (const b of blocks) {
    const data = b
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as CopilotStreamEvent);
    } catch {
      // A malformed event is skipped; `done` carries the saved answer anyway.
    }
  }
  return { events, rest };
}

/** Asks the Career Copilot (POST /copilot/chat) and hands each event to `onEvent` (prompt 2, G11). */
export async function streamCopilot(
  body: CopilotAskInput,
  onEvent: (e: CopilotStreamEvent) => void,
  signal: AbortSignal,
  retried = false,
): Promise<void> {
  const token = useSession.getState().accessToken;
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}/copilot/chat`, {
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
    return streamCopilot(body, onEvent, signal, true);
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
      const { events, rest } = take(buffer);
      buffer = rest;
      for (const e of events) onEvent(e);
    }
    for (const e of take(`${buffer}${decoder.decode()}\n\n`).events) onEvent(e);
  } catch {
    if (signal.aborted) return;
    throw new ApiError(0, 'NETWORK', 'The answer was interrupted. Try again.');
  }
}
