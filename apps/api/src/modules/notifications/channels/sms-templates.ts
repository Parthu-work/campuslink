import { APP_NAME } from '@campuslink/shared';

/**
 * Every SMS the platform sends (India's DLT rules: only registered templates are delivered, and a
 * text that differs from the registration by one character is dropped silently by the carrier).
 * The text here is copied character for character into docs/sms-templates.md for registration;
 * `{#var#}` is DLT's placeholder. The registered template ids come from SMS_DLT_TEMPLATE_IDS
 * (`otp=1107…,reminder=1107…`). A test keeps the doc and this file identical.
 */
export const SMS_TEMPLATES = {
  /** Service (implicit) category: one-time codes. */
  otp: {
    category: 'service_implicit',
    text: `{#var#} is your ${APP_NAME} code. It expires in 10 minutes. Never share it with anyone.`,
  },
} as const;
export type SmsTemplateKey = keyof typeof SMS_TEMPLATES;

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
