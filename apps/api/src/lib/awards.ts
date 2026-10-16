import type { Types } from 'mongoose';
import type { XpKind } from '@campuslink/shared';

/**
 * How other modules award points without depending on the gamification module. `from` is the
 * other member involved (e.g. the asker who accepted an answer); awards where `from` is the
 * recipient are ignored (no XP for self-created interactions). Never throws.
 */
export type Award = (
  userId: string | Types.ObjectId,
  kind: XpKind,
  refId: string,
  opts?: { from?: string | Types.ObjectId | null },
) => Promise<void>;
export const noAward: Award = () => Promise.resolve();
