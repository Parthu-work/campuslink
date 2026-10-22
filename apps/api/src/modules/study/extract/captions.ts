export interface Segment {
  start: number;
  end: number;
  text: string;
}

const TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const toSec = (t: string): number | null => {
  const m = TIME.exec(t);
  if (!m) return null;
  return (
    Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] ?? '0').padEnd(3, '0')) / 1000
  );
};

/**
 * WebVTT or SRT captions as plain, timed segments. Cue settings, voice and style tags are
 * dropped; overlapping duplicate cues (common in auto-captions) are merged.
 */
export function parseCaptions(raw: string): Segment[] {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const out: Segment[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a = '', b = ''] = (lines[at] ?? '').split('-->');
    const start = toSec(a);
    const end = toSec(b);
    if (start === null || end === null || end < start) continue;
    const body = lines
      .slice(at + 1)
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    if (!body) continue;
    const prev = out.at(-1);
    // Rolling auto-captions repeat (or extend) the previous cue over an overlapping time.
    if (
      prev &&
      ((prev.text === body && start <= prev.end + 0.5) || (body.startsWith(prev.text) && start < prev.end))
    ) {
      prev.text = body;
      prev.end = Math.max(prev.end, end);
    } else out.push({ start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10, text: body });
  }
  return out.slice(0, 20_000);
}

export const looksLikeCaptions = (raw: string) =>
  /^\uFEFF?WEBVTT/.test(raw) || /\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(raw);
