import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SMS_TEMPLATES, parseDltTemplateIds } from '../src/modules/notifications/channels/sms-templates.js';

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
