import { loadPack } from '../../i18n';
import { lazyPart } from '../../lib/lazy-part';

/**
 * A career path's "Drives for this role" (prompt 3, U7), with the `drives` pack: loaded only on a
 * path, for members who can see placements. A part: if it cannot load, the path stays.
 */
export const LazyDrivesOnPath = lazyPart(() =>
  Promise.all([import('./drives-on-path'), loadPack('drives')]).then(([m]) => m.DrivesOnPath),
);
