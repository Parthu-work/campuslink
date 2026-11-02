import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SMS_TEMPLATES, parseDltTemplateIds } from '../src/modules/notifications/channels/sms-templates.js';
import {
  AUTO_REPLY,
  WA_LANGS,
  WHATSAPP_TEMPLATES,
  INVITE_TEMPLATES,
} from '../src/modules/notifications/channels/whatsapp-templates.js';
import { CATEGORY_OF, SUPPORTED_LOCALES } from '@campuslink/shared';
import { NOTIFICATION_TEXTS, renderNotification } from '../src/modules/notifications/templates.js';
import { OtpSender } from '../src/modules/notifications/channels/otp-sender.js';
import { detectLanguage, systemPrompt } from '../src/modules/study/chat/prompt.js';

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
    for (const t of [...Object.values(WHATSAPP_TEMPLATES), ...Object.values(INVITE_TEMPLATES)]) {
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

  it('invite templates fill the first name, college and link', () => {
    for (const t of Object.values(INVITE_TEMPLATES))
      for (const l of WA_LANGS) {
        const params = t.params(
          { name: 'Asha', college: 'C', link: 'https://x/invite/t' },
          { lang: l, timezone: 'UTC' },
        );
        expect(params).toEqual(['Asha', 'C', 'https://x/invite/t']);
        expect(new Set([...t.text[l].matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size).toBe(3);
      }
  });
});

describe('server texts in every language (B12)', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it('every notification has a title and body in every language, with the English placeholders', () => {
    const mismatched: string[] = [];
    for (const l of SUPPORTED_LOCALES) {
      for (const [type, en] of Object.entries(NOTIFICATION_TEXTS.en)) {
        const t = NOTIFICATION_TEXTS[l][type as keyof typeof NOTIFICATION_TEXTS.en];
        if (!t?.title.trim() || !t.body.trim()) mismatched.push(`${l}:${type} empty`);
        else if (
          JSON.stringify(placeholders(t.title)) !== JSON.stringify(placeholders(en.title)) ||
          JSON.stringify(placeholders(t.body)) !== JSON.stringify(placeholders(en.body))
        )
          mismatched.push(`${l}:${type}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('renders Hindi with Indian date formatting', () => {
    const r = renderNotification(
      'booking_reminder',
      { name: 'Asha', sessionType: 'quick_chat', start: '2026-11-02T10:00:00.000Z' },
      'hi',
      'Asia/Kolkata',
    );
    expect(r.body).toContain('Asha');
    expect(r.body).toContain('क्विक चैट');
    expect(r.open).toBe('खोलें');
  });

  it('a code SMS is in Hindi only once its template is registered', () => {
    const deps = {
      whatsapp: {} as never,
      sms: {} as never,
      logger: {} as never,
      smsTemplateId: (k: string) => k,
    };
    expect(new OtpSender({ ...deps }).smsKey('hi')).toBe('otp');
    expect(new OtpSender({ ...deps, smsTemplateRegistered: (k) => k === 'otp_hi' }).smsKey('hi')).toBe(
      'otp_hi',
    );
    expect(new OtpSender({ ...deps, smsTemplateRegistered: () => true }).smsKey('te')).toBe('otp');
    expect(new OtpSender({ ...deps, smsTemplateRegistered: () => true }).smsKey('en')).toBe('otp');
  });

  it('the study assistant answers in the script the question is written in', () => {
    expect(detectLanguage('What is a transistor?')).toBe('en');
    expect(detectLanguage('ట్రాన్సిస్టర్ అంటే ఏమిటి?')).toBe('te');
    expect(detectLanguage('ट्रांजिस्टर क्या है?')).toBe('hi');
    expect(detectLanguage('Explain ट्रांजिस्टर please')).toBe('hi');
    expect(systemPrompt({ kind: 'answer' }, 'simple', 'hi')).toContain('Reply in Hindi.');
  });
});
