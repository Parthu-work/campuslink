import type { Types } from 'mongoose';
import type { AuthState } from '../types.js';

/**
 * How the feed, Q&A and events keep a circle's content to its members (prompt 2, G7). The app
 * sets it from `CirclesService`; posts, questions and events carry a `circleId` (null outside
 * any circle).
 */
export interface CircleScope {
  /** A filter: outside any circle, or in one of the viewer's circles. */
  condition(viewer: AuthState): Promise<Record<string, unknown>>;
  /** The viewer may read this circle's content: a member of the active circle, or staff who manage circles. */
  canSee(viewer: AuthState, circleId: Types.ObjectId | string | null | undefined): Promise<boolean>;
  /** Only members post, ask or hold events in a circle: the id to store (null outside circles). */
  assertCanPost(viewer: AuthState, circleId: string | null | undefined): Promise<Types.ObjectId | null>;
  /** Circle names for views. */
  names(ids: (Types.ObjectId | string)[]): Promise<Map<string, string>>;
}

/** Until the app wires circles: content outside circles only, and nothing can be put in one. */
export const noCircles: CircleScope = {
  condition: () => Promise.resolve({ circleId: null }),
  canSee: (_viewer, circleId) => Promise.resolve(!circleId),
  assertCanPost: (_viewer, circleId) =>
    circleId ? Promise.reject(new Error('Circles are not available')) : Promise.resolve(null),
  names: () => Promise.resolve(new Map()),
};
