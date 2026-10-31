import { describe, expect, it } from 'vitest';
import { MESSAGES, contentLang, detectInitialLang, translate } from './i18n';

describe('i18n dictionaries', () => {
  it('defines every key in both languages with non-empty text', () => {
    const trKeys = Object.keys(MESSAGES.tr).sort();
    expect(Object.keys(MESSAGES.en).sort()).toEqual(trKeys);
    for (const lang of ['tr', 'en'] as const) {
      for (const key of trKeys) {
        expect(MESSAGES[lang][key as keyof typeof MESSAGES.tr].trim(), `${lang}:${key}`).not.toBe('');
      }
    }
  });

  it('uses the same placeholders in both languages', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(MESSAGES.tr) as Array<keyof typeof MESSAGES.tr>) {
      expect(placeholders(MESSAGES.en[key]), key).toEqual(placeholders(MESSAGES.tr[key]));
    }
  });
});

describe('translate', () => {
  it('fills placeholders and leaves unknown ones untouched', () => {
    expect(translate('tr', 'login.enterDevice', { code: 'KIOSK1' })).toBe('KIOSK1 cihazına gir');
    expect(translate('en', 'login.enterDevice', { code: 'KIOSK1' })).toBe('Join KIOSK1');
    expect(translate('en', 'login.enterDevice')).toBe('Join {code}');
  });
});

describe('detectInitialLang', () => {
  it('prefers a stored choice', () => {
    expect(detectInitialLang('en', 'tr-TR')).toBe('en');
    expect(detectInitialLang('tr', 'en-US')).toBe('tr');
  });

  it('falls back to the browser language, defaulting to English for non-Turkish browsers', () => {
    expect(detectInitialLang(null, 'tr-TR')).toBe('tr');
    expect(detectInitialLang(null, 'TR')).toBe('tr');
    expect(detectInitialLang(null, 'de-DE')).toBe('en');
    expect(detectInitialLang('fr', undefined)).toBe('en');
  });
});

describe('contentLang', () => {
  it('keeps Turkish casing only for text with Turkish letters', () => {
    expect(contentLang('Design Test')).toBe('en');
    expect(contentLang('İşim Olmaz')).toBe('tr');
    expect(contentLang('Işık')).toBe('tr');
    expect(contentLang(null)).toBe('en');
  });
});
