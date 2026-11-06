import { useCallback, useEffect, useRef, useState } from 'react';

/** What the browser records in, best first: Opus in WebM or Ogg, else AAC in MP4 (Safari). */
const TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];
/** Three minutes is plenty for one answer and stays near 0.5 MB at this bitrate. */
const MAX_MS = 3 * 60_000;
const BITRATE = 24_000;

export type RecorderState = 'idle' | 'recording' | 'unsupported' | 'denied' | 'failed';

export const recordingSupported = () =>
  typeof window !== 'undefined' &&
  typeof window.MediaRecorder !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia;

/**
 * One answer at a time with MediaRecorder: mono, low bitrate, stopped automatically at three
 * minutes (or at `maxMs`: voice Q&A stops at one, prompt 2, G7). Any failure (no support,
 * permission refused, device error) leaves the text box to answer with (E3: voice is optional,
 * text is complete).
 */
export function useRecorder(onDone: (audio: Blob) => void, maxMs = MAX_MS) {
  const [state, setState] = useState<RecorderState>(() => (recordingSupported() ? 'idle' : 'unsupported'));
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const timers = useRef<{ tick?: number; stop?: number }>({});
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  const cleanup = useCallback(() => {
    window.clearInterval(timers.current.tick);
    window.clearTimeout(timers.current.stop);
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (!recordingSupported()) return setState('unsupported');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      return setState(e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'failed');
    }
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: BITRATE });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      return setState('failed');
    }
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      const type = r.mimeType || mimeType || 'audio/webm';
      cleanup();
      setState('idle');
      if (chunks.length) done.current(new Blob(chunks, { type }));
    };
    r.onerror = () => {
      cleanup();
      setState('failed');
    };
    rec.current = r;
    r.start();
    const began = Date.now();
    setElapsed(0);
    setState('recording');
    timers.current.tick = window.setInterval(() => setElapsed(Date.now() - began), 500);
    timers.current.stop = window.setTimeout(() => r.state === 'recording' && r.stop(), maxMs);
  }, [cleanup, maxMs]);

  const stop = useCallback(() => {
    if (rec.current?.state === 'recording') rec.current.stop();
  }, []);

  return { state, elapsed, start, stop, maxMs };
}
