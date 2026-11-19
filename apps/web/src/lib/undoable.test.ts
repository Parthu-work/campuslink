import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const undoCalls: { message: string; onUndo: () => void; id: string | undefined }[] = [];
const dismissed: string[] = [];
vi.mock('./toast', () => ({
  UNDO_MS: 6000,
  toast: {
    undo: (message: string, _label: string, onUndo: () => void, id?: string) =>
      undoCalls.push({ message, onUndo, id }),
    dismiss: (id: string) => dismissed.push(id),
  },
}));

const { sendAfterUndo, sendWaiting } = await import('./undoable');

describe('answers that wait for Undo (prompt 3, U10)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    undoCalls.length = 0;
    dismissed.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  const answer = (key = 'request:1') => {
    const send = vi.fn();
    const undo = vi.fn();
    sendAfterUndo({ key, message: 'You accepted Ananya.', undoLabel: 'Undo', send, undo });
    return { send, undo };
  };

  it('sends after 6 s, once, and never if Undo came first', () => {
    const a = answer();
    vi.advanceTimersByTime(5999);
    expect(a.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(a.send).toHaveBeenCalledTimes(1);
    undoCalls[0]?.onUndo(); // too late: already sent
    expect(a.undo).not.toHaveBeenCalled();

    const b = answer('request:2');
    undoCalls[1]?.onUndo();
    vi.advanceTimersByTime(10_000);
    expect(b.undo).toHaveBeenCalledTimes(1);
    expect(b.send).not.toHaveBeenCalled();
  });

  it('a hidden or closing page sends what is waiting at once and closes its toast', () => {
    const a = answer();
    sendWaiting();
    expect(a.send).toHaveBeenCalledTimes(1);
    expect(dismissed).toEqual(['undo-request:1']);
    vi.advanceTimersByTime(10_000);
    expect(a.send).toHaveBeenCalledTimes(1);
    undoCalls[0]?.onUndo();
    expect(a.undo).not.toHaveBeenCalled();
  });

  it('a second answer to the same thing sends the first now', () => {
    const first = answer();
    const second = answer();
    expect(first.send).toHaveBeenCalledTimes(1);
    expect(second.send).not.toHaveBeenCalled();
    expect(undoCalls.map((c) => c.id)).toEqual(['undo-request:1', 'undo-request:1']);
  });
});
