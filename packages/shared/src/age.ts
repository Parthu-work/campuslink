// No zod in this module: the sign-up screen and the API both use it.

/** How old a member must be to use the app without a guardian's consent (DPDP Act 2023 §9). */
export const ADULT_AGE = 18;
/** Birth months outside this range are mistakes (a college platform has no members under 13). */
export const MIN_AGE = 13;
export const MAX_AGE = 100;
export const BIRTH_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * The first day a member born in `birthMonth` ('YYYY-MM') is certainly 18: the first of the month
 * after their eighteenth birthday month (the day is unknown, so assume the latest one). Only this
 * date is stored, never the birth month.
 */
export function adultOnFromBirthMonth(birthMonth: string): Date {
  const m = BIRTH_MONTH.exec(birthMonth);
  if (!m) throw new Error('Birth month must be YYYY-MM');
  return new Date(Date.UTC(Number(m[1]) + ADULT_AGE, Number(m[2]), 1));
}

/** Whether a birth month is plausible on `now` (between MIN_AGE and MAX_AGE years ago). */
export function plausibleBirthMonth(birthMonth: string, now = new Date()): boolean {
  const m = BIRTH_MONTH.exec(birthMonth);
  if (!m) return false;
  const months = (now.getUTCFullYear() - Number(m[1])) * 12 + (now.getUTCMonth() + 1 - Number(m[2]));
  return months >= MIN_AGE * 12 && months <= MAX_AGE * 12;
}

/** A member with `adultOn` in the future is a minor; null means an adult (declared before B2). */
export const isMinor = (adultOn: Date | string | null | undefined, now = new Date()): boolean =>
  !!adultOn && new Date(adultOn).getTime() > now.getTime();
