import type { ReactNode } from 'react';
import { ADMIN_SECTIONS, type AdminOverviewView } from '@campuslink/shared';
import { formatNumber } from '../../lib/numbers';

export interface Item {
  key: string;
  title: string;
  meta?: ReactNode;
  action: string;
  to: string;
}

/**
 * The work waiting for this member, most urgent first (prompt 3, U9): one row per queue above zero,
 * with its age or deadline and one action that opens where it is done. Pure: the order is the
 * product decision, so it is unit-tested.
 */
export function todayItems(
  v: AdminOverviewView,
  t: (key: string, o?: Record<string, unknown>) => string,
  formatSince: (iso: string) => string,
): Item[] {
  const items: Item[] = [];
  const since = (iso: string | null | undefined) =>
    iso ? t('staff.today.since', { date: formatSince(iso) }) : undefined;
  const p = v.placements;
  if (p && p.closingSoon > 0)
    items.push({
      key: 'drives',
      title: t('staff.today.drives', { count: p.closingSoon }),
      meta: p.soonest
        ? t('staff.today.driveNamed', { company: p.soonest.company, title: p.soonest.title })
        : undefined,
      action: t('staff.today.action.open'),
      to: p.soonest ? `/admin/placements/${p.soonest.id}` : '/admin/placements',
    });
  if (v.offers && v.offers.pending > 0)
    items.push({
      key: 'offers',
      title: t('staff.today.offers', { count: v.offers.pending }),
      meta: since(v.offers.since),
      action: t('staff.today.action.verify'),
      to: '/admin/offers',
    });
  if (v.verification && v.verification.pending > 0)
    items.push({
      key: 'verification',
      title: t('staff.today.verification', { count: v.verification.pending }),
      meta: since(v.verification.since),
      action: t('staff.today.action.review'),
      to: '/admin/verification',
    });
  const m = v.moderation;
  const flagged = m ? m.reports + m.pendingQuestions + m.appeals + m.heldItems : 0;
  if (m && flagged > 0)
    items.push({
      key: 'moderation',
      title: t('staff.today.moderation', { count: flagged }),
      meta: since(m.since) ?? undefined,
      action: t('staff.today.action.review'),
      to: '/admin/moderation',
    });
  if (v.support && v.support.open > 0)
    items.push({
      key: 'support',
      title: t('staff.today.support', { count: v.support.open }),
      action: t('staff.today.action.answer'),
      to: '/admin/support',
    });
  if (v.roadmapReviews && v.roadmapReviews.pending > 0)
    items.push({
      key: 'roadmaps',
      title: t('staff.today.roadmaps', { count: v.roadmapReviews.pending }),
      meta: since(v.roadmapReviews.since),
      action: t('staff.today.action.review'),
      to: '/roadmaps/review',
    });
  if (v.materialReviews && v.materialReviews.pending > 0)
    items.push({
      key: 'material',
      title: t('staff.today.material', { count: v.materialReviews.pending }),
      action: t('staff.today.action.review'),
      to: '/study',
    });
  for (const q of v.queues ?? [])
    if (q.pending > 0)
      items.push({
        key: `queue-${q.id}`,
        title: t('staff.today.queue', { name: t(`admin.${q.id}`), count: q.pending }),
        action: t('staff.today.action.review'),
        to: ADMIN_SECTIONS.find((s) => s.id === q.id)?.path ?? '/admin',
      });
  if (v.onboarding && v.onboarding.notJoined > 0)
    items.push({
      key: 'onboarding',
      title: t('staff.today.notJoined', { count: v.onboarding.notJoined }),
      action: t('staff.today.action.invite'),
      to: '/admin/onboarding',
    });
  if (v.imports && v.imports.failedThisWeek > 0)
    items.push({
      key: 'imports',
      title: t('staff.today.imports', { count: v.imports.failedThisWeek }),
      action: t('staff.today.action.open'),
      to: '/admin/imports',
    });
  if (v.ai && (v.ai.status.reason === 'key_invalid' || (v.ai.budgetPercent ?? 0) >= 80))
    items.push({
      key: 'ai',
      title: t('staff.today.ai'),
      meta:
        v.ai.budgetPercent !== null && v.ai.budgetPercent >= 80
          ? t('admin.ov.aiBudget', { percent: v.ai.budgetPercent })
          : t(`ai.reason.${v.ai.status.reason ?? 'not_configured'}`),
      action: t('staff.today.action.open'),
      to: '/admin/ai',
    });
  if (v.whatsapp && v.whatsapp.allowance > 0 && v.whatsapp.sent >= v.whatsapp.allowance * 0.8)
    items.push({
      key: 'whatsapp',
      title: t('staff.today.whatsapp', {
        sent: formatNumber(v.whatsapp.sent),
        allowance: formatNumber(v.whatsapp.allowance),
      }),
      action: t('staff.today.action.open'),
      to: '/admin/features',
    });
  return items;
}
