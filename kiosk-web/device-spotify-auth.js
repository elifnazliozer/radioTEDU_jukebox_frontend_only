(function (root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
        module.exports.default = api;
    }

    root.KioskDeviceSpotifyAuth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const SETUP_OVERLAY_ID = 'spotifyDeviceAuthSetupOverlay';
    const SETUP_BUTTON_SELECTOR = '[data-role="spotify-connect"]';

    function buildSpotifyDeviceAuthEndpoints(baseUrl) {
        return {
            status: `${baseUrl}/api/v1/jukebox/kiosk/spotify-device-auth/status`,
            start: `${baseUrl}/api/v1/jukebox/kiosk/spotify-device-auth/start`,
        };
    }

    function buildSpotifyDeviceAuthStartUrl(baseUrl) {
        return `${baseUrl}/api/v1/jukebox/kiosk/spotify-device-auth/start`;
    }

    // Text goes through KioskI18n when it is loaded; unit tests may run without it.
    function i18n() {
        return (typeof globalThis !== 'undefined' && globalThis.KioskI18n) || null;
    }

    function tx(key) {
        return i18n()?.t(key) ?? key;
    }

    function tattrs(key) {
        return i18n()?.attrs(key) ?? '';
    }

    /** Known reasons are shown translated (and re-translate on a language switch); others verbatim. */
    function reasonMarkup(reason) {
        if (!reason) {
            return `<p class="spotify-device-auth-setup-message" ${tattrs('spotify.defaultReason')}>${escapeHtml(tx('spotify.defaultReason'))}</p>`;
        }
        const reasonKey = i18n()?.reasonKey?.(reason);
        // "Connection required" just repeats the card title; say what to do instead.
        if (reasonKey === 'spotify.reasonRequired') {
            return reasonMarkup('');
        }
        if (reasonKey) {
            return `<p class="spotify-device-auth-setup-message" ${tattrs(reasonKey)}>${escapeHtml(tx(reasonKey))}</p>`;
        }
        return `<p class="spotify-device-auth-setup-message">${escapeHtml(reason)}</p>`;
    }

    function removeSpotifyDeviceAuthSetup(documentScope) {
        const existing = documentScope?.getElementById?.(SETUP_OVERLAY_ID);
        if (!existing) {
            return;
        }

        if (typeof existing.remove === 'function') {
            existing.remove();
            return;
        }

        if (documentScope?.body?.removeChild) {
            documentScope.body.removeChild(existing);
        }
    }

    function renderSpotifyDeviceAuthSetup(documentScope, options = {}) {
        if (!documentScope?.createElement) {
            return null;
        }

        removeSpotifyDeviceAuthSetup(documentScope);

        const overlay = documentScope.createElement('div');
        overlay.id = SETUP_OVERLAY_ID;
        overlay.className = 'spotify-device-auth-setup-overlay';
        overlay.innerHTML = `
            <div class="spotify-device-auth-setup-card">
                <div class="spotify-device-auth-setup-icon">♪</div>
                <div class="spotify-device-auth-setup-copy">
                    <div class="spotify-device-auth-setup-eyebrow" ${tattrs('spotify.eyebrow')}>${escapeHtml(tx('spotify.eyebrow'))}</div>
                    <h2 class="spotify-device-auth-setup-title" ${tattrs('spotify.title')}>${escapeHtml(tx('spotify.title'))}</h2>
                    ${reasonMarkup(options.reason)}
                </div>
                <button type="button" class="spotify-device-auth-setup-button" data-role="spotify-connect" ${tattrs('spotify.connect')}>${escapeHtml(tx('spotify.connect'))}</button>
                <p class="spotify-device-auth-setup-footnote" ${tattrs('spotify.footnote')}>${escapeHtml(tx('spotify.footnote'))}</p>
            </div>
        `;

        if (typeof overlay.querySelector === 'function') {
            const button = overlay.querySelector(SETUP_BUTTON_SELECTOR);
            if (button && typeof button.addEventListener === 'function') {
                button.addEventListener('click', async () => {
                    await options.onConnect?.();
                });
            } else if (button) {
                button.onclick = async () => {
                    await options.onConnect?.();
                };
            }
        }

        if (documentScope?.body?.appendChild) {
            documentScope.body.appendChild(overlay);
        }

        return overlay;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function createSpotifyDeviceAuthController(options = {}) {
        const documentScope = options.document;
        const windowScope = options.window || (typeof globalThis !== 'undefined' ? globalThis : this);
        const apiBaseUrl = options.apiBaseUrl || '';
        const deviceId = options.deviceId;
        const devicePassword = options.devicePassword || '';
        const endpoints = buildSpotifyDeviceAuthEndpoints(apiBaseUrl);

        let currentStatus = null;
        let messageListener = null;

        const fetchFn = (typeof options.fetch === 'function' ? options.fetch : (typeof window !== 'undefined' ? window.fetch : globalThis.fetch)).bind(typeof window !== 'undefined' ? window : globalThis);

        async function fetchJson(url, init = {}) {
            const response = await fetchFn(url, {
                ...init,
                headers: {
                    'Content-Type': 'application/json',
                    ...(init.headers || {}),
                },
            });

            if (!response.ok) {
                let errorMessage = `Spotify device auth request failed (${response.status})`;
                try {
                    const errorData = await response.json();
                    if (errorData?.error) {
                        errorMessage = errorData.error;
                    }
                } catch (error) {
                    // Ignore secondary parse errors.
                }
                throw new Error(errorMessage);
            }

            return response.json();
        }

        function ensureMessageListener() {
            if (!windowScope?.addEventListener || messageListener) {
                return;
            }

            messageListener = async (event) => {
                if (!event?.data || event.data.type !== 'SPOTIFY_DEVICE_AUTH_SUCCESS') {
                    return;
                }

                if (event.data.deviceId && event.data.deviceId !== deviceId) {
                    return;
                }

                await refreshStatus();
            };

            windowScope.addEventListener('message', messageListener);
        }

        function destroy() {
            if (messageListener && windowScope?.removeEventListener) {
                windowScope.removeEventListener('message', messageListener);
            }
            messageListener = null;
        }

        function hideSetup() {
            removeSpotifyDeviceAuthSetup(documentScope);
        }

        function showSetup(reason) {
            return renderSpotifyDeviceAuthSetup(documentScope, {
                reason,
                onConnect: openConnectFlow,
            });
        }

        async function refreshStatus() {
            const payload = await fetchJson(endpoints.status, {
                method: 'POST',
                body: JSON.stringify({
                    device_id: deviceId,
                    device_pwd: devicePassword,
                }),
            });
            currentStatus = payload?.data || payload || null;

            if (currentStatus?.connected) {
                hideSetup();
                options.onConnected?.(currentStatus);
            } else {
                showSetup(currentStatus?.reason || 'Spotify bağlantısı gerekli');
                options.onMissing?.(currentStatus);
            }

            return currentStatus;
        }

        async function openConnectFlow() {
            const returnOrigin = typeof windowScope?.location?.origin === 'string'
                ? windowScope.location.origin
                : (
                    typeof windowScope?.location?.href === 'string'
                        ? new URL(windowScope.location.href).origin
                        : null
                );
            const startUrl = buildSpotifyDeviceAuthStartUrl(apiBaseUrl);
            const popup = windowScope?.open?.('', '_blank');

            try {
                const response = await fetchJson(startUrl, {
                    method: 'POST',
                    body: JSON.stringify({
                        device_id: deviceId,
                        device_pwd: devicePassword,
                        return_origin: returnOrigin,
                    }),
                });
                const authUrl = response?.data?.authUrl;
                if (typeof authUrl !== 'string') throw new Error('Spotify authorization URL was not returned');

                if (popup) {
                    popup.location.href = authUrl;
                    if (typeof popup.focus === 'function') popup.focus();
                } else if (windowScope?.location) {
                    windowScope.location.href = authUrl;
                }
                return authUrl;
            } catch (error) {
                popup?.close?.();
                throw error;
            }
        }

        ensureMessageListener();

        return {
            refreshStatus,
            openConnectFlow,
            showSetup,
            hideSetup,
            destroy,
            getStatus: () => currentStatus,
            isSetupVisible: () => Boolean(documentScope?.getElementById?.(SETUP_OVERLAY_ID)),
            endpoints,
        };
    }

    return {
        SETUP_OVERLAY_ID,
        buildSpotifyDeviceAuthEndpoints,
        buildSpotifyDeviceAuthStartUrl,
        createSpotifyDeviceAuthController,
        renderSpotifyDeviceAuthSetup,
        removeSpotifyDeviceAuthSetup,
    };
});
