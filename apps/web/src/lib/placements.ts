import type { TFunction } from '../i18n/core';
import type { DriveRoleView, DriveView, EligibilityReason } from '@campuslink/shared';
import { perLocale } from './format';

const lpaFormat = perLocale((l) => new Intl.NumberFormat(l, { maximumFractionDigits: 2 }));
const lpa = (n: number) => lpaFormat().format(n);

/** "₹4.5–6 LPA", "₹6 LPA", or nothing when the drive gives no figure. */
export function ctcRange(t: TFunction, r: Pick<DriveRoleView, 'ctcMinLpa' | 'ctcMaxLpa'>): string {
  const { ctcMinLpa: min, ctcMaxLpa: max } = r;
  if (min === null && max === null) return '';
  const range =
    min !== null && max !== null && min !== max ? `${lpa(min)}–${lpa(max)}` : lpa((max ?? min) as number);
  return t('placements.lpa', { range });
}

/** One exact figure, for the member's own offers and the placement cell. */
export const ctcExact = (t: TFunction, n: number) => t('placements.lpa', { range: lpa(n) });

/** Why a student cannot register, in words (every unmet rule, as the API lists them). */
export function reasonText(t: TFunction, r: EligibilityReason): string {
  switch (r.kind) {
    case 'branch':
      return t('placements.reason.branch', { need: r.need.join(', ') });
    case 'gradYear':
      return t('placements.reason.gradYear', { need: r.need.join(', ') });
    case 'cgpa':
      return r.have === null
        ? t('placements.reason.cgpaMissing', { need: r.need })
        : t('placements.reason.cgpa', { need: r.need, have: r.have });
    case 'activeBacklogs':
      return t('placements.reason.activeBacklogs', { count: r.need, have: r.have ?? '—' });
    case 'historyBacklogs':
      return t('placements.reason.historyBacklogs', { count: r.need, have: r.have ?? '—' });
    case 'tenthPct':
      return t('placements.reason.tenthPct', { need: r.need, have: r.have ?? '—' });
    case 'twelfthPct':
      return t('placements.reason.twelfthPct', { need: r.need, have: r.have ?? '—' });
    case 'noRecord':
      return t('placements.reason.noRecord');
    case 'unverifiedRecord':
      return t('placements.reason.unverifiedRecord');
  }
}

/** The drive's top line of pay across its roles ("₹4–12 LPA"). */
export function driveCtc(t: TFunction, d: Pick<DriveView, 'roles'>): string {
  const lows = d.roles.flatMap((r) => r.ctcMinLpa ?? r.ctcMaxLpa ?? []);
  const highs = d.roles.flatMap((r) => r.ctcMaxLpa ?? r.ctcMinLpa ?? []);
  if (!lows.length) return '';
  return ctcRange(t, { ctcMinLpa: Math.min(...lows), ctcMaxLpa: Math.max(...highs) });
}

/** A registration that still counts (not withdrawn). */
export const isRegistered = (d: Pick<DriveView, 'myRegistration'>) =>
  !!d.myRegistration && d.myRegistration.status !== 'withdrawn';

/** Registration closes within two days. */
export const closesSoon = (d: Pick<DriveView, 'registrationCloseAt' | 'registrationOpen'>) =>
  d.registrationOpen && new Date(d.registrationCloseAt).getTime() - Date.now() < 48 * 3600_000;

/** Keys of every cached query that holds drive views. */
export const DRIVE_KEYS = [['placement-drives'], ['placement-drive'], ['admin-drives']] as const;
