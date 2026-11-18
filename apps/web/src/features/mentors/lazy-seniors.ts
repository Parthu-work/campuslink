import { loadPack } from '../../i18n';
import { lazyPart } from '../../lib/lazy-part';

/**
 * A career path's "Seniors on this path" (prompt 3, U6), with the `mentoring` pack: loaded only on a
 * path, for members who can ask for mentoring. A part: if it cannot load, the path stays.
 */
export const LazySeniorsOnPath = lazyPart(() =>
  Promise.all([import('./seniors-on-path'), loadPack('mentoring')]).then(([m]) => m.SeniorsOnPath),
);

/** A company page's "Seniors there who mentor" (prompt 3, U7), with the same pack. */
export const LazySeniorsAt = lazyPart(() =>
  Promise.all([import('./seniors-on-path'), loadPack('mentoring')]).then(([m]) => m.SeniorsAt),
);
