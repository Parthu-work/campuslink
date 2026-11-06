import { loadPack } from '../../i18n';
import { lazyPart } from '../../lib/lazy-part';

/**
 * Prompt 2, G9: the college picker on the bare domain, for the app shell. Its own module, so the
 * first load carries only this loader and not the other reach parts.
 */
const picker = () => Promise.all([import('./college-picker'), loadPack('reach')]).then(([m]) => m);
export const LazyCollegePicker = lazyPart(() => picker().then((m) => m.CollegePicker));
export const LazyPickerLink = lazyPart(() => picker().then((m) => m.PickerLink));
