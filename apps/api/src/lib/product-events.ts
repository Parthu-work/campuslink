import type { Types } from 'mongoose';
import type { ProductEventName } from '@campuslink/shared';

/**
 * How modules record a product event (B9) without depending on the insights module, like
 * `award`: called after a confirmed write. `props` holds ids and enum values only; anything else
 * is dropped. Never throws.
 */
export type Track = (
  userId: string | Types.ObjectId,
  name: ProductEventName,
  props?: Record<string, string>,
) => Promise<void>;
export const noTrack: Track = () => Promise.resolve();
