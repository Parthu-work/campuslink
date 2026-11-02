import type { TFunction } from '../i18n/core';
import type { OutcomeView } from '@campuslink/shared';

/** One line naming an outcome: "M.Tech CSE, IIT Demo", "GATE 2026", "Demo Robotics". */
export function outcomeTitle(t: TFunction, o: OutcomeView): string {
  if (o.kind === 'higher_study')
    return t('outcomes.hsTitle', { program: o.program, institution: o.institution });
  if (o.kind === 'exam')
    return t('outcomes.examTitle', {
      exam: o.exam === 'OTHER' ? o.examName : t(`outcomes.exam.${o.exam}`),
      year: o.year,
    });
  return o.name;
}

/** The second line: where, which level, registered or not. */
export function outcomeDetail(t: TFunction, o: OutcomeView): string {
  if (o.kind === 'higher_study')
    return [o.country, String(o.admitYear), o.qualifyingExam ? t(`outcomes.exam.${o.qualifyingExam}`) : '']
      .filter(Boolean)
      .join(' · ');
  if (o.kind === 'exam') return [t(`outcomes.level.${o.level}`), o.scoreBand].filter(Boolean).join(' · ');
  return [String(o.year), o.registered ? t('outcomes.registered') : t('outcomes.notRegistered')].join(' · ');
}

export const OUTCOME_TONE = { verified: 'success', reported: 'warning', rejected: 'danger' } as const;
