import { describe, expect, it, vi } from 'vitest';
import { Translator } from './core';

const make = async () => {
  const i = new Translator();
  await i.init({
    lng: 'en',
    defaultVariables: { app: 'DemoApp' },
    resources: {
      en: {
        translation: {
          a: { b: 'Hello {{name}}', app: 'Welcome to {{app}}', blank: 'x{{missing}}y' },
          items_one: '{{count}} item',
          items_other: '{{count}} items',
          only: 'One form for {{count}}',
        },
      },
    },
  });
  return i;
};

describe('translator', () => {
  it('reads dotted keys and fills variables, including the default ones', async () => {
    const i = await make();
    expect(i.t('a.b', { name: 'Asha' })).toBe('Hello Asha');
    expect(i.t('a.app')).toBe('Welcome to DemoApp');
    expect(i.t('a.blank')).toBe('xy');
  });

  it('picks plural forms by the language’s rules, falling back to the plain key', async () => {
    const i = await make();
    expect(i.t('items', { count: 1 })).toBe('1 item');
    expect(i.t('items', { count: 0 })).toBe('0 items');
    expect(i.t('items', { count: 5 })).toBe('5 items');
    expect(i.t('only', { count: 3 })).toBe('One form for 3');
  });

  it('returns the default value, else the key, for a missing string (never an object)', async () => {
    const i = await make();
    expect(i.t('nope', { defaultValue: 'Fallback' })).toBe('Fallback');
    expect(i.t('nope.deeper')).toBe('nope.deeper');
    expect(i.t('a')).toBe('a');
  });

  it('switches language and tells listeners once', async () => {
    const i = await make();
    i.addResourceBundle('te', 'translation', { a: { b: 'నమస్తే {{name}}' } });
    expect(i.hasResourceBundle('te')).toBe(true);
    const fn = vi.fn();
    i.on('languageChanged', fn);
    await i.changeLanguage('te');
    await i.changeLanguage('te');
    expect(fn).toHaveBeenCalledOnce();
    expect(i.language).toBe('te');
    expect(i.t('a.b', { name: 'Asha' })).toBe('నమస్తే Asha');
    i.off('languageChanged', fn);
    await i.changeLanguage('en');
    expect(fn).toHaveBeenCalledOnce();
  });
});
