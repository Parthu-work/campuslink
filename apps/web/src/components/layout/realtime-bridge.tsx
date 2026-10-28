import { useRealtimeBridge } from '../../lib/use-realtime-bridge';

/** Connects the socket and turns server events into cache updates (loaded after first paint). */
export function RealtimeBridge() {
  useRealtimeBridge();
  return null;
}
