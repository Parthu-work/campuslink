import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SMS_TEMPLATES, parseDltTemplateIds } from '../src/modules/notifications/channels/sms-templates.js';
import {
  AUTO_REPLY,
  WA_LANGS,
  WHATSAPP_TEMPLATES,
} from '../src/modules/notifications/channels/whatsapp-templates.js';
import { CATEGORY_OF } from '@campuslink/shared';

const doc = readFileSync(new URL('../../../docs/sms-templates.md', import.meta.url), 'utf8');

describe('SMS templates (DLT)', () => {
  it('docs/sms-templates.md lists every template character for character', () => {
    for (const [key, t] of Object.entries(SMS_TEMPLATES)) {
      const row = doc.split('\n').find((l) => l.startsWith(`| \`${key}\``));
      expect(row, key).toBeDefined();
      expect(row).toContain(`| ${t.category}`);
      expect(row).toContain(`\`${t.text}\``);
    }
  });

  it('reads registered ids and refuses unknown templates', () => {
    expect(parseDltTemplateIds('otp=1107161234567890123')).toEqual({ otp: '1107161234567890123' });
    expect(parseDltTemplateIds(undefined)).toEqual({});
    expect(() => parseDltTemplateIds('nope=1')).toThrow(/Unknown SMS template/);
  });
});

describe('WhatsApp templates (Meta approval)', () => {
  const wa = readFileSync(new URL('../../../docs/whatsapp-templates.md', import.meta.url), 'utf8');

  it('docs/whatsapp-templates.md carries every template in every language, character for character', () => {
    for (const t of Object.values(WHATSAPP_TEMPLATES)) {
      if (!t) continue;
      expect(wa).toContain(`## \`${t.name}\``);
      for (const l of WA_LANGS) {
        expect(wa).toContain(`\`${t.text[l]}\``);
        for (const b of t.buttons ?? []) expect(wa).toContain(`\`${b.label[l]}\``);
      }
    }
    for (const l of WA_LANGS) expect(wa).toContain(AUTO_REPLY[l]);
  });

  it('every template fills exactly the variables its text uses, with no message text', () => {
    for (const [type, t] of Object.entries(WHATSAPP_TEMPLATES)) {
      if (!t) continue;
      const data = {
        name: 'N',
        sessionType: 'quick_chat',
        start: new Date().toISOString(),
        count: '3',
        alert: 'A',
        message: 'SECRET TEXT',
        requestId: 'r',
        bookingId: 'b',
      };
      for (const l of WA_LANGS) {
        const params = t.params(data, { lang: l, timezone: 'Asia/Kolkata' });
        const vars = new Set([...t.text[l].matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
        expect(params.length, `${type} ${l}`).toBe(vars.size);
        expect(params.join(' ')).not.toContain('SECRET TEXT');
      }
      expect(CATEGORY_OF[type as keyof typeof CATEGORY_OF]).toBeDefined();
    }
  });
});
