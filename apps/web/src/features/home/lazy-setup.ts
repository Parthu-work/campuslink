import type { QueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@campuslink/shared';
import { loadPack } from '../../i18n';
import { lazyPart } from '../../lib/lazy-part';
import { prefs } from '../../lib/storage';
import { followedRoadmaps, matchPreferences, sentRequests, whatsappStatus } from '../../lib/queries';

/**
 * Prompt 3, U4: Home's "Set up your CampusLink", loaded with the `firstRun` pack only for the
 * members who get it. A part: if its code cannot load (offline), Home stays and it comes later.
 */
export const LazySetupChecklist = lazyPart(() =>
  Promise.all([import('./setup-checklist'), loadPack('firstRun')]).then(([m]) => m.SetupChecklist),
);

/** A verified student (not an alumnus, who gets "Waiting for you") who has not hidden it on this device. */
export const setupWanted = (me: MeResponse) =>
  me.verified &&
  me.roles.includes('STUDENT') &&
  me.permissions.includes('mentorship:request') &&
  prefs.get(`setup-hidden:${me.id}`) !== '1';

/**
 * Home's route loader brings the checklist's code, strings and data with the page, so it paints
 * with Home instead of pushing the page down when it arrives. A widget: a failure never fails Home.
 */
export async function preloadSetupChecklist(qc: QueryClient, me: MeResponse) {
  if (!setupWanted(me)) return;
  await Promise.all([
    LazySetupChecklist.preload(),
    qc.ensureQueryData(matchPreferences()),
    qc.ensureQueryData(sentRequests()),
    qc.ensureQueryData(whatsappStatus()),
    me.permissions.includes('roadmaps:progress') ? qc.ensureQueryData(followedRoadmaps()) : null,
  ]);
}
