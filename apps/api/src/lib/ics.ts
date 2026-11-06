import { APP_NAME, icsEscape } from '@campuslink/shared';

/** RFC 5545 UTC date-time. */
export const icsDate = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** RFC 5545 line folding at 75 octets, never inside a character. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export interface IcsEvent {
  /** Stable across fetches, so calendars update an event instead of adding a copy. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string | undefined;
  location?: string | undefined;
  url?: string | undefined;
  cancelled?: boolean | undefined;
}

/** A whole calendar (a subscription feed or one event's file). */
export function icsCalendar(name: string, events: IcsEvent[], now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${icsEscape(APP_NAME)}//Calendar//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`,
    // Ask subscribing calendars to look again every hour (Google and Apple decide for themselves).
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end > e.start ? e.end : new Date(e.start.getTime() + 30 * 60_000))}`,
      `SUMMARY:${icsEscape(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
      ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
