import type { TFunction } from 'i18next';
import type { NotificationView } from '@campuslink/shared';
import { formatDateTime } from './format';

/** Localised text and in-app link for a notification (the API sends only type + ids + names). */
export function notificationText(t: TFunction, n: Pick<NotificationView, 'type' | 'data'>) {
  const d = n.data;
  const vars = {
    name: d.name ?? '',
    content: d.contentType ? t(`content.${d.contentType}`) : '',
    reason: d.reason ? t(`mod.reasons.${d.reason}`) : '',
    company: d.company ?? '',
    alert: d.alert ?? '',
    roadmap: d.roadmap ?? '',
    reward: d.reward ?? '',
    event: d.event ?? '',
    title: d.title ?? '',
    badge: d.badge ? t(`progress.badge.${d.badge}.name`) : '',
    decision: d.decision ? t(`notify.decision.${d.decision}`) : '',
    type: d.sessionType ? t(`session.type.${d.sessionType}`) : '',
    time: d.start ? formatDateTime(d.start) : '',
    percent: d.percent ?? '',
  };
  const href = (() => {
    switch (n.type) {
      // Requests open on the request itself, not just the inbox (audit IA-5).
      case 'request_received':
        return `/mentorship?box=received${d.requestId ? `&request=${d.requestId}` : ''}`;
      case 'request_declined':
      case 'request_expired':
        return `/mentorship?box=sent${d.requestId ? `&request=${d.requestId}` : ''}`;
      case 'request_accepted':
        return d.bookingId
          ? `/sessions?booking=${d.bookingId}`
          : d.conversationId
            ? `/messages/${d.conversationId}`
            : '/mentorship?box=sent';
      case 'new_message':
        return d.conversationId ? `/messages/${d.conversationId}` : '/messages';
      case 'feedback_received':
        return '/mentor';
      case 'post_comment':
      case 'comment_reply':
        return d.postId ? `/posts/${d.postId}` : '/home';
      case 'question_answered':
      case 'answer_accepted':
      case 'question_approved':
      case 'question_rejected':
        return d.questionId ? `/questions/${d.questionId}` : '/questions';
      case 'referral_received':
        return '/referrals';
      case 'referral_referred':
      case 'referral_declined':
      case 'referral_expired':
        return '/referrals?box=sent';
      case 'job_alert':
        return d.alertId ? `/jobs?alert=${d.alertId}` : '/jobs';
      case 'badge_earned':
        return '/progress';
      case 'redemption_decided':
        return '/rewards';
      case 'event_reminder':
      case 'event_updated':
      case 'event_cancelled':
      case 'event_promoted':
        return d.eventId ? `/events/${d.eventId}` : '/events';
      case 'roadmap_nudge':
      case 'roadmap_approved':
      case 'roadmap_changes_requested':
        return d.slug ? `/roadmaps/${d.slug}` : '/roadmaps';
      case 'content_removed':
      case 'content_restored':
      case 'appeal_decided':
        if (d.contentType === 'job') return `/jobs/${d.contentId ?? ''}`;
        if ((d.contentType === 'event' || d.contentType === 'event_question') && d.eventId)
          return `/events/${d.eventId}`;
        if (d.contentType === 'roadmap' || d.contentType === 'roadmap_comment')
          return d.slug ? `/roadmaps/${d.slug}` : '/roadmaps';
        return d.postId
          ? `/posts/${d.postId}`
          : d.questionId
            ? `/questions/${d.questionId}`
            : '/notifications';
      case 'material_ready':
      case 'material_failed':
      case 'material_reviewed':
        return d.subjectId && d.materialId ? `/study/${d.subjectId}/m/${d.materialId}` : '/study';
      case 'material_review':
        return d.subjectId ? `/study/${d.subjectId}?review=1` : '/study';
      case 'ai_key_invalid':
      case 'ai_budget_warning':
      case 'ai_budget_reached':
        return '/admin/ai';
      default:
        return '/sessions';
    }
  })();
  return { title: t(`notify.${n.type}.title`, vars), body: t(`notify.${n.type}.body`, vars), href };
}
