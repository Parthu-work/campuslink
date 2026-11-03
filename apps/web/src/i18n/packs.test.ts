import { beforeAll, describe, expect, it, vi } from 'vitest';
import en from './en.json';
import career from './packs/career.en.json';
import careerTe from './packs/career.te.json';
import te from './te.json';
import type * as I18nModule from './index';

/** Packs (prompt 2): sections that load with the screens using them, in every language. */
let m: typeof I18nModule;

beforeAll(async () => {
  // The loader sets <html lang>; these tests run without a DOM.
  vi.stubGlobal('document', { documentElement: { setAttribute: () => undefined } });
  m = await import('./index');
  await m.i18nReady;
});

describe('language packs', () => {
  it('adds a pack to the current language without losing the main strings', async () => {
    const i18n = m.default;
    expect(i18n.t('resume.new')).toBe('resume.new');
    await m.loadPack('career');
    expect(i18n.t('resume.new')).toBe(career.resume.new);
    expect(i18n.t('nav.resume')).toBe(en.nav.resume);
  });

  it('a language switched to later gets the packs already in use', async () => {
    const i18n = m.default;
    await m.loadLanguage('te');
    await i18n.changeLanguage('te');
    expect(i18n.t('resume.new')).toBe(careerTe.resume.new);
    expect(i18n.t('nav.resume')).toBe(te.nav.resume);
    await i18n.changeLanguage('en');
  });
});
