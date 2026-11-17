import { describe, expect, it } from 'vitest';
import type { BookingView, DriveView, NextStepView } from '@campuslink/shared';
import { pickToday } from './today-pick';

const NOW = Date.parse('2026-11-18T10:00:00Z');
const MIN = 60_000;
const at = (min: number) => new Date(NOW + min * MIN).toISOString();

const booking = (startMin: number, over: Partial<BookingView> = {}): BookingView =>
  ({
    id: `b${startMin}`,
    status: 'scheduled',
    sessionType: 'mock_interview',
    start: at(startMin),
    end: at(startMin + 45),
    canJoinFrom: at(startMin - 10),
    canJoinUntil: at(startMin + 45),
    ...over,
  }) as BookingView;

const drive = (closeMin: number, over: Partial<DriveView> = {}): DriveView =>
  ({
    id: `d${closeMin}`,
    registrationCloseAt: at(closeMin),
    registrationOpen: true,
    eligible: true,
    myRegistration: null,
    ...over,
  }) as DriveView;

const step = {
  roadmapStep: { roadmapId: 'r', slug: 'sde', roadmap: 'SDE', nodeId: 'n', title: 'Arrays' },
  opportunity: null,
  alumnus: null,
  readiness: null,
} as unknown as NextStepView;

describe('the Today card (prompt 3, U5)', () => {
  it('puts a session within 15 minutes first, also one under way', () => {
    expect(pickToday(NOW, [booking(12)], [drive(60)], step)?.kind).toBe('session');
    expect(pickToday(NOW, [booking(-20)], [], step)?.kind).toBe('session');
  });

  it('ignores a later session, a finished one and a cancelled one', () => {
    expect(pickToday(NOW, [booking(16)], [], step)?.kind).toBe('step');
    expect(pickToday(NOW, [booking(-60)], [], step)?.kind).toBe('step');
    expect(pickToday(NOW, [booking(5, { status: 'cancelled' })], [], step)?.kind).toBe('step');
  });

  it('then the soonest drive closing within 48 hours that the student can still register for', () => {
    const pick = pickToday(NOW, [], [drive(47 * 60, { id: 'later' }), drive(90, { id: 'sooner' })], step);
    expect(pick).toMatchObject({ kind: 'drive', drive: { id: 'sooner' } });
    expect(pickToday(NOW, [], [drive(49 * 60)], step)?.kind).toBe('step');
    expect(pickToday(NOW, [], [drive(60, { eligible: false })], step)?.kind).toBe('step');
    expect(
      pickToday(NOW, [], [drive(60, { myRegistration: {} as DriveView['myRegistration'] })], step)?.kind,
    ).toBe('step');
  });

  it('else this week’s step, and nothing when there is nothing', () => {
    expect(pickToday(NOW, [], [], step)?.kind).toBe('step');
    expect(pickToday(NOW, [], [], null)).toBeNull();
    expect(pickToday(NOW, undefined, undefined, undefined)).toBeNull();
  });
});
