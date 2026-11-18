import { describe, expect, it } from 'vitest';
import type { AdminOverviewView } from '@campuslink/shared';
import { todayItems } from './today-items';

const t = (key: string, o?: Record<string, unknown>) =>
  `${key}${o && 'count' in o ? `:${String(o.count)}` : ''}`;
const day = (iso: string) => iso.slice(0, 10);
const empty: AdminOverviewView = {
  members: null,
  activity: null,
  verification: { pending: 0, since: null },
  moderation: { reports: 0, pendingQuestions: 0, appeals: 0, heldItems: 0, since: null },
  roadmapReviews: { pending: 0, since: null },
  materialReviews: { pending: 0 },
  imports: { running: 0, failedThisWeek: 0 },
  ai: null,
  onboarding: { notJoined: 0 },
  placements: { closingSoon: 0, soonest: null, next: null },
  offers: { pending: 0, since: null },
  support: { open: 0 },
  queues: [],
};

describe('Today (prompt 3, U9)', () => {
  it('shows nothing at zero', () => {
    expect(todayItems(empty, t, day)).toEqual([]);
  });

  it('orders by urgency: closing drives, then offers, verification, moderation… and invites last', () => {
    const v: AdminOverviewView = {
      ...empty,
      onboarding: { notJoined: 12 },
      verification: { pending: 2, since: '2026-11-15T10:00:00.000Z' },
      offers: { pending: 3, since: '2026-11-16T10:00:00.000Z' },
      moderation: { reports: 1, pendingQuestions: 1, appeals: 0, heldItems: 0, since: null },
      placements: {
        closingSoon: 1,
        soonest: { id: 'd1', company: 'Nimbus Labs', title: 'SDE drive', at: '2026-11-19T15:00:00.000Z' },
        next: null,
      },
      queues: [{ id: 'practiceBank', pending: 4 }],
    };
    const items = todayItems(v, t, day);
    expect(items.map((i) => i.key)).toEqual([
      'drives',
      'offers',
      'verification',
      'moderation',
      'queue-practiceBank',
      'onboarding',
    ]);
    expect(items[0]).toMatchObject({ title: 'staff.today.drives:1', to: '/admin/placements/d1' });
    expect(items[1]).toMatchObject({
      title: 'staff.today.offers:3',
      meta: 'staff.today.since',
      to: '/admin/offers',
    });
    // Moderation counts every kind of flag together.
    expect(items[3]?.title).toBe('staff.today.moderation:2');
  });

  it('warns about the AI assistant and WhatsApp only near their limits', () => {
    const quiet: AdminOverviewView = {
      ...empty,
      ai: { status: { answers: true, semantic: true, reason: null, demo: false }, budgetPercent: 40 },
      whatsapp: { sent: 100, allowance: 1000 },
    };
    expect(todayItems(quiet, t, day)).toEqual([]);
    const loud: AdminOverviewView = {
      ...quiet,
      ai: { status: { answers: true, semantic: true, reason: null, demo: false }, budgetPercent: 85 },
      whatsapp: { sent: 850, allowance: 1000 },
    };
    expect(todayItems(loud, t, day).map((i) => i.key)).toEqual(['ai', 'whatsapp']);
  });
});
