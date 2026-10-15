import type { TFunction } from 'i18next';
import type { NotificationView } from '@campuslink/shared';
import { formatDateTime } from './format';

/** Localised text and in-app link for a notification (the API sends only type + ids + names). */
export function notificationText(t: TFunction, n: Pick<NotificationView, 'type' | 'data'>) {
  const d = n.data;
  const vars = {
    name: d.name ?? '',
    type: d.sessionType ? t(`session.type.${d.sessionType}`) : '',
    time: d.start ? formatDateTime(d.start) : '',
  };
  const href = (() => {
    switch (n.type) {
      case 'request_received':
        return '/mentorship?box=received';
      case 'request_declined':
      case 'request_expired':
        return '/mentorship?box=sent';
      case 'request_accepted':
        return d.bookingId
          ? '/sessions'
          : d.conversationId
            ? `/messages/${d.conversationId}`
            : '/mentorship?box=sent';
      case 'new_message':
        return d.conversationId ? `/messages/${d.conversationId}` : '/messages';
      case 'feedback_received':
        return '/mentor';
      default:
        return '/sessions';
    }
  })();
  return { title: t(`notify.${n.type}.title`, vars), body: t(`notify.${n.type}.body`, vars), href };
}
