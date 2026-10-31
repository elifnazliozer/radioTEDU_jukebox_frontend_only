/**
 * Wall-display behaviours for the RadioTEDU kiosk: auto-hiding technical controls,
 * a full-screen offline notice, "new request" announcements, rotating idle content,
 * an album-colour ambient glow and a slow burn-in shift.
 */
(function (root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
        module.exports.default = api;
    }

    root.KioskExtras = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const CONTROLS_VISIBLE_MS = 4000;
    const OFFLINE_NOTICE_DELAY_MS = 6000;
    const REQUEST_TOAST_MS = 5000;
    const MAX_PENDING_TOASTS = 3;
    const IDLE_SLIDE_MS = 9000;
    const IDLE_DATA_REFRESH_MS = 60000;
    const BURN_IN_SHIFT_MS = 120000;
    const BURN_IN_MAX_OFFSET_PX = 4;
    const DEFAULT_GLOW = '237, 28, 36';
    const SYSTEM_QUEUE_REASONS = new Set(['autoplay', 'jingle', 'ad', 'system']);

    // Text goes through KioskI18n when it is loaded; unit tests may run without it.
    function i18n() {
        return (typeof globalThis !== 'undefined' && globalThis.KioskI18n) || null;
    }

    function tx(key, params) {
        return i18n()?.t(key, params) ?? key;
    }

    function tattrs(key, params) {
        return i18n()?.attrs(key, params) ?? '';
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Queue items that appeared since the last snapshot and were requested by a person. */
    function findNewRequests(previousIds, queue) {
        if (!previousIds) return [];
        return (queue || []).filter((item) => item?.id
            && !previousIds.has(item.id)
            && !SYSTEM_QUEUE_REASONS.has(item.queue_reason)
            && item.added_by_name);
    }

    /**
     * Average colour of the reasonably saturated, mid-brightness pixels of an image
     * (RGBA byte array). Grey and near-black/white pixels are ignored so the glow
     * picks up the cover's actual colour. Returns "r, g, b" or null.
     */
    function pickAmbientColor(pixels) {
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i + 3 < pixels.length; i += 4) {
            const pr = pixels[i];
            const pg = pixels[i + 1];
            const pb = pixels[i + 2];
            const max = Math.max(pr, pg, pb);
            const min = Math.min(pr, pg, pb);
            if (pixels[i + 3] < 128 || max < 40 || min > 225 || max - min < 40) continue;
            r += pr;
            g += pg;
            b += pb;
            count += 1;
        }
        if (count === 0) return null;
        return `${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)}`;
    }

    function computeBurnInOffset(random = Math.random) {
        const axis = () => Math.round((random() * 2 - 1) * BURN_IN_MAX_OFFSET_PX);
        return { x: axis(), y: axis() };
    }

    function create(app, options = {}) {
        const doc = options.document ?? document;
        const win = options.window ?? window;
        const state = {
            knownQueueIds: null,
            toastQueue: [],
            toastTimer: null,
            controlsTimer: null,
            offlineTimer: null,
            idleTimer: null,
            idleRefreshTimer: null,
            idleIndex: 0,
            idleData: { leaders: [], recent: [] },
            isIdle: true,
            glowRequest: 0,
        };

        // ---------- Technical controls: only visible after pointer activity ----------
        const revealControls = () => {
            doc.body.classList.add('controls-visible');
            win.clearTimeout(state.controlsTimer);
            state.controlsTimer = win.setTimeout(() => doc.body.classList.remove('controls-visible'), CONTROLS_VISIBLE_MS);
        };
        ['mousemove', 'pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
            doc.addEventListener(eventName, revealControls, { passive: true });
        });

        // ---------- Offline notice ----------
        const offlineOverlay = doc.createElement('div');
        offlineOverlay.className = 'kiosk-offline';
        offlineOverlay.setAttribute('role', 'status');
        offlineOverlay.innerHTML = `
            <div class="kiosk-offline-card">
                <span class="kiosk-offline-dot"></span>
                <p class="kiosk-offline-kicker" ${tattrs('offline.kicker')}>${tx('offline.kicker')}</p>
                <h2 ${tattrs('offline.title')}>${tx('offline.title')}</h2>
                <p ${tattrs('offline.body')}>${tx('offline.body')}</p>
            </div>`;
        doc.body.appendChild(offlineOverlay);

        function onConnectionStatus(status) {
            if (status === 'connected') {
                win.clearTimeout(state.offlineTimer);
                state.offlineTimer = null;
                offlineOverlay.classList.remove('is-visible');
                return;
            }
            if (status === 'error' && !state.offlineTimer) {
                state.offlineTimer = win.setTimeout(() => offlineOverlay.classList.add('is-visible'), OFFLINE_NOTICE_DELAY_MS);
            }
        }

        // ---------- New request announcements ----------
        const toastHost = doc.createElement('div');
        toastHost.className = 'kiosk-request-toast';
        toastHost.setAttribute('aria-live', 'polite');
        doc.body.appendChild(toastHost);

        function showNextToast() {
            const item = state.toastQueue.shift();
            if (!item) {
                toastHost.classList.remove('is-visible');
                state.toastTimer = null;
                return;
            }
            const cover = item.cover_url
                ? `<img src="${escapeHtml(item.cover_url)}" alt="">`
                : '<span class="kiosk-request-toast-cover"></span>';
            toastHost.innerHTML = `
                ${cover}
                <div>
                    <p class="kiosk-request-toast-kicker" ${tattrs('toast.kicker')}>${tx('toast.kicker')}</p>
                    <p class="kiosk-request-toast-line"><strong>${escapeHtml(item.added_by_name)}</strong> <span ${tattrs('toast.requested')}>${tx('toast.requested')}</span></p>
                    <p class="kiosk-request-toast-song">${escapeHtml(item.title)} — ${escapeHtml(item.artist)}</p>
                </div>`;
            toastHost.classList.remove('is-visible');
            void toastHost.offsetWidth; // restart the entrance animation
            toastHost.classList.add('is-visible');
            state.toastTimer = win.setTimeout(showNextToast, REQUEST_TOAST_MS);
        }

        function rememberQueue(queueData) {
            const ids = new Set((queueData?.queue || []).map((item) => item.id));
            if (queueData?.now_playing?.id) ids.add(queueData.now_playing.id);
            state.knownQueueIds = ids;
        }

        function onQueueUpdated(queueData) {
            const newRequests = findNewRequests(state.knownQueueIds, queueData?.queue);
            rememberQueue(queueData);
            if (newRequests.length === 0) return;
            state.toastQueue.push(...newRequests);
            state.toastQueue = state.toastQueue.slice(-MAX_PENDING_TOASTS);
            if (!state.toastTimer) showNextToast();
        }

        // ---------- Idle rotation ----------
        const idleSlides = () => Array.from(doc.querySelectorAll('.idle-slide'));

        function renderIdleData() {
            const leaders = doc.getElementById('idleLeaders');
            if (leaders) {
                leaders.innerHTML = state.idleData.leaders.slice(0, 3).map((leader, index) => `
                    <li>
                        <span class="idle-rank">${String(index + 1).padStart(2, '0')}</span>
                        <span class="idle-name">${escapeHtml(leader.display_name)}</span>
                        <span class="idle-score" ${tattrs('idle.score', { points: Math.round(Number(leader.rank_score ?? leader.score ?? 0)) })}>${escapeHtml(tx('idle.score', { points: Math.round(Number(leader.rank_score ?? leader.score ?? 0)) }))}</span>
                    </li>`).join('');
            }
            const recent = doc.getElementById('idleRecent');
            if (recent) {
                recent.innerHTML = state.idleData.recent.slice(0, 4).map((song) => `
                    <li>
                        ${song.cover_url ? `<img src="${escapeHtml(song.cover_url)}" alt="">` : '<span class="idle-recent-cover"></span>'}
                        <span class="idle-recent-copy">
                            <strong>${escapeHtml(song.title)}</strong>
                            <small>${escapeHtml(song.artist)}${song.added_by_name ? ` · ${escapeHtml(song.added_by_name)}` : ''}</small>
                        </span>
                    </li>`).join('');
            }
        }

        function availableSlides() {
            return idleSlides().filter((slide) => {
                const kind = slide.dataset.slide;
                if (kind === 'leaders') return state.idleData.leaders.length > 0;
                if (kind === 'recent') return state.idleData.recent.length > 0;
                return true;
            });
        }

        function showIdleSlide(index) {
            const slides = availableSlides();
            if (slides.length === 0) return;
            state.idleIndex = index % slides.length;
            idleSlides().forEach((slide) => slide.classList.remove('is-active'));
            slides[state.idleIndex].classList.add('is-active');
        }

        async function refreshIdleData() {
            const fetchJson = (url, init) => win.fetch(url, init).then((res) => (res.ok ? res.json() : null)).catch(() => null);
            const apiUrl = options.apiUrl ?? win.CONFIG?.API_URL ?? '';
            const deviceId = app.device?.id;
            const [leadersJson, recentJson] = await Promise.all([
                fetchJson(`${apiUrl}/api/v1/users/leaderboard?period=monthly`),
                deviceId
                    ? fetchJson(`${apiUrl}/api/v1/jukebox/kiosk/recent/${deviceId}`, {
                        headers: { 'x-kiosk-credential': app.getDevicePasswordForApi?.() ?? '' },
                    })
                    : null,
            ]);
            state.idleData = {
                leaders: leadersJson?.data?.leaderboard ?? [],
                recent: recentJson?.data?.items ?? [],
            };
            renderIdleData();
        }

        function startIdleRotation() {
            win.clearInterval(state.idleTimer);
            win.clearInterval(state.idleRefreshTimer);
            showIdleSlide(0);
            void refreshIdleData();
            state.idleTimer = win.setInterval(() => showIdleSlide(state.idleIndex + 1), IDLE_SLIDE_MS);
            state.idleRefreshTimer = win.setInterval(() => void refreshIdleData(), IDLE_DATA_REFRESH_MS);
        }

        function stopIdleRotation() {
            win.clearInterval(state.idleTimer);
            win.clearInterval(state.idleRefreshTimer);
        }

        // ---------- Album-colour ambient glow ----------
        function setGlow(rgb) {
            doc.documentElement.style.setProperty('--album-glow-rgb', rgb || DEFAULT_GLOW);
        }

        function applyAlbumGlow(coverUrl) {
            const request = ++state.glowRequest;
            if (!coverUrl || typeof win.Image !== 'function') {
                setGlow(DEFAULT_GLOW);
                return;
            }
            const img = new win.Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                if (request !== state.glowRequest) return;
                try {
                    const canvas = doc.createElement('canvas');
                    canvas.width = 24;
                    canvas.height = 24;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, 24, 24);
                    setGlow(pickAmbientColor(ctx.getImageData(0, 0, 24, 24).data));
                } catch {
                    setGlow(DEFAULT_GLOW); // cover host without CORS: keep the brand red
                }
            };
            img.onerror = () => request === state.glowRequest && setGlow(DEFAULT_GLOW);
            img.src = coverUrl;
        }

        // ---------- Burn-in protection ----------
        const shiftTarget = doc.querySelector('.kiosk-app');
        win.setInterval(() => {
            if (!shiftTarget) return;
            const { x, y } = computeBurnInOffset();
            shiftTarget.style.transform = `translate(${x}px, ${y}px)`;
        }, BURN_IN_SHIFT_MS);

        setGlow(DEFAULT_GLOW);
        startIdleRotation();

        return {
            onConnectionStatus,
            onQueueUpdated,
            seedQueue: rememberQueue,
            onPlaying(song) {
                const coverUrl = song?.cover_url || null;
                if (!state.isIdle && coverUrl === state.lastCover) return; // same song re-synced
                state.isIdle = false;
                state.lastCover = coverUrl;
                stopIdleRotation();
                applyAlbumGlow(coverUrl);
            },
            onIdle() {
                if (state.isIdle) return;
                state.isIdle = true;
                state.lastCover = null;
                applyAlbumGlow(null);
                startIdleRotation();
            },
        };
    }

    return {
        create,
        findNewRequests,
        pickAmbientColor,
        computeBurnInOffset,
    };
});
