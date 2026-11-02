import { MIN_AGE, MAX_AGE } from '@campuslink/shared';

/** +919848022338 → +91 ••••• ••338, as the API shows numbers it sent codes to. */
export function maskPhone(phone: string): string {
  const cc = phone.startsWith('+91') ? '+91' : phone.slice(0, 3);
  return `${cc} ••••• ••${phone.slice(-3)}`;
}

/** Ten digits typed by the member → E.164 (+91 by default); anything else is left for the server to judge. */
export function toE164(input: string): string {
  const v = input.replace(/[\s()-]/g, '');
  if (/^[6-9]\d{9}$/.test(v)) return `+91${v}`;
  if (/^0[6-9]\d{9}$/.test(v)) return `+91${v.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(v)) return `+${v}`;
  return v;
}

/** Years a plausible member was born in, newest first (between MIN_AGE and MAX_AGE years ago). */
export function birthYears(now = new Date()): number[] {
  const y = now.getUTCFullYear();
  return Array.from({ length: MAX_AGE - MIN_AGE + 1 }, (_, i) => y - MIN_AGE - i);
}
