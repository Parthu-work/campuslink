import { BLOCK_MINUTES, toMinutes, type TimeWindow } from '@campuslink/shared';
import { addDays, zonedParts, zonedToUtc } from '../../lib/timezone.js';

const BLOCK_MS = BLOCK_MINUTES * 60_000;

export interface AvailabilityRules {
  timezone: string;
  weekly: { day: number; windows: TimeWindow[] }[];
  exceptions: { date: string; windows: TimeWindow[] }[];
  minNoticeHours: number;
  horizonDays: number;
  bufferMin: number;
}

/** 15-minute block starts covering [start, end). */
export function blocksBetween(start: Date, end: Date): number[] {
  const out: number[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += BLOCK_MS) out.push(t);
  return out;
}

/** Holds a booking places: the mentor (plus buffer) and the mentee, block by block. */
export function holdsFor(
  mentorId: string,
  menteeId: string,
  start: Date,
  end: Date,
  bufferMin: number,
): string[] {
  const mentorEnd = new Date(end.getTime() + bufferMin * 60_000);
  return [
    ...blocksBetween(start, mentorEnd).map((t) => `${mentorId}|${new Date(t).toISOString()}`),
    ...blocksBetween(start, end).map((t) => `${menteeId}|${new Date(t).toISOString()}`),
  ];
}

/**
 * Free slot starts (UTC ISO) for a session of `durationMin`, from the mentor's weekly hours and
 * date exceptions in their own timezone. `busy` holds `<userId>|<block ISO>` strings for both people.
 */
export function computeSlots(opts: {
  rules: AvailabilityRules;
  durationMin: number;
  mentorId: string;
  menteeId: string;
  busy: Set<string>;
  from: Date;
  days: number;
  now?: Date;
}): string[] {
  const { rules, durationMin, busy } = opts;
  const now = opts.now ?? new Date();
  const earliest = Math.max(opts.from.getTime(), now.getTime() + rules.minNoticeHours * 3600_000);
  const latest = Math.min(
    opts.from.getTime() + opts.days * 86_400_000,
    now.getTime() + rules.horizonDays * 86_400_000,
  );
  if (latest <= earliest) return [];
  const step = durationMin >= 30 ? 30 : BLOCK_MINUTES;
  const firstDate = addDays(zonedParts(new Date(earliest), rules.timezone).date, -1);
  const exceptions = new Map(rules.exceptions.map((e) => [e.date, e.windows]));
  const weekly = new Map(rules.weekly.map((w) => [w.day, w.windows]));
  const out = new Set<string>();
  for (let i = 0; i <= opts.days + 2; i++) {
    const date = addDays(firstDate, i);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    const windows = exceptions.get(date) ?? weekly.get(day) ?? [];
    for (const w of windows) {
      const ws = toMinutes(w.start);
      const we = toMinutes(w.end);
      for (let m = ws; m + durationMin <= we; m += step) {
        const start = zonedToUtc(date, m, rules.timezone);
        if (!start) continue; // skipped by a daylight-saving jump
        const t = start.getTime();
        if (t < earliest || t >= latest) continue;
        const end = new Date(t + durationMin * 60_000);
        const free = holdsFor(opts.mentorId, opts.menteeId, start, end, rules.bufferMin).every(
          (h) => !busy.has(h),
        );
        if (free) out.add(start.toISOString());
      }
    }
  }
  return [...out].sort();
}
