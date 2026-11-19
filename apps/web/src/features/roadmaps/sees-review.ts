import { useCan } from '../../lib/me';

/**
 * Whether this member sees a step's "needs review" flag (prompt 3, U12, audit A12): a note for the
 * people who write and review paths, not for the students following them.
 */
export function useSeesReview() {
  const canWrite = useCan('roadmaps:write');
  const canReview = useCan('roadmaps:review');
  return canWrite || canReview;
}
