import { useQuery } from '@tanstack/react-query';
import type { BookingView, DriveView, NextStepView } from '@campuslink/shared';
import { useCan } from '../../lib/me';
import { useNow } from '../../lib/use-now';
import * as q from '../../lib/queries';

const MIN = 60_000;
export const HOUR = 60 * MIN;
/** A session this close (or under way) is the most urgent thing on Home. */
export const SESSION_SOON_MS = 15 * MIN;
/** A drive closing this soon comes next. */
export const DRIVE_SOON_MS = 48 * HOUR;

export type TodayPick =
  | { kind: 'session'; booking: BookingView }
  | { kind: 'drive'; drive: DriveView }
  | { kind: 'step'; step: NextStepView }
  | null;

/** A drive the student can still register for (eligible, open, not registered). */
export const openToMe = (d: DriveView) => d.registrationOpen && d.eligible && !d.myRegistration;

/** The one most urgent thing (prompt 3, U5): a session within 15 minutes, a drive closing within 48 hours, else this week's step. */
export function pickToday(
  now: number,
  bookings: BookingView[] | undefined,
  drives: DriveView[] | undefined,
  step: NextStepView | null | undefined,
): TodayPick {
  const booking = bookings?.find(
    (b) =>
      b.status === 'scheduled' &&
      Date.parse(b.end) > now &&
      (Date.parse(b.start) - now <= SESSION_SOON_MS || now >= Date.parse(b.canJoinFrom)),
  );
  if (booking) return { kind: 'session', booking };
  const drive = drives
    ?.filter((d) => openToMe(d) && Date.parse(d.registrationCloseAt) - now <= DRIVE_SOON_MS)
    .sort((a, b) => Date.parse(a.registrationCloseAt) - Date.parse(b.registrationCloseAt))[0];
  if (drive) return { kind: 'drive', drive };
  if (step && (step.roadmapStep || step.opportunity || step.alumnus)) return { kind: 'step', step };
  return null;
}

/** The data the Today card reads, shared with Home's next steps (which leave its item out). */
export function useTodayPick(): TodayPick {
  const now = useNow();
  const canBook = useCan('sessions:book');
  const canDrives = useCan('placements:view');
  const canStep = useCan('nextstep:view');
  const bookings = useQuery({ ...q.upcomingBookings(), enabled: canBook });
  const drives = useQuery({ ...q.placementDrives('eligible'), enabled: canDrives });
  const step = useQuery({ ...q.nextStep(), enabled: canStep });
  return pickToday(now, bookings.data, drives.data, step.data);
}
