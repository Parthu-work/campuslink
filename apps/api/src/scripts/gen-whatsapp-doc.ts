/** Writes docs/whatsapp-templates.md from the template map (the text Meta approves). */
import { writeFileSync } from 'node:fs';
import {
  WHATSAPP_TEMPLATES,
  INVITE_TEMPLATES,
  AUTO_REPLY,
  AUTH_TEMPLATE_SETTINGS,
  WA_LANGS,
} from '../modules/notifications/channels/whatsapp-templates.js';
const LANG = { en: 'English (en)', te: 'Telugu (te)', hi: 'Hindi (hi)' } as const;
let out = `# WhatsApp templates (Meta approval)

Every business-initiated WhatsApp message is an approved template. Register each one below in Meta Business Manager under the WhatsApp Business Account, in all three languages, with exactly this text (\`{{1}}\`, \`{{2}}\` … are Meta's body variables). The text is copied from \`apps/api/src/modules/notifications/channels/whatsapp-templates.ts\`; a test fails when they differ.

Variables carry only names, times, session types, company names and counts (and, in an invite, the personal link), never message or request text. Quick-reply buttons carry a signed, expiring token (\`WHATSAPP_ACTION_SECRET\`), set per message.

## Authentication template

Name: the value of \`WHATSAPP_AUTH_TEMPLATE\` (default \`auth_code\`). Category: **authentication**, with a copy-code button. The body is Meta's fixed text; set \`code_expiration_minutes: ${AUTH_TEMPLATE_SETTINGS.code_expiration_minutes}\` and \`add_security_recommendation: ${AUTH_TEMPLATE_SETTINGS.add_security_recommendation}\`. Register it in English, Telugu and Hindi.

`;
const entries = [
  ...Object.entries(WHATSAPP_TEMPLATES).map(([type, t]) => [`\`${type}\``, t] as const),
  ...Object.entries(INVITE_TEMPLATES).map(
    ([kind, t]) => [`an invite to a ${kind} on the college's list`, t] as const,
  ),
];
for (const [what, t] of entries) {
  if (!t) continue;
  out += `## \`${t.name}\`\n\nSent for: ${what}. Category: **${t.category}**.${t.critical ? ' Critical (exempt from the weekly cap).' : t.urgentable ? ' Critical only when the sender marks it urgent.' : ''}\n\n`;
  for (const l of WA_LANGS) {
    out += `- ${LANG[l]}: \`${t.text[l]}\`\n`;
    if (t.buttons?.length)
      out += `  - Quick replies: ${t.buttons.map((b) => `\`${b.label[l]}\``).join(', ')}\n`;
  }
  out += '\n';
}
out += `## Fixed auto-reply (free-form, inside the 24-hour window)\n\n`;
for (const l of WA_LANGS) out += `- ${LANG[l]}: \`${AUTO_REPLY[l]}\`\n`;
writeFileSync(new URL('../../../../docs/whatsapp-templates.md', import.meta.url), out);
console.warn('Wrote docs/whatsapp-templates.md');
