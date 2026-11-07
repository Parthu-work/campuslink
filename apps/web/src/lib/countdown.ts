import { perLocale } from './format';

const rtf = perLocale((l) => new Intl.RelativeTimeFormat(l, { numeric: 'auto' }));

export interface CountdownState {
  /** Not yet, under way (between start and end), or over. */
  phase: 'before' | 'during' | 'after';
  /** "in 3 minutes", "in 2 days" in the member's language (only before). */
  when: string;
  /** Within the urgency window (default: a day). */
  urgent: boolean;
}

/**
 * What a Countdown chip says (ADR 0015): the coarsest unit that still reads truthfully ("in 2 days",
 * "in 5 hours", "in 3 minutes"), rounded down so "in 1 hour" never means 1 h 50 min early.
 */
export function countdown(
  at: Date | string,
  {
    now = Date.now(),
    endsAt,
    urgentWithinMs = 86_400_000,
  }: { now?: number; endsAt?: Date | string; urgentWithinMs?: number } = {},
): CountdownState {
  const start = new Date(at).getTime();
  const end = endsAt ? new Date(endsAt).getTime() : start;
  if (now >= end && now >= start) return { phase: 'after', when: '', urgent: false };
  if (now >= start) return { phase: 'during', when: '', urgent: true };
  const s = (start - now) / 1000;
  const f = rtf();
  const when =
    s < 60
      ? f.format(1, 'minute')
      : s < 3600
        ? f.format(Math.floor(s / 60), 'minute')
        : s < 86_400
          ? f.format(Math.floor(s / 3600), 'hour')
          : f.format(Math.floor(s / 86_400), 'day');
  return { phase: 'before', when, urgent: start - now <= urgentWithinMs };
}
