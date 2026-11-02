/**
 * Who may register for a placement drive (build B7). A pure function, so the API decides and the
 * app explains with the same rule. Criteria are academic and cohort facts only: there is no
 * field for gender, caste, religion or any other protected attribute, and there must never be.
 */
export interface EligibilityCriteria {
  branches: readonly string[];
  gradYears: readonly number[];
  minCgpa?: number | null | undefined;
  maxActiveBacklogs?: number | null | undefined;
  maxHistoryBacklogs?: number | null | undefined;
  minTenthPct?: number | null | undefined;
  minTwelfthPct?: number | null | undefined;
}

export interface AcademicFacts {
  cgpa: number | null;
  activeBacklogs: number | null;
  historyBacklogs: number | null;
  tenthPct: number | null;
  twelfthPct: number | null;
  diplomaPct: number | null;
  /** Self-reported figures count only once the placement cell verified them. */
  source: 'import' | 'tpo' | 'self';
  verified: boolean;
}

export type EligibilityReason =
  | { kind: 'branch'; have: string | null; need: readonly string[] }
  | { kind: 'gradYear'; have: number | null; need: readonly number[] }
  | { kind: 'cgpa'; have: number | null; need: number }
  | { kind: 'activeBacklogs'; have: number | null; need: number }
  | { kind: 'historyBacklogs'; have: number | null; need: number }
  | { kind: 'tenthPct'; have: number | null; need: number }
  | { kind: 'twelfthPct'; have: number | null; need: number }
  /** The drive has academic criteria and the college has no (verified) record for the student. */
  | { kind: 'noRecord' }
  | { kind: 'unverifiedRecord' };

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
}

const hasAcademicCriteria = (c: EligibilityCriteria) =>
  [c.minCgpa, c.maxActiveBacklogs, c.maxHistoryBacklogs, c.minTenthPct, c.minTwelfthPct].some(
    (v) => v !== null && v !== undefined,
  );

/**
 * Every unmet criterion is listed (not just the first), so a student sees all of what stands in
 * the way. A diploma percentage stands in for the twelfth (lateral entry), as colleges accept it.
 */
export function checkEligibility(
  criteria: EligibilityCriteria,
  record: AcademicFacts | null,
  profile: { branch: string | null; gradYear: number | null },
): EligibilityResult {
  const reasons: EligibilityReason[] = [];
  if (criteria.branches.length && (!profile.branch || !criteria.branches.includes(profile.branch)))
    reasons.push({ kind: 'branch', have: profile.branch, need: criteria.branches });
  if (criteria.gradYears.length && (!profile.gradYear || !criteria.gradYears.includes(profile.gradYear)))
    reasons.push({ kind: 'gradYear', have: profile.gradYear, need: criteria.gradYears });
  if (hasAcademicCriteria(criteria)) {
    if (!record) reasons.push({ kind: 'noRecord' });
    else if (record.source === 'self' && !record.verified) reasons.push({ kind: 'unverifiedRecord' });
    else {
      const min = (kind: 'cgpa' | 'tenthPct' | 'twelfthPct', have: number | null, need?: number | null) => {
        if (need !== null && need !== undefined && (have === null || have < need))
          reasons.push({ kind, have, need });
      };
      const max = (kind: 'activeBacklogs' | 'historyBacklogs', have: number | null, need?: number | null) => {
        if (need !== null && need !== undefined && (have === null || have > need))
          reasons.push({ kind, have, need });
      };
      min('cgpa', record.cgpa, criteria.minCgpa);
      max('activeBacklogs', record.activeBacklogs, criteria.maxActiveBacklogs);
      max('historyBacklogs', record.historyBacklogs, criteria.maxHistoryBacklogs);
      min('tenthPct', record.tenthPct, criteria.minTenthPct);
      min('twelfthPct', record.twelfthPct ?? record.diplomaPct, criteria.minTwelfthPct);
    }
  }
  return { eligible: reasons.length === 0, reasons };
}
