import { loadPack } from '../../i18n';
import { lazyPart } from '../../lib/lazy-part';

/**
 * Prompt 2, G9: the parts other screens show (the calendar card, the roster sync, single sign-on
 * buttons), each loaded with the `reach` pack. Parts, so a load that fails
 * offline leaves the screen as it is.
 */
const withReach = <M>(load: Promise<M>) => Promise.all([load, loadPack('reach')]).then(([m]) => m);

export const LazyCalendarFeed = lazyPart(() =>
  withReach(import('./calendar-feed')).then((m) => m.CalendarFeedCard),
);
export const LazyRosterSync = lazyPart(() =>
  withReach(import('./roster-sync')).then((m) => m.RosterSyncCard),
);
export const LazySyncOffer = lazyPart(() => withReach(import('./roster-sync')).then((m) => m.SyncOffer));
export const LazySsoButtons = lazyPart(() => withReach(import('./sso-buttons')).then((m) => m.SsoButtons));
