/**
 * TR/EN text for the kiosk wall display. Static markup carries `data-i18n`
 * (text) and `data-i18n-attr` ("attr:key;attr:key") attributes; dynamic markup
 * built in app.js / kiosk-extras.js uses the same attributes, so switching the
 * language re-translates everything on screen in one pass.
 */
(function (root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
        module.exports.default = api;
    }

    root.KioskI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const STORAGE_KEY = 'kiosk_lang';
    const LANGS = ['tr', 'en'];

    const tr = {
        'common.logout': 'Çıkış Yap',
        'common.switchLanguage': 'Switch to English',
        'idle.score': '{points} puan',
        'common.albumCover': 'Albüm kapağı',

        'status.onAir': 'YAYINDA',
        'status.connecting': 'Bağlanıyor',
        'status.connected': 'Bağlı',
        'status.error': 'Bağlantı hatası',
        'status.disconnected': 'Bağlantı kesildi',

        'ticker.live': 'CANLI',
        'ticker.jukebox': 'JUKEBOX',
        'ticker.request': 'İSTE',
        'ticker.vote': 'OYLA',
        'ticker.listen': 'DİNLE',
        'ticker.campus': 'KAMPÜS',

        'stage.label': 'ŞU AN ÇALIYOR',
        'stage.live': 'CANLI',
        'stage.anonymous': 'Anonim',

        'idle.titleLine1': 'Sıra',
        'idle.titleLine2': 'sende.',
        'idle.subtitle': 'Kuyruk şu an boş. QR kodu okut, ilk şarkıyı kampüs hoparlörlerine sen gönder.',
        'idle.tag': 'Telefonla katıl',
        'idle.howTo': 'NASIL KATILIRIM?',
        'idle.step1Title': 'Okut',
        'idle.step1Body': 'Sağdaki QR kodu telefon kameranla okut.',
        'idle.step2Title': 'Ara',
        'idle.step2Body': 'Şarkının ya da sanatçının adını yaz.',
        'idle.step3Title': 'Ekle',
        'idle.step3Body': 'Sıraya gönder, oylarla yukarı taşı.',
        'idle.leaders': "BU AYIN DJ'LERİ",
        'idle.recent': 'SON ÇALANLAR',

        'lyrics.title': 'Şarkı Sözleri',
        'lyrics.live': 'Canlı',
        'lyrics.plain': 'Metin',
        'lyrics.none': 'Yok',
        'lyrics.searching': 'Aranıyor...',
        'lyrics.loading': 'Sözler yükleniyor...',
        'lyrics.stillSearching': 'Sözler hâlâ aranıyor…',
        'lyrics.notFound': 'Bu şarkı için söz bulunamadı 🎵',
        'lyrics.unavailable': 'Müziğin ritmine kulak ver 🎶',
        'lyrics.waiting': 'Müzik bekliyor...',

        'qr.label': 'KATIL',
        'qr.stepsLabel': 'Nasıl katılırım',
        'qr.step1': 'Okut',
        'qr.step2': 'Ara',
        'qr.step3': 'Ekle',
        'qr.hint': 'Telefonunuzla tarayın',
        'qr.code': 'KOD',
        'qr.loading': 'QR Yükleniyor...',
        'qr.failed': 'QR Yüklenemedi',
        'qr.invalidCode': 'GEÇERSİZ KOD',
        'qr.notRegistered': 'Bu kod sistemde kayıtlı değil.',
        'qr.resetCode': 'Kodu Sıfırla',
        'qr.backendUnreachable': "Backend'e ulaşılamıyor:",

        'queue.label': 'SIRADAKİLER',
        'queue.songs': 'ŞARKI',
        'queue.empty': 'Kuyruk boş',
        'queue.emptyHint': 'İlk şarkıyı siz ekleyin.',
        'queue.upNext': 'SIRADAKİ',
        'queue.requestedBy': 'İsteyen',

        'setup.title': 'Cihaz Kurulumu',
        'setup.message': "Bu ekranın hangi Jukebox'u temsil ettiğini belirlemek için sistem panelindeki Cihaz Kodunu ve tek kullanımlık kurulum kodunu girin.",
        'setup.codePlaceholder': 'Cihaz Kodu (Örn: KAFE-01)',
        'setup.provisioningPlaceholder': 'Tek kullanımlık kurulum kodu',
        'setup.save': 'Kaydet ve Başlat',
        'setup.footnote': 'Yönetim panelinde oluşturulan tek kullanımlık kodu girin. Kod 15 dakika içinde geçerliliğini yitirir.',

        'startup.title': "Jukebox'u Başlatmak İçin Tıklayın",
        'startup.message': 'Tarayıcı ses kısıtlamasını aşmak için gereklidir',
        'startup.spotifyConnect': 'Spotify Bağla',
        'startup.spotifyFootnote': 'Bu kiosk kendi Spotify hesabıyla bağlanmadan Spotify şarkıları çalamaz.',

        'spotify.eyebrow': 'Spotify bağlantısı',
        'spotify.title': 'Spotify bağlantısı gerekli',
        'spotify.defaultReason': 'Bu cihazın Spotify bağlantısını tamamlayın.',
        'spotify.connect': 'Bağlan',
        'spotify.footnote': 'Bağlantı tamamlanınca kiosk otomatik devam eder.',
        'spotify.reasonRequired': 'Spotify bağlantısı gerekli',
        'spotify.reasonPremium': 'Spotify Premium hesabı gerekli',
        'spotify.reasonScopes': 'Spotify yetkileri eksik',

        'offline.kicker': 'RT / BAĞLANTI',
        'offline.title': 'Yayına yeniden bağlanıyor…',
        'offline.body': 'Ekran kendiliğinden toparlanacak. Müzik isteği şimdilik alınamıyor.',

        'toast.kicker': 'YENİ İSTEK',
        'toast.requested': 'istedi',
    };

    const en = {
        'common.logout': 'Sign out',
        'common.switchLanguage': 'Türkçeye geç',
        'idle.score': '{points} points',
        'common.albumCover': 'Album cover',

        'status.onAir': 'ON AIR',
        'status.connecting': 'Connecting',
        'status.connected': 'Connected',
        'status.error': 'Connection error',
        'status.disconnected': 'Disconnected',

        'ticker.live': 'LIVE',
        'ticker.jukebox': 'JUKEBOX',
        'ticker.request': 'REQUEST',
        'ticker.vote': 'VOTE',
        'ticker.listen': 'LISTEN',
        'ticker.campus': 'CAMPUS',

        'stage.label': 'NOW PLAYING',
        'stage.live': 'LIVE',
        'stage.anonymous': 'Anonymous',

        'idle.titleLine1': 'Your',
        'idle.titleLine2': 'turn.',
        'idle.subtitle': 'The queue is empty. Scan the QR code and send the first song to the campus speakers.',
        'idle.tag': 'Join from your phone',
        'idle.howTo': 'HOW DO I JOIN?',
        'idle.step1Title': 'Scan',
        'idle.step1Body': 'Scan the QR code on the right with your phone camera.',
        'idle.step2Title': 'Search',
        'idle.step2Body': 'Type the name of a song or artist.',
        'idle.step3Title': 'Add',
        'idle.step3Body': 'Send it to the queue and vote it up.',
        'idle.leaders': "THIS MONTH'S DJS",
        'idle.recent': 'RECENTLY PLAYED',

        'lyrics.title': 'Lyrics',
        'lyrics.live': 'Live',
        'lyrics.plain': 'Text',
        'lyrics.none': 'None',
        'lyrics.searching': 'Searching...',
        'lyrics.loading': 'Loading lyrics...',
        'lyrics.stillSearching': 'Still looking for lyrics…',
        'lyrics.notFound': 'No lyrics found for this song 🎵',
        'lyrics.unavailable': 'Just feel the beat 🎶',
        'lyrics.waiting': 'Waiting for music...',

        'qr.label': 'JOIN',
        'qr.stepsLabel': 'How to join',
        'qr.step1': 'Scan',
        'qr.step2': 'Search',
        'qr.step3': 'Add',
        'qr.hint': 'Scan with your phone',
        'qr.code': 'CODE',
        'qr.loading': 'Loading QR...',
        'qr.failed': "Couldn't load QR",
        'qr.invalidCode': 'INVALID CODE',
        'qr.notRegistered': "This code isn't registered.",
        'qr.resetCode': 'Reset code',
        'qr.backendUnreachable': "Can't reach the backend:",

        'queue.label': 'UP NEXT',
        'queue.songs': 'SONGS',
        'queue.empty': 'Queue is empty',
        'queue.emptyHint': 'Add the first song.',
        'queue.upNext': 'UP NEXT',
        'queue.requestedBy': 'Requested by',

        'setup.title': 'Device setup',
        'setup.message': 'Enter the device code and one-time provisioning code from the admin panel to choose which jukebox this screen represents.',
        'setup.codePlaceholder': 'Device code (e.g. KAFE-01)',
        'setup.provisioningPlaceholder': 'One-time provisioning code',
        'setup.save': 'Save and start',
        'setup.footnote': 'Enter the one-time code generated in the admin panel. It expires in 15 minutes.',

        'startup.title': 'Click to start the jukebox',
        'startup.message': 'Needed to get past the browser’s audio restrictions',
        'startup.spotifyConnect': 'Connect Spotify',
        'startup.spotifyFootnote': "This kiosk can't play Spotify songs until it's connected to its own Spotify account.",

        'spotify.eyebrow': 'Spotify connect',
        'spotify.title': 'Spotify connection required',
        'spotify.defaultReason': "Finish connecting this device's Spotify account.",
        'spotify.connect': 'Connect',
        'spotify.footnote': 'The kiosk continues on its own once the connection is done.',
        'spotify.reasonRequired': 'Spotify connection required',
        'spotify.reasonPremium': 'A Spotify Premium account is required',
        'spotify.reasonScopes': 'Spotify permissions are missing',

        'offline.kicker': 'RT / CONNECTION',
        'offline.title': 'Reconnecting to the stream…',
        'offline.body': "The screen will recover on its own. Song requests can't be taken right now.",

        'toast.kicker': 'NEW REQUEST',
        'toast.requested': 'requested',
    };

    const MESSAGES = { tr, en };

    // Reasons arrive as Turkish (client classification) or English (backend) text.
    const KNOWN_REASONS = {
        'Spotify bağlantısı gerekli': 'spotify.reasonRequired',
        'Spotify authorization required for this device': 'spotify.reasonRequired',
        'Spotify Premium hesabı gerekli': 'spotify.reasonPremium',
        'Spotify yetkileri eksik': 'spotify.reasonScopes',
    };

    let currentLang = 'tr';
    const listeners = new Set();

    function normalizeLang(value) {
        const lang = String(value || '').trim().toLowerCase();
        return LANGS.includes(lang) ? lang : null;
    }

    function detectLang({ search, stored, browserLang } = {}) {
        let fromUrl;
        try {
            fromUrl = normalizeLang(new URLSearchParams(search || '').get('lang'));
        } catch {
            fromUrl = null;
        }
        if (fromUrl) return { lang: fromUrl, fromUrl: true };
        const fromStorage = normalizeLang(stored);
        if (fromStorage) return { lang: fromStorage, fromUrl: false };
        const browser = String(browserLang || '').toLowerCase();
        return { lang: browser.startsWith('tr') ? 'tr' : 'en', fromUrl: false };
    }

    function format(template, params) {
        if (!params) return template;
        return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
    }

    function t(key, params, lang) {
        const dict = MESSAGES[lang || currentLang] || MESSAGES.tr;
        const template = dict[key] ?? MESSAGES.tr[key];
        return template === undefined ? key : format(template, params);
    }

    function reasonKey(reason) {
        return KNOWN_REASONS[String(reason || '').trim()] || null;
    }

    function translateReason(reason, lang) {
        const key = reasonKey(reason);
        return key ? t(key, null, lang) : reason;
    }

    function escapeAttr(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /** Markup attributes for a translated text node, for use inside template strings. */
    function attrs(key, params) {
        return `data-i18n="${escapeAttr(key)}"${params ? ` data-i18n-params="${escapeAttr(JSON.stringify(params))}"` : ''}`;
    }

    function readParams(el) {
        const raw = el.getAttribute('data-i18n-params');
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function applyTranslations(rootNode, lang) {
        if (!rootNode?.querySelectorAll) return;
        rootNode.querySelectorAll('[data-i18n]').forEach((el) => {
            el.textContent = t(el.getAttribute('data-i18n'), readParams(el), lang);
        });
        rootNode.querySelectorAll('[data-i18n-attr]').forEach((el) => {
            el.getAttribute('data-i18n-attr').split(';').forEach((pair) => {
                const [attr, key] = pair.split(':').map((part) => part && part.trim());
                if (attr && key) el.setAttribute(attr, t(key, null, lang));
            });
        });
    }

    /** Sets translated text on an element and remembers the key for later language switches. */
    function setText(el, key, params) {
        if (!el) return;
        el.setAttribute('data-i18n', key);
        if (params) el.setAttribute('data-i18n-params', JSON.stringify(params));
        else el.removeAttribute('data-i18n-params');
        el.textContent = t(key, params);
    }

    /** Sets plain (untranslated) text, dropping any key so a language switch leaves it alone. */
    function setPlainText(el, text) {
        if (!el) return;
        el.removeAttribute('data-i18n');
        el.removeAttribute('data-i18n-params');
        el.textContent = text;
    }

    function getLang() {
        return currentLang;
    }

    function setLang(lang, options = {}) {
        const next = normalizeLang(lang) || 'tr';
        currentLang = next;
        const doc = options.document ?? (typeof document !== 'undefined' ? document : null);
        if (doc?.documentElement) doc.documentElement.lang = next;
        if (options.persist !== false) {
            try {
                const storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
                storage?.setItem(STORAGE_KEY, next);
            } catch {
                // Blocked storage: the choice still applies until reload.
            }
        }
        if (doc) applyTranslations(doc);
        listeners.forEach((listener) => listener(next));
        return next;
    }

    function onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    /** Picks the language from ?lang, storage or the browser, and translates the page. */
    function init(win) {
        const scope = win ?? (typeof window !== 'undefined' ? window : null);
        let stored;
        try {
            stored = scope?.localStorage?.getItem(STORAGE_KEY) ?? null;
        } catch {
            stored = null;
        }
        const { lang, fromUrl } = detectLang({
            search: scope?.location?.search,
            stored,
            browserLang: scope?.navigator?.language,
        });
        return setLang(lang, {
            document: scope?.document,
            storage: scope?.localStorage,
            persist: fromUrl,
        });
    }

    function bindToggle(button) {
        if (!button) return;
        const render = () => {
            button.textContent = currentLang === 'tr' ? 'EN' : 'TR';
            button.setAttribute('title', t('common.switchLanguage'));
            button.setAttribute('aria-label', t('common.switchLanguage'));
        };
        button.onclick = () => {
            const next = currentLang === 'tr' ? 'en' : 'tr';
            // Crossfade old and new text where the browser supports view transitions.
            const doc = button.ownerDocument;
            const reduceMotion = doc?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            if (doc?.startViewTransition && !reduceMotion) {
                doc.startViewTransition(() => setLang(next));
            } else {
                setLang(next);
            }
        };
        onChange(render);
        render();
    }

    return {
        STORAGE_KEY,
        MESSAGES,
        detectLang,
        t,
        reasonKey,
        translateReason,
        attrs,
        applyTranslations,
        setText,
        setPlainText,
        getLang,
        setLang,
        onChange,
        init,
        bindToggle,
    };
});
