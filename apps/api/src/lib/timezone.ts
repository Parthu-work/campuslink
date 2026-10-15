/**
 * Timezone arithmetic with the built-in Intl API (no library). Availability is defined in the
 * mentor's IANA timezone; everything stored is UTC.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  /** YYYY-MM-DD in the zone. */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** 0 = Sunday. */
  weekday: number;
}

function rawParts(at: Date, tz: string) {
  const p = Object.fromEntries(
    formatter(tz)
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour) % 24,
    mi: Number(p.minute),
    s: Number(p.second),
  };
}

export function zonedParts(at: Date, tz: string): ZonedParts {
  const p = rawParts(at, tz);
  const date = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  return { date, minutes: p.h * 60 + p.mi, weekday: weekdayOf(date) };
}

/** Offset of the zone from UTC at an instant, in minutes (IST = +330). */
export function offsetMinutes(at: Date, tz: string): number {
  const p = rawParts(at, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The UTC instant of a local wall-clock time. Returns null for times that do not exist in the zone
 * (the hour skipped when daylight saving starts).
 */
export function zonedToUtc(date: string, minutes: number, tz: string): Date | null {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let t = guess - offsetMinutes(new Date(guess), tz) * 60_000;
  const second = guess - offsetMinutes(new Date(t), tz) * 60_000;
  if (second !== t) t = second;
  const back = zonedParts(new Date(t), tz);
  // A minute count of 1440 means the next day's midnight.
  const expectDate = minutes >= 1440 ? addDays(date, Math.floor(minutes / 1440)) : date;
  if (back.date !== expectDate || back.minutes !== minutes % 1440) return null;
  return new Date(t);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
