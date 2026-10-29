import type { Count } from './analytics.js';
import type { AiStatusView } from './study.js';

/**
 * Admin › Overview: what is waiting for this member, with one tap into each queue. Each part is
 * present only when the member may act on it. Queue sizes are the member's own work lists (the
 * items themselves are visible to them), so they are exact; counts of members and activity are
 * analytics and go through `suppress()`.
 */
export interface AdminOverviewView {
  members: { active: Count; unverified: Count; suspended: Count } | null;
  activity: { last7: Count; last30: Count } | null;
  verification: { pending: number } | null;
  moderation: { reports: number; pendingQuestions: number; appeals: number; heldItems: number } | null;
  roadmapReviews: { pending: number } | null;
  materialReviews: { pending: number } | null;
  imports: { running: number; failedThisWeek: number } | null;
  ai: { status: AiStatusView; budgetPercent: number | null } | null;
  /** This month's WhatsApp messages against the allowance (B3); null when off or not permitted. */
  whatsapp?: { sent: number; allowance: number } | null;
  /** B6: students on the list who have not joined yet (onboarding:manage). */
  onboarding?: { notJoined: number } | null;
}
