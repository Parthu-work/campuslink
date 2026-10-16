import { z } from 'zod';
import { objectId } from './common.js';
import type { PersonRef } from './mentorship.js';

// ── Messaging ─────────────────────────────
export const MESSAGE_MAX = 2000;
export const messageBody = z.strictObject({
  body: z.string().trim().min(1, 'Write a message').max(MESSAGE_MAX),
});
/** Multipart text field next to an attachment (may be empty). */
export const attachmentFields = z.strictObject({ body: z.string().trim().max(MESSAGE_MAX).default('') });
export const messagesQuery = z.strictObject({
  /** Older than this message id. */
  before: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export const readBody = z.strictObject({ messageId: objectId });
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export interface AttachmentView {
  fileId: string;
  name: string;
  mime: string;
  size: number;
}
export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  attachment: AttachmentView | null;
  createdAt: string;
}
export interface ConversationView {
  id: string;
  other: PersonRef;
  status: 'open' | 'blocked';
  lastMessageAt: string | null;
  unread: number;
  /** When the other person last read up to (read receipts). */
  otherReadAt: string | null;
}

/** Socket events: server → client. Payloads never include another tenant's ids. */
export interface ServerEvents {
  'message:new': (m: MessageView) => void;
  'message:read': (r: { conversationId: string; userId: string; readAt: string }) => void;
  typing: (t: { conversationId: string; userId: string }) => void;
  'notification:new': (n: NotificationView) => void;
}
/** Socket events: client → server (validated with the schemas below). */
export interface ClientEvents {
  typing: (t: { conversationId: string }) => void;
}
export const typingEvent = z.strictObject({ conversationId: objectId });
export const REALTIME_PATH = '/api/v1/realtime';

// ── Notifications ─────────────────────────────
export const NOTIFICATION_TYPES = [
  'request_received',
  'request_accepted',
  'request_declined',
  'request_expired',
  'booking_rescheduled',
  'booking_cancelled',
  'booking_reminder',
  'session_completed',
  'feedback_received',
  'new_message',
  'post_comment',
  'comment_reply',
  'question_answered',
  'answer_accepted',
  'question_approved',
  'question_rejected',
  'content_removed',
  'content_restored',
  'appeal_decided',
  'referral_received',
  'referral_referred',
  'referral_declined',
  'referral_expired',
  'job_alert',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NOTIFICATION_CATEGORIES = [
  'requests',
  'sessions',
  'reminders',
  'messages',
  'community',
  'moderation',
  'jobs',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const CATEGORY_OF: Record<NotificationType, NotificationCategory> = {
  request_received: 'requests',
  request_accepted: 'requests',
  request_declined: 'requests',
  request_expired: 'requests',
  booking_rescheduled: 'sessions',
  booking_cancelled: 'sessions',
  session_completed: 'sessions',
  feedback_received: 'sessions',
  booking_reminder: 'reminders',
  new_message: 'messages',
  post_comment: 'community',
  comment_reply: 'community',
  question_answered: 'community',
  answer_accepted: 'community',
  question_approved: 'community',
  question_rejected: 'community',
  content_removed: 'moderation',
  content_restored: 'moderation',
  appeal_decided: 'moderation',
  referral_received: 'jobs',
  referral_referred: 'jobs',
  referral_declined: 'jobs',
  referral_expired: 'jobs',
  job_alert: 'jobs',
};
export const CHANNELS = ['inApp', 'email', 'push'] as const;
export type Channel = (typeof CHANNELS)[number];
export type ChannelPrefs = Record<Channel, boolean>;
export const DEFAULT_CHANNELS: Record<NotificationCategory, ChannelPrefs> = {
  requests: { inApp: true, email: true, push: true },
  sessions: { inApp: true, email: true, push: true },
  reminders: { inApp: true, email: true, push: true },
  // One email per conversation at most every 30 minutes, and only while you are offline.
  messages: { inApp: true, email: false, push: true },
  community: { inApp: true, email: false, push: true },
  // Decisions about your content always reach you by email too (moderation transparency).
  moderation: { inApp: true, email: true, push: false },
  // Referral replies and daily job-alert matches.
  jobs: { inApp: true, email: true, push: true },
};

const channelPrefs = z.strictObject({ inApp: z.boolean(), email: z.boolean(), push: z.boolean() });
export const notificationPrefsBody = z.strictObject({
  channels: z.strictObject({
    requests: channelPrefs,
    sessions: channelPrefs,
    reminders: channelPrefs,
    messages: channelPrefs,
    community: channelPrefs,
    moderation: channelPrefs,
    jobs: channelPrefs,
  }),
  quietHours: z.strictObject({
    enabled: z.boolean(),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().min(1).max(64),
  }),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsBody>;

/** Browser push services we deliver to (the subscription endpoint must be on one of them). */
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  '.notify.windows.com',
] as const;
export const isPushServiceHost = (host: string) =>
  PUSH_SERVICE_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
const b64url = (max: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+={0,2}$/)
    .min(8)
    .max(max);
export const pushSubscriptionBody = z.strictObject({
  endpoint: z
    .url({ protocol: /^https$/ })
    .max(1000)
    .refine(
      (u) => isPushServiceHost(/^https:\/\/([^/:?#]+)/i.exec(u)?.[1]?.toLowerCase() ?? ''),
      'Unsupported push service',
    ),
  keys: z.strictObject({ p256dh: b64url(200), auth: b64url(64) }),
});
export const pushUnsubscribeBody = z.strictObject({ endpoint: z.url().max(1000) });

export interface NotificationView {
  id: string;
  type: NotificationType;
  /** Non-personal references and display names only (rendered with i18n on the client). */
  data: Record<string, string>;
  readAt: string | null;
  createdAt: string;
}
export const notificationsQuery = z.strictObject({
  cursor: objectId.optional(),
  unread: z.enum(['true', 'false']).optional(),
});

// ── Safety ─────────────────────────────
export const blockBody = z.strictObject({ userId: objectId });
export const REPORT_TARGETS = [
  'user',
  'message',
  'request',
  'post',
  'comment',
  'question',
  'answer',
  'story',
  'job',
  'referral',
] as const;
export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'impersonation', 'other'] as const;
export const reportBody = z.strictObject({
  targetType: z.enum(REPORT_TARGETS),
  targetId: objectId,
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(500).optional(),
});
export const reportsQuery = z.strictObject({
  status: z.enum(['open', 'resolved']).default('open'),
  cursor: objectId.optional(),
});
export const resolveReportBody = z.strictObject({
  outcome: z.enum(['actioned', 'dismissed']),
  note: z.string().trim().max(500).optional(),
});
