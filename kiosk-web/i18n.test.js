import { afterEach, describe, expect, it } from 'vitest';
import i18n from './i18n.js';

const { MESSAGES, detectLang, t } = i18n;

afterEach(() => {
    i18n.setLang('tr', { persist: false });
    localStorage.clear();
});

describe('kiosk dictionaries', () => {
    it('define the same keys in Turkish and English, all non-empty', () => {
        const trKeys = Object.keys(MESSAGES.tr).sort();
        expect(Object.keys(MESSAGES.en).sort()).toEqual(trKeys);
        for (const lang of ['tr', 'en']) {
            for (const key of trKeys) {
                expect(MESSAGES[lang][key].trim(), `${lang}:${key}`).not.toBe('');
            }
        }
    });

    it('use the same placeholders in both languages', () => {
        const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort();
        for (const key of Object.keys(MESSAGES.tr)) {
            expect(placeholders(MESSAGES.en[key]), key).toEqual(placeholders(MESSAGES.tr[key]));
        }
    });
});

describe('detectLang', () => {
    it('prefers ?lang, then the stored choice, then the browser language', () => {
        expect(detectLang({ search: '?code=K1&lang=en', stored: 'tr', browserLang: 'tr-TR' })).toEqual({ lang: 'en', fromUrl: true });
        expect(detectLang({ search: '?lang=xx', stored: 'en', browserLang: 'tr-TR' })).toEqual({ lang: 'en', fromUrl: false });
        expect(detectLang({ search: '', stored: null, browserLang: 'tr-TR' })).toEqual({ lang: 'tr', fromUrl: false });
        expect(detectLang({ search: '', stored: 'de', browserLang: 'de-DE' })).toEqual({ lang: 'en', fromUrl: false });
    });
});

describe('translate', () => {
    it('fills placeholders and falls back to the key for unknown messages', () => {
        expect(t('idle.score', { points: 12 }, 'tr')).toBe('12 puan');
        expect(t('idle.score', { points: 12 }, 'en')).toBe('12 points');
        expect(t('missing.key')).toBe('missing.key');
    });

    it('maps known Spotify reasons and leaves other text alone', () => {
        expect(i18n.translateReason('Spotify Premium hesabı gerekli', 'en')).toBe('A Spotify Premium account is required');
        expect(i18n.translateReason('Something else', 'en')).toBe('Something else');
    });
});

describe('applying translations to the page', () => {
    it('translates data-i18n text, params and attributes, and re-translates on a language switch', () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <p id="title" data-i18n="queue.empty">Kuyruk boş</p>
            <span id="score" ${i18n.attrs('idle.score', { points: 7 })}></span>
            <button id="out" data-i18n-attr="title:common.logout;aria-label:common.logout"></button>
            <strong id="name">Elif</strong>`;
        document.body.appendChild(root);

        i18n.setLang('en', { persist: false });
        expect(root.querySelector('#title').textContent).toBe('Queue is empty');
        expect(root.querySelector('#score').textContent).toBe('7 points');
        expect(root.querySelector('#out').getAttribute('aria-label')).toBe('Sign out');
        expect(root.querySelector('#name').textContent).toBe('Elif');
        expect(document.documentElement.lang).toBe('en');

        i18n.setLang('tr', { persist: false });
        expect(root.querySelector('#title').textContent).toBe('Kuyruk boş');
        expect(root.querySelector('#score').textContent).toBe('7 puan');
        expect(root.querySelector('#out').getAttribute('title')).toBe('Çıkış Yap');
        expect(document.documentElement.lang).toBe('tr');
        root.remove();
    });

    it('drops the key when plain text replaces translated text', () => {
        const el = document.createElement('span');
        document.body.appendChild(el);
        i18n.setText(el, 'stage.anonymous');
        expect(el.textContent).toBe('Anonim');
        i18n.setPlainText(el, 'Can');
        i18n.setLang('en', { persist: false });
        expect(el.textContent).toBe('Can');
        el.remove();
    });

    it('toggles between languages from the header button and persists the choice', () => {
        const button = document.createElement('button');
        const label = document.createElement('p');
        label.setAttribute('data-i18n', 'idle.tag');
        document.body.append(button, label);

        i18n.bindToggle(button);
        expect(button.textContent).toBe('EN');

        button.click();
        expect(label.textContent).toBe('Join from your phone');
        expect(button.textContent).toBe('TR');
        expect(button.getAttribute('aria-label')).toBe('Türkçeye geç');
        expect(localStorage.getItem('kiosk_lang')).toBe('en');

        button.click();
        expect(label.textContent).toBe('Telefonla katıl');
        expect(localStorage.getItem('kiosk_lang')).toBe('tr');
        button.remove();
        label.remove();
    });

    it('init takes ?lang from the URL and persists it', () => {
        const storage = new Map();
        const win = {
            location: { search: '?code=KIOSK1&lang=en' },
            navigator: { language: 'tr-TR' },
            localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
            document,
        };
        expect(i18n.init(win)).toBe('en');
        expect(storage.get('kiosk_lang')).toBe('en');
    });
});
