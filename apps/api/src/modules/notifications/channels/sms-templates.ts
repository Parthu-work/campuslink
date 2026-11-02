import { APP_NAME, type NotificationType } from '@campuslink/shared';

/**
 * Every SMS the platform sends (India's DLT rules: only registered templates are delivered, and a
 * text that differs from the registration by one character is dropped silently by the carrier).
 * The text here is copied character for character into docs/sms-templates.md for registration;
 * `{#var#}` is DLT's placeholder. The registered template ids come from SMS_DLT_TEMPLATE_IDS
 * (`otp=1107…,session_reminder=1107…`). A test keeps the doc and this file identical.
 */
export const SMS_TEMPLATES = {
  /** Service (implicit) category: one-time codes. */
  otp: {
    category: 'service_implicit',
    text: `{#var#} is your ${APP_NAME} code. It expires in 10 minutes. Never share it with anyone.`,
  },
  /**
   * The same code in Hindi (B12; a Unicode SMS, registered as its own template). Sent only to
   * members who use Hindi and only once its id is in SMS_DLT_TEMPLATE_IDS; English until then.
   */
  otp_hi: {
    category: 'service_implicit',
    text: `{#var#} आपका ${APP_NAME} कोड है। यह 10 मिनट में समाप्त हो जाएगा। इसे किसी के साथ साझा न करें।`,
  },
  /**
   * Critical reminders (prompt 1b, R4), service-explicit category: the member's first name, a time
   * and a link to the app, never message text. Sent only when WhatsApp cannot reach the member.
   * The Telugu and Hindi versions are Unicode templates of their own, used once their ids are set.
   */
  session_reminder: {
    category: 'service_explicit',
    text: `{#var#}, your ${APP_NAME} session starts at {#var#}. Open {#var#} to join.`,
  },
  session_reminder_te: {
    category: 'service_explicit',
    text: `{#var#}, మీ ${APP_NAME} సెషన్ {#var#}కి మొదలవుతుంది. చేరడానికి {#var#} తెరవండి.`,
  },
  session_reminder_hi: {
    category: 'service_explicit',
    text: `{#var#}, आपका ${APP_NAME} सत्र {#var#} बजे शुरू होगा। जुड़ने के लिए {#var#} खोलें।`,
  },
  drive_reminder: {
    category: 'service_explicit',
    text: `{#var#}, registration for a placement drive on ${APP_NAME} closes at {#var#}. Register at {#var#}`,
  },
  drive_reminder_te: {
    category: 'service_explicit',
    text: `{#var#}, ${APP_NAME}లో ఒక ప్లేస్‌మెంట్ డ్రైవ్ నమోదు {#var#}కి ముగుస్తుంది. {#var#}లో నమోదు చేయండి.`,
  },
  drive_reminder_hi: {
    category: 'service_explicit',
    text: `{#var#}, ${APP_NAME} पर एक प्लेसमेंट ड्राइव का पंजीकरण {#var#} को बंद होगा। {#var#} पर पंजीकरण करें।`,
  },
} as const;
export type SmsTemplateKey = keyof typeof SMS_TEMPLATES;

/** The reminder templates by base key (English); a language's own is `<key>_<lang>`. */
export type SmsReminderKey = 'session_reminder' | 'drive_reminder';

/**
 * The SMS reminder a notification may use, or null. Only two critical moments ever go by SMS: a
 * session starting within the hour, and a drive whose registration is about to close.
 */
export function smsReminderKey(type: NotificationType, data: Record<string, string>): SmsReminderKey | null {
  if (type === 'booking_reminder') return data.when === '1h' ? 'session_reminder' : null;
  if (type === 'drive_reminder') return 'drive_reminder';
  return null;
}

/** Parses `otp=1107161234567890123,reminder=…` into template ids (unknown keys are refused). */
export function parseDltTemplateIds(raw: string | undefined): Partial<Record<SmsTemplateKey, string>> {
  const out: Partial<Record<SmsTemplateKey, string>> = {};
  for (const pair of (raw ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const [key, id] = pair.split('=').map((x) => x.trim());
    if (!key || !id || !(key in SMS_TEMPLATES))
      throw new Error(`Unknown SMS template in SMS_DLT_TEMPLATE_IDS: ${pair}`);
    out[key as SmsTemplateKey] = id;
  }
  return out;
}
