/**
 * RadioTEDU Kiosk Web Application
 * Premium Jukebox Display System
 */

const LYRICS_RETRY_DELAYS_MS = [4000, 10000];

// Text goes through KioskI18n when it is loaded (always on the page; not in some unit tests).
function kioskI18n() {
    return (typeof window !== 'undefined' && window.KioskI18n) || (typeof globalThis !== 'undefined' && globalThis.KioskI18n) || null;
}

function kt(key, params) {
    return kioskI18n()?.t(key, params) ?? key;
}

/** `data-i18n` attributes for template strings, so a language switch re-translates the node. */
function ki(key, params) {
    return kioskI18n()?.attrs(key, params) ?? '';
}

/** past/active/future plus "near" for the line just before and the two after the active one. */
function lyricLineClass(index, activeIndex) {
    const state = index === activeIndex ? 'active' : index < activeIndex ? 'past' : 'future';
    const offset = index - activeIndex;
    const near = activeIndex === -1 ? index < 2 : (offset === -1 || offset === 1 || offset === 2);
    return near ? `lyric-line ${state} near` : `lyric-line ${state}`;
}

class KioskApp {
    constructor() {
        this.socket = null;
        this.device = null;
        this.kioskCredentialRenewalInterval = null;
        this.queueData = { now_playing: null, queue: [] };
        this.audioPlayer = document.getElementById('audioPlayer');
        this.spotifyController = null;
        this.spotifyDeviceId = null;
        this.spotifyReadyPromise = null;
        this.spotifyReadyResolve = null;
        this.spotifyPlayerState = null;
        this.spotifyDeviceAuthController = null;
        this.spotifyDeviceAuthStatus = null;
        this.spotifyDeviceAuthReady = false;
        this.spotifyDeviceAuthSetupState = this.loadSpotifyDeviceAuthSetupState();
        this.spotifyTrackEnding = false;
        this.progressInterval = null;
        this.isPlaying = false;
        this.waveformCanvas = document.getElementById('waveformCanvas');
        this.waveformCtx = this.waveformCanvas?.getContext('2d');
        this.visualStateTransitionTimer = null;

        // Lyrics State
        this.lyricsState = { trackKey: null, lines: [], plain: null, activeIndex: -1, synced: false };

        // Autoplay Logic
        this.autoplayTriggered = false;
        this.lastEmitTime = 0;

        // Debug Log
        this.logs = [];
        this.debugEl = this.createDebugOverlay();
        this.brandingController = window.KioskBranding?.initializeBrandLogoFallback?.() ?? null;
        this.extras = window.KioskExtras?.create?.(this) ?? null;

        this.init();
    }

    log(msg, type = 'info') {
        const entry = { time: new Date().toLocaleTimeString(), msg, type };
        console.log(`[${entry.time}] [${type}] ${msg}`);
        this.logs.unshift(entry);
        this.updateDebugOverlay();
    }

    createDebugOverlay() {
        const div = document.createElement('div');
        div.id = 'debugOverlay';
        div.style = 'position:fixed; bottom:10px; left:10px; width:300px; max-height:200px; background:rgba(0,0,0,0.8); color:#0f0; font-size:10px; padding:10px; overflow-y:auto; z-index:9999; border-radius:8px; display:none; pointer-events:none;';
        document.body.appendChild(div);

        // Toggle with 'D' key
        document.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'd') {
                div.style.display = div.style.display === 'none' ? 'block' : 'none';
            }
        });
        return div;
    }

    updateDebugOverlay() {
        if (!this.debugEl) return;
        this.debugEl.innerHTML = '<b>Debug (Press D to Toggle)</b><br>' +
            this.logs.slice(0, 20).map(l => `<span style="color:${l.type === 'error' ? 'red' : 'inherit'}">[${l.time}] ${l.msg}</span>`).join('<br>');
    }

    getSpotifyDeviceAuthSetupStateStorageKey() {
        return 'spotify_device_auth_setup_state';
    }

    loadSpotifyDeviceAuthSetupState() {
        try {
            const raw = localStorage.getItem(this.getSpotifyDeviceAuthSetupStateStorageKey());
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }

            return parsed;
        } catch (error) {
            console.warn('⚠️ Spotify auth setup state yüklenemedi:', error?.message || error);
            return null;
        }
    }

    saveSpotifyDeviceAuthSetupState(reason) {
        const state = {
            required: true,
            deviceId: this.device?.id || null,
            reason: reason || 'Spotify authorization required for this device',
            updatedAt: new Date().toISOString(),
        };

        this.spotifyDeviceAuthSetupState = state;

        try {
            localStorage.setItem(this.getSpotifyDeviceAuthSetupStateStorageKey(), JSON.stringify(state));
        } catch (error) {
            this.log(`⚠️ Spotify auth setup state kaydedilemedi: ${error.message}`, 'error');
        }

        return state;
    }

    clearSpotifyDeviceAuthSetupState() {
        this.spotifyDeviceAuthSetupState = null;

        try {
            localStorage.removeItem(this.getSpotifyDeviceAuthSetupStateStorageKey());
        } catch (error) {
            this.log(`⚠️ Spotify auth setup state silinemedi: ${error.message}`, 'error');
        }
    }

    hideSpotifyDeviceAuthSetupOverlay() {
        const overlay = document.getElementById('spotifyDeviceAuthSetupOverlay');
        if (overlay) {
            overlay.remove?.();
        }
    }

    showSpotifyDeviceAuthSetupOverlay(reason) {
        if (!window.KioskDeviceSpotifyAuth?.renderSpotifyDeviceAuthSetup) {
            return;
        }

        window.KioskDeviceSpotifyAuth.renderSpotifyDeviceAuthSetup(document, {
            reason: reason || kt('spotify.reasonRequired'),
            onConnect: () => this.openSpotifyDeviceAuthSetup(),
        });
    }

    isSpotifyDeviceAuthConnected() {
        if (!this.spotifyDeviceAuthController) {
            return this.spotifyDeviceAuthReady === true && !this.spotifyDeviceAuthSetupState?.required;
        }

        if (this.spotifyDeviceAuthStatus?.connected === false) {
            return false;
        }

        if (this.spotifyDeviceAuthSetupState?.required) {
            return false;
        }

        return true;
    }

    async setupSpotifyDeviceAuthFlow() {
        if (!window.KioskDeviceSpotifyAuth?.createSpotifyDeviceAuthController) {
            const status = {
                deviceId: this.device?.id || null,
                connected: false,
                reason: 'Spotify bağlantısı gerekli',
            };
            this.spotifyDeviceAuthStatus = status;
            this.spotifyDeviceAuthReady = false;
            this.saveSpotifyDeviceAuthSetupState(status.reason);
            this.showSpotifyDeviceAuthSetupOverlay(status.reason);
            return status;
        }

        this.spotifyDeviceAuthController = window.KioskDeviceSpotifyAuth.createSpotifyDeviceAuthController({
            apiBaseUrl: CONFIG.API_URL,
            deviceId: this.device?.id,
            devicePassword: localStorage.getItem('device_pwd') || '',
            document,
            fetch,
            window,
            onMissing: (status) => {
                this.spotifyDeviceAuthStatus = status;
                this.spotifyDeviceAuthReady = false;
                this.saveSpotifyDeviceAuthSetupState(status?.reason || 'Spotify bağlantısı gerekli');
                this.showSpotifyDeviceAuthSetupOverlay(status?.reason || 'Spotify bağlantısı gerekli');
            },
            onConnected: async (status) => {
                this.spotifyDeviceAuthStatus = status;
                this.spotifyDeviceAuthReady = true;
                this.clearSpotifyDeviceAuthSetupState();
                this.hideSpotifyDeviceAuthSetupOverlay();
                await this.resumeAfterSpotifyDeviceAuth();
            },
        });

        const status = await this.spotifyDeviceAuthController.refreshStatus();
        this.spotifyDeviceAuthStatus = status;
        this.spotifyDeviceAuthReady = Boolean(status?.connected);

        if (!status?.connected) {
            this.saveSpotifyDeviceAuthSetupState(status?.reason || 'Spotify bağlantısı gerekli');
            this.showSpotifyDeviceAuthSetupOverlay(status?.reason || 'Spotify bağlantısı gerekli');
        } else {
            this.clearSpotifyDeviceAuthSetupState();
        }

        return status;
    }

    async resumeAfterSpotifyDeviceAuth() {
        if (this.spotifyDeviceAuthController && !this.spotifyDeviceAuthReady) {
            return;
        }

        if (!this.spotifyController) {
            await this.initializeSpotifyPlayback();
        }

        if (!this.socket) {
            this.connectSocket();
        }

        if (!document.getElementById('startupOverlay')) {
            this.showStartupOverlay();
        }
    }

    async openSpotifyDeviceAuthSetup() {
        if (!this.spotifyDeviceAuthController) {
            await this.setupSpotifyDeviceAuthFlow();
        }

        if (!this.spotifyDeviceAuthController) {
            this.log('⚠️ Spotify device auth flow not available', 'error');
            return;
        }

        try {
            await this.spotifyDeviceAuthController.openConnectFlow();
        } catch (error) {
            this.log(`⚠️ Spotify bağlantı akışı açılamadı: ${error.message}`, 'error');
        }
    }

    isSpotifyDeviceAuthRequiredError(error) {
        return this.getSpotifyDeviceAuthRequiredMessage(error) !== null;
    }

    getSpotifyDeviceAuthRequiredMessage(error) {
        const message = error?.message || String(error || '');
        const normalized = message.toLowerCase();

        if (message.includes('No Spotify authorization found') ||
            message.includes('Spotify authorization expired for device') ||
            message.includes('Spotify bağlantısı gerekli') ||
            message.includes('Please reconnect Spotify for this kiosk')) {
            return message;
        }

        if (message.includes('Spotify Premium hesabı gerekli') ||
            normalized.includes('premium required') ||
            normalized.includes('premium is required')) {
            return 'Spotify Premium hesabı gerekli';
        }

        if (message.includes('Spotify yetkileri eksik') ||
            normalized.includes('insufficient client scope') ||
            normalized.includes('insufficient scope')) {
            return message.includes('Spotify yetkileri eksik') ? message : 'Spotify yetkileri eksik';
        }

        if (normalized.includes('authentication failed') ||
            normalized.includes('authentication error')) {
            return 'Spotify bağlantısı gerekli';
        }

        return null;
    }

    getDevicePasswordForApi() {
        return localStorage.getItem('device_pwd') || '';
    }

    // ===== Initialization =====
    async init() {
        console.log('🎵 RadioTEDU Kiosk başlatılıyor...');

        // Check if device code exists
        if (!CONFIG.DEVICE_CODE) {
            this.showDeviceSetupOverlay();
            return;
        }

        // Setup canvas size
        this.setupWaveform();

        // Generate QR Code
        this.generateQRCode();

        // Setup audio player events
        this.setupAudioPlayer();

        try {
            await this.registerDevice();
            if (!this.device) return;
        } catch (err) {
            this.log(`❌ Başlatma hatası: ${err.message}`, 'error');
            this.showDeviceSetupOverlay();
            return;
        }

        try {
            await this.setupSpotifyDeviceAuthFlow();
            if (this.spotifyDeviceAuthReady) {
                await this.resumeAfterSpotifyDeviceAuth();
            } else {
                this.connectSocket();
                if (!document.getElementById('startupOverlay')) {
                    this.showStartupOverlay();
                }
            }
        } catch (err) {
            this.log(`⚠️ Spotify kurulum akışı sınırlı başlatıldı: ${err.message}`, 'error');
            this.spotifyDeviceAuthReady = false;
            this.connectSocket();
            if (!document.getElementById('startupOverlay')) {
                this.showStartupOverlay();
            }
        }

        // Setup fullscreen on double click
        this.setupFullscreenToggle();

        // Setup logout button
        this.setupLogoutButton();

        // Interaction Overlay once Spotify auth is ready
        if (this.spotifyDeviceAuthReady && !document.getElementById('startupOverlay')) {
            this.showStartupOverlay();
        }

        // Setup window resize handler
        window.addEventListener('resize', () => this.setupWaveform());
    }

    showDeviceSetupOverlay() {
        const div = document.createElement('div');
        div.id = 'deviceSetupOverlay';
        div.className = 'device-setup-overlay';
        div.innerHTML = `
            <div class="device-setup-card">
                <div class="device-setup-icon" aria-hidden="true">
                    <span class="material-symbols-rounded">settings</span>
                </div>
                <h2 class="device-setup-title" ${ki('setup.title')}>${kt('setup.title')}</h2>
                <p class="device-setup-message" ${ki('setup.message')}>${kt('setup.message')}</p>
                <div class="device-setup-form">
                    <input class="device-setup-input" type="text" id="setupDeviceCode" data-i18n-attr="placeholder:setup.codePlaceholder" placeholder="${kt('setup.codePlaceholder')}">
                    <input class="device-setup-input" type="password" id="setupDevicePassword" data-i18n-attr="placeholder:setup.provisioningPlaceholder" placeholder="${kt('setup.provisioningPlaceholder')}">
                    <button class="device-setup-button" id="saveDeviceCode" ${ki('setup.save')}>${kt('setup.save')}</button>
                </div>
                <p class="device-setup-footnote" ${ki('setup.footnote')}>${kt('setup.footnote')}</p>
            </div>
        `;
        document.body.appendChild(div);

        const input = div.querySelector('#setupDeviceCode');
        const pwdInput = div.querySelector('#setupDevicePassword');
        const button = div.querySelector('#saveDeviceCode');

        // Pre-fill if exists
        if (input) input.value = localStorage.getItem('device_code') || '';
        if (pwdInput) pwdInput.value = localStorage.getItem('kiosk_provisioning_code') || '';

        const save = () => {
            const code = input.value.trim().toUpperCase();
            const pwd = pwdInput.value.trim();
            if (code && pwd) {
                this.persistDeviceSetupCredentials(code, pwd);
            }
        };

        if (button) button.onclick = save;
        if (input) input.onkeydown = (e) => { if (e.key === 'Enter') pwdInput?.focus(); };
        if (pwdInput) pwdInput.onkeydown = (e) => { if (e.key === 'Enter') save(); };
    }

    persistDeviceSetupCredentials(code, provisioningCode) {
        try {
            localStorage.setItem('device_code', code);
            localStorage.removeItem('device_pwd');
            localStorage.setItem('kiosk_provisioning_code', provisioningCode);
        } catch (error) {
            this.log(`⚠️ Cihaz bilgileri localStorage'a yazılamadı: ${error.message}`, 'error');
        }

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('code', code);
        nextUrl.searchParams.delete('pwd');

        window.location.href = nextUrl.toString();
    }

    // ===== Logout Button =====
    setupLogoutButton() {
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.onclick = () => this.logout();
        }
    }

    logout() {
        this.log('🚪 Çıkış yapılıyor...');

        // Stop audio
        if (this.audioPlayer) {
            this.audioPlayer.pause();
            this.audioPlayer.src = '';
        }

        // Disconnect socket
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        if (this.spotifyController) {
            this.reportSpotifyPlaybackDeviceState(false);
            this.spotifyController.disconnect();
            this.spotifyController = null;
        }
        if (this.spotifyDeviceAuthController?.destroy) {
            this.spotifyDeviceAuthController.destroy();
        }
        this.spotifyDeviceAuthController = null;
        this.spotifyDeviceAuthStatus = null;
        this.spotifyDeviceAuthReady = false;
        this.hideSpotifyDeviceAuthSetupOverlay();
        this.spotifyDeviceId = null;
        this.spotifyReadyPromise = null;
        this.spotifyReadyResolve = null;
        this.spotifyPlayerState = null;

        // Clear device data
        this.device = null;
        this.queueData = { now_playing: null, queue: [] };

        // Clear stored credentials
        localStorage.removeItem('device_code');
        localStorage.removeItem('device_pwd');
        localStorage.removeItem('kiosk_provisioning_code');
        if (this.kioskCredentialRenewalInterval) clearInterval(this.kioskCredentialRenewalInterval);
        this.kioskCredentialRenewalInterval = null;

        // Show setup overlay again
        this.showDeviceSetupOverlay();
    }

    showStartupOverlay() {
        const div = document.createElement('div');
        div.id = 'startupOverlay';
        div.className = 'startup-overlay';
        const showSpotifyConnectCta = !this.spotifyDeviceAuthReady || !this.isSpotifyDeviceAuthConnected();
        // Build the card in one string: appending to innerHTML would let the browser
        // auto-close the card first and push the Spotify button outside it.
        const spotifyConnectCta = showSpotifyConnectCta ? `
                <button id="startupSpotifyConnectButton" class="startup-button" type="button" ${ki('startup.spotifyConnect')}>${kt('startup.spotifyConnect')}</button>
                <p class="startup-footnote" ${ki('startup.spotifyFootnote')}>${kt('startup.spotifyFootnote')}</p>
            ` : '';
        div.innerHTML = `
            <div class="startup-card">
                <div class="startup-icon" aria-hidden="true">
                    <span class="material-symbols-rounded">music_note</span>
                </div>
                <h2 class="startup-title" ${ki('startup.title')}>${kt('startup.title')}</h2>
                <p class="startup-message" ${ki('startup.message')}>${kt('startup.message')}</p>
                ${spotifyConnectCta}
            </div>
        `;
        div.onclick = (event) => {
            if (event?.target?.id === 'startupSpotifyConnectButton') {
                return;
            }
            div.remove();
            this.log('🚀 Jukebox kullanıcı tarafından başlatıldı');
            this.activateSpotifyPlayback();
            this.checkAndPlayNext();
        };
        document.body.appendChild(div);
        const spotifyConnectButton = typeof div.querySelector === 'function'
            ? div.querySelector('#startupSpotifyConnectButton')
            : null;
        if (spotifyConnectButton) {
            spotifyConnectButton.onclick = async (event) => {
                event?.stopPropagation?.();
                await this.openSpotifyDeviceAuthSetup();
            };
        }
    }

    // ===== Waveform Visualization =====
    setupWaveform() {
        if (!this.waveformCanvas) return;

        const rect = this.waveformCanvas.parentElement.getBoundingClientRect();
        this.waveformCanvas.width = rect.width;
        this.waveformCanvas.height = rect.height;
        this.drawWaveform();
    }

    drawWaveform(progressPercent = this.waveformProgress ?? 0) {
        if (!this.waveformCtx) return;

        const ctx = this.waveformCtx;
        const width = this.waveformCanvas.width;
        const height = this.waveformCanvas.height;
        this.waveformProgress = progressPercent;

        ctx.clearRect(0, 0, width, height);

        // Fake waveform bars, generated once per song so progress redraws do not flicker.
        const barCount = 80;
        if (!this.waveformBars || this.waveformBars.length !== barCount) {
            this.waveformBars = Array.from({ length: barCount }, () => Math.random() * 0.8 + 0.12);
        }
        const barWidth = width / barCount - 2;
        const playedBars = Math.round((progressPercent / 100) * barCount);

        // RadioTEDU studio equalizer: played bars in full red, the rest dimmed.
        for (let i = 0; i < barCount; i++) {
            const barHeight = this.waveformBars[i] * height;
            const x = i * (barWidth + 2);
            const y = height - barHeight;

            const accentPeak = i % 7 === 3;
            if (i < playedBars) {
                ctx.fillStyle = accentPeak ? '#5AD1E6' : '#ED1C24';
            } else {
                ctx.fillStyle = accentPeak ? 'rgba(90, 209, 230, 0.28)' : 'rgba(237, 28, 36, 0.28)';
            }
            ctx.fillRect(x, y, barWidth, barHeight);
        }
    }

    // ===== QR Code =====
    generateQRCode() {
        const qrContainer = document.getElementById('qrCode');
        const qrLink = CONFIG.QR_LINK_FORMAT.replace('{DEVICE_CODE}', CONFIG.DEVICE_CODE);

        this.log(`🔗 QR Linki: ${qrLink}`);

        // Set initial state
        qrContainer.innerHTML = `<div class="qr-loading" style="font-size:10px" ${ki('qr.loading')}>${kt('qr.loading')}</div>`;

        // Direct Text Link (Always visible)
        // Big, distance-readable device code; the full link stays for anyone without a camera.
        const hint = document.querySelector('.qr-hint');
        if (hint) {
            const shortLink = qrLink.replace(/^https?:\/\//, '');
            hint.innerHTML = `
                <span class="qr-code-label" ${ki('qr.code')}>${kt('qr.code')}</span>
                <strong class="qr-device-code">${this.escapeHtml(CONFIG.DEVICE_CODE)}</strong>
                <a class="qr-link" href="${this.escapeHtml(qrLink)}">${this.escapeHtml(shortLink)}</a>`;
        }

        if (typeof QRCode !== 'undefined') {
            QRCode.toCanvas(document.createElement('canvas'), qrLink, {
                width: 360,
                margin: 2,
                color: { dark: '#0b0b0c', light: '#f7f7f4' }
            }, (error, canvas) => {
                if (!error) {
                    this.log('✅ QR Code (JS) başarıyla oluşturuldu');
                    qrContainer.innerHTML = '';
                    qrContainer.appendChild(canvas);
                    canvas.style.width = '100%';
                    canvas.style.height = '100%';
                    return;
                }
                this.log(`⚠️ QR JS Hatası: ${error.message}`, 'error');
                this.useQRFallback(qrLink);
            });
        } else {
            this.log('⚠️ QRCode kütüphanesi bulunamadı, API deneniyor', 'error');
            this.useQRFallback(qrLink);
        }
    }

    useQRFallback(link) {
        const qrContainer = document.getElementById('qrCode');
        const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(link)}`;

        const img = new Image();
        img.src = qrApiUrl;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.borderRadius = '12px';
        img.onload = () => {
            this.log('✅ QR Code (API) başarıyla yüklendi');
            qrContainer.innerHTML = '';
            qrContainer.appendChild(img);
        };
        img.onerror = () => {
            this.log('❌ QR API de başarısız!', 'error');
            qrContainer.innerHTML = `<div style="font-size:12px; color:red" ${ki('qr.failed')}>${kt('qr.failed')}</div>`;
        };
    }

    async initializeSpotifyPlayback() {
        if (!this.device || !window.KioskSpotifyPlayer) {
            return null;
        }

        if (!this.isSpotifyDeviceAuthConnected()) {
            return null;
        }

        if (this.spotifyController) {
            return this.spotifyController;
        }

        if (!this.spotifyReadyPromise) {
            this.spotifyReadyPromise = new Promise((resolve) => {
                this.spotifyReadyResolve = resolve;
            });
        }

        try {
            await window.KioskSpotifyPlayer.loadSpotifySdk({ root: window });

            this.spotifyController = window.KioskSpotifyPlayer.createSpotifyPlayer({
                root: window,
                deviceId: this.device.id,
                playerName: this.device.name || `RadioTEDU ${this.device.device_code || ''}`.trim(),
                getOAuthToken: async () => {
                    const response = await fetch(`${CONFIG.API_URL}/api/v1/jukebox/kiosk/spotify-token`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            device_id: this.device.id,
                            device_pwd: this.getDevicePasswordForApi(),
                        }),
                    });
                    if (!response.ok) {
                        const errData = await response.json().catch(() => ({}));
                        throw new Error(errData.error || `Spotify token request failed (${response.status})`);
                    }

                    const payload = await response.json();
                    return payload.data.access_token;
                },
                onReady: async (payload) => {
                    this.spotifyDeviceId = payload.spotify_device_id || null;
                    this.spotifyPlayerState = payload.player_state || this.spotifyPlayerState;

                    try {
                        await this.registerSpotifyPlaybackDevice(payload);
                    } catch (error) {
                        this.log(`❌ Spotify cihaz kaydı başarısız: ${error.message}`, 'error');
                    } finally {
                        if (this.spotifyReadyResolve) {
                            this.spotifyReadyResolve(payload);
                            this.spotifyReadyResolve = null;
                        }
                    }
                },
                onNotReady: (payload) => {
                    const offlineDeviceId = payload?.spotify_device_id || payload?.device_id || this.spotifyDeviceId;
                    this.reportSpotifyPlaybackDeviceState(false, offlineDeviceId);
                    if (payload?.spotify_device_id && payload.spotify_device_id === this.spotifyDeviceId) {
                        this.spotifyDeviceId = null;
                    }
                    this.spotifyPlayerState = null;
                    this.isPlaying = false;
                    this.stopProgressUpdate();
                    this.showIdleState();
                },
                onStateChange: (state) => this.handleSpotifyPlayerStateChange(state),
                onAutoplayFailed: () => this.log('⚠️ Spotify autoplay başarısız oldu', 'error'),
                onError: (error) => {
                    const message = error?.message || String(error || '');
                    if (message.includes('No supported keysystem') || message.includes('Failed to initialize player') || message.includes('initialization_error') || message.includes('EMEError')) {
                        console.warn('ℹ️ Tarayıcı DRM desteklemiyor, Spotify Connect ile masaüstü oynatıcı kullanılıyor.');
                        this.spotifyController = null;
                        this.spotifyReadyPromise = null;
                        this.spotifyReadyResolve = null;
                        return;
                    }

                    const authRequiredMessage = this.getSpotifyDeviceAuthRequiredMessage(error);
                    if (authRequiredMessage) {
                        this.saveSpotifyDeviceAuthSetupState(authRequiredMessage);
                        this.spotifyDeviceAuthReady = false;
                        this.showSpotifyDeviceAuthSetupOverlay(authRequiredMessage);
                        const controller = this.spotifyController;
                        this.spotifyController = null;
                        this.spotifyReadyPromise = null;
                        this.spotifyReadyResolve = null;
                        try {
                            controller?.disconnect?.();
                        } catch (disconnectError) {
                            this.log(`⚠️ Spotify player kapatılamadı: ${disconnectError.message}`, 'error');
                        }
                        this.log(`⚠️ Spotify bağlantısı gerekli: ${authRequiredMessage}`, 'error');
                        return;
                    }
                    this.log(`❌ Spotify player uyarısı: ${error.message || error}`, 'warn');
                },
            });

            const connected = await this.spotifyController.connect();
            if (connected === false) {
                throw new Error('Spotify player failed to connect');
            }
            this.clearSpotifyDeviceAuthSetupState();
            return this.spotifyController;
        } catch (error) {
            const authRequiredMessage = this.getSpotifyDeviceAuthRequiredMessage(error);
            if (authRequiredMessage) {
                this.saveSpotifyDeviceAuthSetupState(authRequiredMessage);
                this.spotifyDeviceAuthReady = false;
                this.showSpotifyDeviceAuthSetupOverlay(authRequiredMessage);
            }
            this.log(`⚠️ Spotify başlatılamadı: ${error.message}`, 'error');
            this.spotifyController = null;
            this.spotifyReadyPromise = null;
            this.spotifyReadyResolve = null;
            return null;
        }
    }

    async ensureSpotifyPlaybackReady() {
        if (!this.spotifyController) {
            await this.initializeSpotifyPlayback();
        }

        if (this.spotifyReadyPromise) {
            try {
                await Promise.race([
                    this.spotifyReadyPromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Spotify player readiness timeout')), 10000)),
                ]);
            } catch (error) {
                const controller = this.spotifyController;
                this.spotifyController = null;
                this.spotifyReadyPromise = null;
                this.spotifyReadyResolve = null;
                this.spotifyDeviceId = null;
                this.spotifyPlayerState = null;
                try {
                    controller?.disconnect?.();
                } catch (disconnectError) {
                    this.log(`⚠️ Spotify player kapatılamadı: ${disconnectError.message}`, 'error');
                }
                throw error;
            }
        }

        return this.spotifyController;
    }

    reportSpotifyPlaybackDeviceState(isActive, spotifyDeviceId = this.spotifyDeviceId) {
        if (!this.device) {
            return Promise.resolve();
        }

        return fetch(`${CONFIG.API_URL}/api/v1/jukebox/kiosk/spotify-device`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
            body: JSON.stringify({
                device_id: this.device.id,
                device_pwd: this.getDevicePasswordForApi(),
                spotify_device_id: spotifyDeviceId || null,
                player_name: this.device.name || null,
                is_active: isActive,
            }),
        }).catch((error) => {
            this.log(`âš ï¸ Spotify cihaz durumu bildirilemedi: ${error.message}`, 'error');
        });
    }

    async registerSpotifyPlaybackDevice(payload) {
        const response = await fetch(`${CONFIG.API_URL}/api/v1/jukebox/kiosk/spotify-device`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
                {
                    ...window.KioskSpotifyPlayer.buildSpotifyRegistrationPayload({
                        deviceId: this.device.id,
                        spotifyDeviceId: payload.spotify_device_id,
                        playerName: payload.player_name || this.device.name || null,
                        state: payload.player_state || null,
                    }),
                    device_pwd: this.getDevicePasswordForApi(),
                }
            ),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Spotify device registration failed (${response.status})`);
        }

        return response.json();
    }

    activateSpotifyPlayback() {
        if (this.spotifyController?.activateElement) {
            try {
                this.spotifyController.activateElement();
            } catch (error) {
                this.log(`⚠️ Spotify activateElement hatası: ${error.message}`, 'error');
            }
        }
    }

    handleSpotifyPlayerStateChange(state) {
        const previousState = this.spotifyPlayerState;
        this.spotifyPlayerState = state;
        const activeSpotifyQueueItem = this.queueData?.now_playing?.playback_type === 'spotify';

        const trackEnded = Boolean(state?.track_ended)
            || Boolean(
                previousState?.track_uri
                && !state?.track_uri
                && previousState.duration_ms
                && previousState.position_ms >= Math.max(0, previousState.duration_ms - 1500)
            );

        if (trackEnded) {
            this.handleSpotifyTrackEnded();
            return;
        }

        this.isPlaying = !state?.paused;

        if (this.isPlaying) {
            this.startProgressUpdate();
            this.syncNowPlayingUi();
        } else if (state?.track_uri || activeSpotifyQueueItem) {
            this.startProgressUpdate();
        } else {
            this.stopProgressUpdate();
        }
    }

    syncNowPlayingUi() {
        if (window.KioskPlayback?.shouldSyncNowPlayingView) {
            const shouldSync = window.KioskPlayback.shouldSyncNowPlayingView({
                nowPlaying: this.queueData?.now_playing,
                isPlaying: this.isPlaying,
                spotifyTrackUri: this.spotifyPlayerState?.track_uri || null,
                startupBlocked: Boolean(document.getElementById('startupOverlay')),
            });

            if (shouldSync) {
                this.showPlayingState(this.queueData.now_playing);
            }
            return;
        }

        const nextNowPlaying = this.queueData?.now_playing || null;
        if (!nextNowPlaying) {
            if (this.currentPlayingSong && !this.audioPlayer.src) {
                this.stopPlayback();
            }
            return;
        }

        const isDifferentSong = !this.currentPlayingSong ||
            (nextNowPlaying.id && this.currentPlayingSong.id !== nextNowPlaying.id) ||
            (nextNowPlaying.song_id && this.currentPlayingSong.song_id !== nextNowPlaying.song_id) ||
            (nextNowPlaying.title !== this.currentPlayingSong.title);

        if (isDifferentSong) {
            console.log('🎵 Kiosk now_playing değişti:', nextNowPlaying.title);
            this.currentPlayingSong = nextNowPlaying;
            this.isPlaying = true;
            this.playbackStartedAt = Date.now();
            this.liveSpotifyState = null;
            this.lastSpotifyPoll = 0;
            this.trackTransitioning = false;
            this.autoplayTriggered = false;
            this.showPlayingState(nextNowPlaying);
            this.startProgressUpdate();
        }
    }

    handleSpotifyTrackEnded() {
        if (this.spotifyTrackEnding) {
            return;
        }

        this.spotifyTrackEnding = true;
        this.stopPlayback();
        setTimeout(() => {
            this.spotifyTrackEnding = false;
        }, 0);
    }

    pauseSpotifyPlayback() {
        const player = this.spotifyController?.player;
        if (!player || typeof player.pause !== 'function') {
            return;
        }

        if (this.spotifyPlayerState?.paused) {
            return;
        }

        Promise.resolve(player.pause()).catch((error) => {
            this.log(`âš ï¸ Spotify durdurma hatasÄ±: ${error.message}`, 'error');
        });
    }

    async refreshSpotifyPlaybackStateFromSdk() {
        const player = this.spotifyController?.player;
        const mapSpotifyPlayerState = window.KioskSpotifyPlayer?.mapSpotifyPlayerState;
        const shouldPollSpotify = Boolean(
            this.queueData?.now_playing?.playback_type === 'spotify'
            || this.spotifyPlayerState?.track_uri
        );

        if (!shouldPollSpotify || !player || typeof player.getCurrentState !== 'function' || typeof mapSpotifyPlayerState !== 'function') {
            return this.spotifyPlayerState;
        }

        try {
            const previousState = this.spotifyPlayerState;
            const sdkState = await player.getCurrentState();
            const mappedState = mapSpotifyPlayerState(sdkState, previousState);
            if (!mappedState) {
                return this.spotifyPlayerState;
            }

            this.spotifyPlayerState = mappedState;

            if (mappedState.track_ended) {
                this.handleSpotifyTrackEnded();
                return this.spotifyPlayerState;
            }

            if (mappedState.track_uri) {
                this.isPlaying = !mappedState.paused;
                if (this.isPlaying) {
                    this.syncNowPlayingUi();
                }
            } else if (sdkState === null) {
                this.isPlaying = false;
            }

            return this.spotifyPlayerState;
        } catch (error) {
            this.log(`âš ï¸ Spotify state yenileme hatasÄ±: ${error.message}`, 'error');
            return this.spotifyPlayerState;
        }
    }

    // ===== Device Registration =====
    async registerDevice() {
        try {
            const credential = localStorage.getItem('device_pwd') || '';
            const provisioningCode = localStorage.getItem('kiosk_provisioning_code') || '';
            const registrationAuth = credential ? { credential } : (provisioningCode ? { provisioning_code: provisioningCode } : {});
            const response = await fetch(`${CONFIG.API_URL}/api/v1/jukebox/kiosk/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_code: CONFIG.DEVICE_CODE, ...registrationAuth })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const error = new Error(`Registration failed (${response.status}): ${errData.error || 'Unknown'}`);
                error.status = response.status;
                error.code = errData.code;
                throw error;
            }

            const data = await response.json();

            // Backend sends { success: true, data: { device: ... } }
            const deviceData = data.data ? data.data.device : data.device;

            if (!deviceData) {
                throw new Error('Device data missing in response');
            }

            if (data.data?.credential) {
                localStorage.setItem('device_pwd', data.data.credential);
                localStorage.removeItem('kiosk_provisioning_code');
            }
            if (!this.kioskCredentialRenewalInterval) {
                this.kioskCredentialRenewalInterval = setInterval(() => this.registerDevice(), 12 * 60 * 60 * 1000);
            }

            this.device = deviceData;

            // Ensure we join the room if socket is already connected
            if (this.socket && this.socket.connected) {
                this.socket.emit('join_device', this.device.id);
                this.log(`🏠 ${this.device.id} odasına katıldı (kayıt sonrası)`);
            }

            // Update UI
            const locationEl = document.getElementById('deviceLocation');
            if (locationEl) {
                locationEl.textContent = this.device.location || this.device.name || CONFIG.DEVICE_CODE;
            }

            this.log('✅ Cihaz kayıtlı:', this.device);

        } catch (error) {
            this.log(`❌ Kayıt hatası: ${error.message}`, 'error');
            this.updateConnectionStatus('error', 'status.error');

            if (error.status === 403) {
                localStorage.removeItem('device_pwd');
                if (error.code === 'INVALID_PROVISIONING_CODE') localStorage.removeItem('kiosk_provisioning_code');
                if (!document.getElementById('deviceSetupOverlay')) this.showDeviceSetupOverlay();
                return;
            }

            if (error.status === 400) {
                if (!document.getElementById('deviceSetupOverlay')) this.showDeviceSetupOverlay();
                return;
            }

            if (error.message.includes('404')) {
                // Invalid code - reset and show setup
                const qrContainer = document.getElementById('qrCode');
                if (qrContainer) {
                    qrContainer.innerHTML = `
                        <div style="font-size:12px; color:#ff4444; padding:10px;">
                            <b><span ${ki('qr.invalidCode')}>${kt('qr.invalidCode')}</span>: ${this.escapeHtml(CONFIG.DEVICE_CODE)}</b><br><br>
                            <span ${ki('qr.notRegistered')}>${kt('qr.notRegistered')}</span>
                            <button onclick="localStorage.removeItem('device_code'); location.reload();" 
                                style="margin-top:10px; padding:5px 10px; background:#dc2626; color:white; border:none; border-radius:4px; font-size:10px; cursor:pointer;">
                                <span ${ki('qr.resetCode')}>${kt('qr.resetCode')}</span>
                            </button>
                        </div>`;
                }
            }

            // Helpful debug for user
            const qrContainer = document.getElementById('qrCode');
            if (qrContainer && qrContainer.querySelector?.('.qr-loading')) {
                qrContainer.innerHTML = `<div style="font-size:10px; color:gray"><span ${ki('qr.backendUnreachable')}>${kt('qr.backendUnreachable')}</span><br>${this.escapeHtml(CONFIG.API_URL)}</div>`;
            }
            // Retry after delay (only if not 404)
            if (!error.message.includes('404')) {
                setTimeout(() => this.registerDevice(), CONFIG.RECONNECT_INTERVAL);
            }
        }
    }

    // ===== WebSocket Connection =====
    connectSocket() {
        if (typeof io === 'undefined') {
            console.warn('Socket.IO library not loaded');
            return;
        }

        this.socket = io(CONFIG.WS_URL, {
            path: CONFIG.SOCKET_PATH || '/socket.io',
            auth: {
                deviceId: this.device?.id || '',
                devicePassword: this.getDevicePasswordForApi(),
            },
        });

        this.socket.on('connect', () => {
            this.log('🔌 Socket bağlandı');
            this.updateConnectionStatus('connected', 'status.connected');

            if (this.device) {
                this.socket.emit('join_device', this.device.id);
                this.log(`🏠 ${this.device.id} odasına katıldı`);
                this.loadInitialQueue();

                // Periodic queue sync to guarantee perfect state match
                if (this.queueSyncInterval) clearInterval(this.queueSyncInterval);
                this.queueSyncInterval = setInterval(() => {
                    if (this.device) {
                        this.loadInitialQueue();
                    }
                }, 3000);

                // Heartbeat to test connectivity
                if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = setInterval(() => {
                    if (this.socket && this.socket.connected) {
                        this.socket.emit('kiosk_heartbeat', { device_id: this.device.id, timestamp: Date.now() });
                    }
                }, 5000);
            } else {
                this.log('⚠️ Cihaz kaydı henüz tamamlanmadı, oda katılımı bekleniyor');
            }
        });

        this.socket.on('disconnect', () => {
            console.log('🔌 Socket bağlantısı kesildi');
            this.updateConnectionStatus('error', 'status.disconnected');
        });

        this.socket.on('queue_updated', (data) => {
            console.log('📋 Kuyruk güncellendi:', data);
            this.extras?.onQueueUpdated(data);
            this.queueData = data;
            this.renderQueue();
            this.syncNowPlayingUi();
            this.checkAndPlayNext();
        });

        this.socket.on('song_skipped', () => {
            console.log('⏭️ Şarkı atlandı');
            this.pauseSpotifyPlayback();
            this.playNextFromQueue();
        });

        this.socket.on('song_rejected', () => {
            console.log('🚫 Şarkı reddedildi (DJ Scratch)');
            this.handleSongRejected();
        });
    }

    async handleSongRejected() {
        const albumContainer = document.querySelector('.album-container');
        if (albumContainer) {
            albumContainer.classList.add('dj-scratch-active');

            // Keep this in sync with .dj-scratch-active in CSS.
            await new Promise(resolve => setTimeout(resolve, 900));

            albumContainer.classList.remove('dj-scratch-active');
        }
        this.playNextFromQueue();
    }

    // ===== Load Initial Queue =====
    async loadInitialQueue() {
        if (!this.device) return;

        try {
            const response = await fetch(`${CONFIG.API_URL}/api/v1/jukebox/queue/${this.device.id}`, {
                headers: { 'x-kiosk-credential': this.getDevicePasswordForApi() },
            });
            if (!response.ok) throw new Error('Queue fetch failed');

            this.queueData = await response.json();
            this.extras?.seedQueue(this.queueData);
            this.renderQueue();
            this.syncNowPlayingUi();
            this.checkAndPlayNext();

        } catch (error) {
            console.error('Kuyruk yüklenemedi:', error);
        }
    }

    // ===== Audio Player Setup =====
    setupAudioPlayer() {
        this.audioPlayer.addEventListener('ended', () => {
            console.log('🎵 Şarkı bitti');
            this.playNextFromQueue();
        });

        this.audioPlayer.addEventListener('error', (e) => {
            // Don't retry if we deliberately cleared the source (stopPlayback) 
            // Also avoid infinite loop if no src
            if (!this.audioPlayer.src || this.audioPlayer.src === window.location.href || this.audioPlayer.src.includes('://:')) {
                this.isPlaying = false;
                return;
            }

            console.error('Audio error:', e);
            setTimeout(() => this.playNextFromQueue(), 2000);
        });

        this.audioPlayer.addEventListener('playing', () => {
            this.isPlaying = true;
            this.startProgressUpdate();
        });

        this.audioPlayer.addEventListener('pause', () => {
            this.isPlaying = false;
            this.stopProgressUpdate();
        });

        this.audioPlayer.addEventListener('loadedmetadata', () => {
            this.updateProgress();
        });
    }

    // ===== Playback Control =====
    checkAndPlayNext() {
        if (document.getElementById('startupOverlay')) {
            this.log('⏳ Başlatma bekleniyor (Tıklayın)...');
            return;
        }

        // Do not interrupt or restart currently playing song!
        if (this.isPlaying) {
            return;
        }

        // If there is already an active now_playing track, sync UI state without restarting playback from 0:00!
        if (this.queueData.now_playing) {
            this.isPlaying = true;
            this.currentPlayingSong = this.queueData.now_playing;
            if (!this.playbackStartedAt) {
                this.playbackStartedAt = Date.now();
            }
            this.startProgressUpdate();
            this.showPlayingState(this.queueData.now_playing);
            return;
        }

        if (this.queueData.queue && this.queueData.queue.length > 0) {
            this.playSong(this.queueData.queue[0]);
        } else {
            // Trigger autoplay if nothing is playing and queue is empty
            this.triggerAutoplay();
        }
    }

    playNextFromQueue() {
        if (this.queueData.queue && this.queueData.queue.length > 0) {
            this.playSong(this.queueData.queue[0]);
        } else {
            this.log('🔄 Kuyruk bitti, otomatik şarkı isteniyor...');
            // Notify server we finished
            this.stopPlayback();

            // Trigger autoplay immediately instead of waiting for 80% rule
            this.triggerAutoplay();
        }
    }

    triggerAutoplay() {
        if (!this.device || this.autoplayTriggered) return;

        this.autoplayTriggered = true;
        this.log('🤖 Autoplay tetikleniyor...');

        fetch(`${CONFIG.API_URL}/api/v1/jukebox/autoplay/trigger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                device_id: this.device.id,
                device_pwd: this.getDevicePasswordForApi(),
            })
        }).then(r => r.json())
            .then(d => {
                this.log(`🤖 Otomatik eklendi: ${d.data?.song_title || 'Şarkı'}`);
                // Resulting queue_updated broadcast will trigger playNext/checkNext
            })
            .catch(e => {
                console.error(e);
                this.autoplayTriggered = false; // Allow retry on failure
            });
    }

    async skipUnsupportedSong(song, reason) {
        this.log(`⚠️ ${reason}: ${song.title}`, 'error');
        this.isPlaying = false;
        this.showIdleState();

        if (!this.device) {
            return;
        }

        const songId = song.song_id || song.id;
        if (!songId) {
            return;
        }

        try {
            await fetch(`${CONFIG.API_URL}/api/v1/jukebox/kiosk/now-playing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_id: this.device.id,
                    device_pwd: this.getDevicePasswordForApi(),
                    song_id: songId
                })
            });

            await fetch(`${CONFIG.API_URL}/api/v1/jukebox/kiosk/now-playing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_id: this.device.id,
                    device_pwd: this.getDevicePasswordForApi(),
                    song_id: null
                })
            });

            await this.loadInitialQueue();
        } catch (error) {
            this.log(`❌ Desteklenmeyen şarkı atlama hatası: ${error.message}`, 'error');
        }
    }

    async playSong(song) {
        if (this.isPlaying && this.currentPlayingSong) {
            const isSameSong = (song.song_id && this.currentPlayingSong.song_id === song.song_id) ||
                               (song.id && (this.currentPlayingSong.id === song.id || this.currentPlayingSong.song_id === song.id)) ||
                               (song.spotify_uri && this.currentPlayingSong.spotify_uri === song.spotify_uri);
            if (isSameSong) {
                console.log('⏭️ Bu şarkı zaten çalıyor, yeniden başlatılmadı:', song.title);
                return;
            }
        }

        console.log('▶️ Çalınıyor:', song.title);

        try {
            const playbackPlan = window.KioskPlayback.getSongPlaybackPlan(song, CONFIG.API_URL);

            // Reset autoplay flag for new song
            this.autoplayTriggered = false;

            if (playbackPlan.kind === 'spotify') {
                if (!this.isSpotifyDeviceAuthConnected()) {
                    this.showSpotifyDeviceAuthSetupOverlay(this.spotifyDeviceAuthSetupState?.reason || 'Spotify bağlantısı gerekli');
                    return;
                }
                await this.playSpotifySong(song);
                return;
            }

            if (playbackPlan.kind !== 'local' || !playbackPlan.audioUrl) {
                await this.skipUnsupportedSong(song, 'Geçerli bir local audio kaynağı bulunamadı');
                return;
            }

            const audioUrl = playbackPlan.audioUrl;

            // Prevent loop: Don't re-play if same URL is already playing
            if (this.audioPlayer.src.includes(audioUrl) && this.isPlaying) {
                console.log('⏭️ Şarkı zaten çalıyor, atlandı');
                return;
            }

            this.pauseSpotifyPlayback();
            this.spotifyPlayerState = null;
            // LOCK: Set isPlaying immediately to prevent other triggers while loading
            this.isPlaying = true;
            this.audioPlayer.src = audioUrl;

            const playPromise = this.audioPlayer.play();
            if (playPromise !== undefined) {
                await playPromise;
            }
            this.log('✅ Çalma başladı');
            this.showPlayingState(song);

            // Notify server
            if (this.device) {
                fetch(`${CONFIG.API_URL}/api/v1/jukebox/kiosk/now-playing`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        device_id: this.device.id,
                        device_pwd: this.getDevicePasswordForApi(),
                        song_id: song.song_id || (song.id.includes('autoplay') ? song.id.split('autoplay-')[1] : song.id)
                    })
                }).catch(e => this.log(`⚠️ Sunucu bildirim hatası: ${e.message}`, 'error'));
            }

        } catch (error) {
            this.isPlaying = false;
            const authRequiredMessage = this.getSpotifyDeviceAuthRequiredMessage(error);
            if (authRequiredMessage) {
                this.saveSpotifyDeviceAuthSetupState(authRequiredMessage);
                this.spotifyDeviceAuthReady = false;
                this.showSpotifyDeviceAuthSetupOverlay(authRequiredMessage);
                this.log(`⚠️ Spotify bağlantısı gerekli: ${authRequiredMessage}`, 'error');
                return;
            }
            this.log(`❌ Beklenmedik hata: ${error.message}`, 'error');
        }
    }

    async playSpotifySong(song) {
        this.isPlaying = true;
        this.currentPlayingSong = song;
        this.playbackStartedAt = Date.now();
        this.liveSpotifyState = null;
        this.lastSpotifyPoll = 0;
        this.trackTransitioning = false;
        this.autoplayTriggered = false;

        try {
            await this.ensureSpotifyPlaybackReady();
        } catch (e) {
            console.warn('Spotify local SDK not ready, proceeding with backend dispatch:', e);
        }

        const songId = song.song_id || song.id;
        if (!songId) {
            this.isPlaying = false;
            throw new Error('Spotify song id missing');
        }

        this.audioPlayer.pause();
        this.audioPlayer.src = '';
        const response = await fetch(`${CONFIG.API_URL}/api/v1/jukebox/kiosk/now-playing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                device_id: this.device.id,
                device_pwd: this.getDevicePasswordForApi(),
                song_id: songId
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            this.isPlaying = false;
            throw new Error(errorData.error || `Spotify playback handoff failed (${response.status})`);
        }

        this.isPlaying = true;
        this.startProgressUpdate();
        this.showPlayingState(song);
    }

    stopPlayback() {
        this.pauseSpotifyPlayback();
        this.audioPlayer.pause();
        this.audioPlayer.src = '';
        this.isPlaying = false;
        this.queueData.now_playing = null; // Clear local state immediately to prevent loop
        this.currentPlayingSong = null;
        this.playbackStartedAt = null;
        this.liveSpotifyState = null;
        this.trackTransitioning = false;
        this.showIdleState();

        if (this.device) {
            fetch(`${CONFIG.API_URL}/api/v1/jukebox/kiosk/now-playing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_id: this.device.id,
                    device_pwd: this.getDevicePasswordForApi(),
                    song_id: null
                })
            });
        }
    }

    // ===== Progress Bar =====
    startProgressUpdate() {
        this.stopProgressUpdate();
        this.updateProgress(); // Initial call
        this.progressInterval = setInterval(() => this.updateProgress(), CONFIG.UI_UPDATE_INTERVAL);
    }

    stopProgressUpdate() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    async pollLiveSpotifyPlaybackState() {
        if (!this.device) return;
        const now = Date.now();
        if (this.lastSpotifyPoll && now - this.lastSpotifyPoll < 1200) {
            return;
        }
        this.lastSpotifyPoll = now;

        try {
            const res = await fetch(`${CONFIG.API_URL}/api/v1/jukebox/kiosk/playback-state/${this.device.id}`, {
                headers: { 'x-kiosk-credential': this.getDevicePasswordForApi() },
            });
            if (!res.ok) return;
            const payload = await res.json();
            const data = payload?.data;
            const currentSong = this.queueData?.now_playing || this.currentPlayingSong;

            if (data && typeof data.progressMs === 'number') {
                if (currentSong?.spotify_uri && data.itemUri && data.itemUri !== currentSong.spotify_uri) {
                    this.liveSpotifyState = null;
                    return; // Ignore snapshot from previous song
                }
                this.liveSpotifyState = {
                    progressMs: data.progressMs,
                    durationMs: data.durationMs,
                    isPlaying: data.isPlaying,
                    itemUri: data.itemUri,
                    syncedAt: Date.now(),
                };
            }
        } catch {
            // silent ignore
        }
    }

    async updateProgress() {
        if (this.spotifyController) {
            await this.refreshSpotifyPlaybackStateFromSdk();
        } else {
            await this.pollLiveSpotifyPlaybackState();
        }

        const currentSong = this.queueData?.now_playing || this.currentPlayingSong;
        let current = 0;
        let total = 0;

        if (this.spotifyPlayerState?.track_uri && this.spotifyPlayerState?.duration_ms) {
            current = (this.spotifyPlayerState.position_ms || 0) / 1000;
            total = (this.spotifyPlayerState.duration_ms || 0) / 1000;
        } else if (this.liveSpotifyState && typeof this.liveSpotifyState.progressMs === 'number') {
            const elapsedSinceSync = Math.max(0, Date.now() - this.liveSpotifyState.syncedAt);
            current = (this.liveSpotifyState.progressMs + (this.liveSpotifyState.isPlaying ? elapsedSinceSync : 0)) / 1000;
            total = (this.liveSpotifyState.durationMs || (currentSong?.duration_ms ?? 0)) / 1000;
            if (total > 0 && current > total) {
                current = total;
            }
        } else if (this.audioPlayer.src && this.audioPlayer.src !== window.location.href && !this.audioPlayer.paused) {
            current = this.audioPlayer.currentTime;
            total = this.audioPlayer.duration || 0;
        } else if (currentSong?.duration_ms && this.playbackStartedAt && this.isPlaying) {
            total = currentSong.duration_ms / 1000;
            current = Math.min(total, (Date.now() - this.playbackStartedAt) / 1000);
        }

        const percent = total > 0 ? (current / total) * 100 : 0;

        // Auto transition to next song when duration expires
        const elapsedPlayback = this.playbackStartedAt ? (Date.now() - this.playbackStartedAt) : 0;
        if (total > 0 && current >= total && this.isPlaying && !this.trackTransitioning && elapsedPlayback > 4000) {
            this.trackTransitioning = true;
            console.log('🎵 Şarkı süresi tamamlandı, sonraki şarkıya geçiliyor...');
            setTimeout(() => {
                this.trackTransitioning = false;
                this.playNextFromQueue();
            }, 1000);
        }

        // Emit progress via socket only at larger intervals
        const now = Date.now();
        if (this.socket && this.device && (now - this.lastEmitTime >= CONFIG.SOCKET_EMIT_INTERVAL)) {
            this.socket.emit('playback_progress', {
                device_id: this.device.id,
                currentTime: current,
                duration: total,
                percent: percent
            });
            console.info('📡 [SOCKET] Progress emitted (Throttled):', Math.floor(current));
            this.lastEmitTime = now;
        } else if (!this.socket && now - this.lastEmitTime > 10000) {
            console.warn('⚠️ [SOCKET] Not connected yet');
            this.lastEmitTime = now; // Prevent spam
        }

        // Check for Autoplay Trigger (80% Rule)
        // If 80% played, queue is empty, and we haven't triggered yet
        if (total > 0 && percent > 80 && (!this.queueData.queue || this.queueData.queue.length === 0) && !this.autoplayTriggered) {
            console.log('⏳ 80% Kuralı: Otomatik sonraki şarkı tetikleniyor...');
            this.autoplayTriggered = true;

            if (this.device) {
                fetch(`${CONFIG.API_URL}/api/v1/jukebox/autoplay/trigger`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        device_id: this.device.id,
                        device_pwd: this.getDevicePasswordForApi(),
                    })
                }).then(r => r.json())
                    .then(d => this.log(`🤖 Otomatik eklendi: ${d.data?.song_title || 'Şarkı'}`))
                    .catch(e => console.error(e));
            }
        }

        // Update progress overlay
        const overlay = document.getElementById('progressOverlay');
        if (overlay) {
            overlay.style.width = `${percent}%`;
        }
        this.drawWaveform(percent);

        // Update time display
        document.getElementById('currentTime').textContent = this.formatTime(current);
        document.getElementById('totalTime').textContent = this.formatTime(total);

        // Update live lyrics active line
        this.updateActiveLyric(current);
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    transitionVisualState(showElement, hideElement) {
        if (!showElement || !showElement.classList) {
            return;
        }

        // Avoid re-triggering entering animation and flickering if already visible and not currently exiting
        const isAlreadyVisible = typeof showElement.classList.contains === 'function'
            ? (!showElement.classList.contains('hidden') && !showElement.classList.contains('state-exiting'))
            : false;
        const isHideHidden = !hideElement || typeof hideElement.classList?.contains !== 'function' || hideElement.classList.contains('hidden');

        if (isAlreadyVisible && isHideHidden) {
            return;
        }

        if (this.visualStateTransitionTimer) {
            clearTimeout(this.visualStateTransitionTimer);
            this.visualStateTransitionTimer = null;
        }

        showElement.classList.remove('hidden', 'state-exiting');
        showElement.classList.add('state-entering');

        if (hideElement && hideElement.classList && !isHideHidden) {
            hideElement.classList.remove('state-entering');
            hideElement.classList.add('state-exiting');
        }

        this.visualStateTransitionTimer = setTimeout(() => {
            showElement.classList.remove('state-entering');

            if (hideElement) {
                hideElement.classList.add('hidden');
                hideElement.classList.remove('state-exiting');
            }

            this.visualStateTransitionTimer = null;
        }, 240);
    }

    showPlayingState(song) {
        const idleState = document.getElementById('idleState');
        const playingState = document.getElementById('playingState');
        this.transitionVisualState(playingState, idleState);

        // Album art
        const albumArt = document.getElementById('albumArt');
        albumArt.src = song.cover_url || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%231a1a2e" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23666" font-size="30">🎵</text></svg>';

        // Update glow color based on album (could be dynamic)
        const glow = document.getElementById('albumGlow');
        if (glow) {
            glow.style.background = 'radial-gradient(circle, rgba(237, 28, 36, 0.45) 0%, rgba(237, 28, 36, 0.12) 45%, transparent 72%)';
        }

        // Song info
        document.getElementById('songTitle').textContent = song.title;
        document.getElementById('songArtist').textContent = song.artist;
        const requesterEl = document.getElementById('songRequester');
        const i18n = kioskI18n();
        if (song.added_by_name) {
            if (i18n) i18n.setPlainText(requesterEl, song.added_by_name);
            else requesterEl.textContent = song.added_by_name;
        } else if (i18n) {
            i18n.setText(requesterEl, 'stage.anonymous');
        } else {
            requesterEl.textContent = 'Anonim';
        }

        // Show live indicator
        document.getElementById('liveIndicator').style.display = 'flex';

        // New song, new waveform shape
        this.waveformBars = null;
        this.drawWaveform(0);
        this.extras?.onPlaying(song);

        // Load & Sync Lyrics
        this.loadLyricsForSong(song);
    }

    async loadLyricsForSong(song, attempt = 0) {
        if (!song || !song.title || !song.artist) return;
        clearTimeout(this.lyricsRetryTimer);
        const trackKey = `${song.artist} - ${song.title}`.toLowerCase();

        // If same song is replaying, reset active line and scroll to top
        if (this.lyricsState.trackKey === trackKey && this.lyricsState.lines?.length > 0) {
            this.lyricsState.activeIndex = -1;
            const scroller = document.getElementById('lyricsScroller');
            if (scroller) {
                scroller.scrollTop = 0;
                const domLines = scroller.querySelectorAll('.lyric-line');
                domLines.forEach(el => { el.className = 'lyric-line future'; });
            }
            return;
        }

        this.lyricsState = { trackKey, lines: [], plain: null, activeIndex: -1, synced: false };

        const scroller = document.getElementById('lyricsScroller');
        const badge = document.getElementById('lyricsBadge');
        if (scroller) {
            scroller.scrollTop = 0;
            scroller.innerHTML = `<div class="lyrics-placeholder" ${ki('lyrics.loading')}>${kt('lyrics.loading')}</div>`;
        }
        if (badge) {
            this.setLyricsBadge(badge, 'lyrics.searching', 'lyrics-badge');
        }

        try {
            const durationSec = song.duration_ms ? Math.round(song.duration_ms / 1000) : (song.duration_seconds || undefined);
            const params = new URLSearchParams({
                title: song.title,
                artist: song.artist,
            });
            if (durationSec) params.set('duration', String(durationSec));

            const res = await fetch(`${CONFIG.API_URL}/api/v1/jukebox/lyrics?${params.toString()}`);
            if (!res.ok) throw new Error('Lyrics request failed');
            const json = await res.json();
            const payload = json.data;

            if (this.lyricsState.trackKey !== trackKey) return;

            if (payload && (payload.lines?.length > 0 || payload.plainLyrics)) {
                this.lyricsState.lines = payload.lines || [];
                this.lyricsState.plain = payload.plainLyrics || null;
                this.lyricsState.synced = Boolean(payload.synced && payload.lines?.length > 0);
                this.renderLyrics();
            } else if (!this.scheduleLyricsRetry(song, trackKey, attempt)) {
                if (scroller) scroller.innerHTML = `<div class="lyrics-placeholder" ${ki('lyrics.notFound')}>${kt('lyrics.notFound')}</div>`;
                if (badge) {
                    this.setLyricsBadge(badge, 'lyrics.none', 'lyrics-badge none');
                }
            }
        } catch (error) {
            if (this.lyricsState.trackKey !== trackKey) return;
            if (this.scheduleLyricsRetry(song, trackKey, attempt)) return;
            if (scroller) scroller.innerHTML = `<div class="lyrics-placeholder" ${ki('lyrics.unavailable')}>${kt('lyrics.unavailable')}</div>`;
            if (badge) {
                this.setLyricsBadge(badge, 'lyrics.none', 'lyrics-badge none');
            }
        }
    }

    // lrclib is occasionally slow or flaky: ask again shortly so lyrics still appear
    // a few seconds into the song. Returns true when a retry was scheduled.
    scheduleLyricsRetry(song, trackKey, attempt) {
        const delay = LYRICS_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) return false;

        const scroller = document.getElementById('lyricsScroller');
        if (scroller) scroller.innerHTML = `<div class="lyrics-placeholder" ${ki('lyrics.stillSearching')}>${kt('lyrics.stillSearching')}</div>`;
        this.lyricsRetryTimer = setTimeout(() => {
            if (this.lyricsState.trackKey === trackKey) this.loadLyricsForSong(song, attempt + 1);
        }, delay);
        return true;
    }

    renderLyrics() {
        const scroller = document.getElementById('lyricsScroller');
        const badge = document.getElementById('lyricsBadge');
        if (!scroller) return;

        // Synced lyrics run as a karaoke view (big current line); plain text stays a scroll list.
        const karaoke = Boolean(this.lyricsState.synced && this.lyricsState.lines.length > 0);
        document.getElementById('lyricsCard')?.classList.toggle('is-karaoke', karaoke);

        if (karaoke) {
            if (badge) {
                this.setLyricsBadge(badge, 'lyrics.live', 'lyrics-badge');
            }
            scroller.innerHTML = this.lyricsState.lines
                .map((line, idx) => `<div class="${lyricLineClass(idx, -1)}" data-index="${idx}" data-time="${line.time}">${this.escapeHtml(line.text)}</div>`)
                .join('');
        } else if (this.lyricsState.plain) {
            if (badge) {
                this.setLyricsBadge(badge, 'lyrics.plain', 'lyrics-badge plain');
            }
            const lines = this.lyricsState.plain.split('\n').filter(l => l.trim().length > 0);
            scroller.innerHTML = lines
                .map(line => `<div class="lyric-line">${this.escapeHtml(line)}</div>`)
                .join('');
        }
    }

    setLyricsBadge(badge, key, className) {
        const i18n = kioskI18n();
        if (i18n) i18n.setText(badge, key);
        else badge.textContent = key;
        badge.className = className;
    }

    updateActiveLyric(currentSeconds) {
        if (!this.lyricsState.synced || !this.lyricsState.lines || this.lyricsState.lines.length === 0) return;

        const lines = this.lyricsState.lines;
        let activeIdx = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].time <= currentSeconds + 0.2) {
                activeIdx = i;
                break;
            }
        }

        if (activeIdx === this.lyricsState.activeIndex) return;
        this.lyricsState.activeIndex = activeIdx;

        const scroller = document.getElementById('lyricsScroller');
        if (!scroller) return;

        if (activeIdx === -1) {
            scroller.scrollTo({ top: 0, behavior: 'smooth' });
        }

        const domLines = scroller.querySelectorAll('.lyric-line');
        let activeEl = null;
        domLines.forEach((el, idx) => {
            el.className = lyricLineClass(idx, activeIdx);
            if (idx === activeIdx) activeEl = el;
        });

        if (activeEl && typeof scroller.scrollTo === 'function') {
            const targetScrollTop = Math.max(0, activeEl.offsetTop - (scroller.clientHeight / 2) + (activeEl.clientHeight / 2));
            scroller.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
        }
    }

    showIdleState() {
        const idleState = document.getElementById('idleState');
        const playingState = document.getElementById('playingState');
        this.transitionVisualState(idleState, playingState);
        this.extras?.onIdle();

        // Hide live indicator
        document.getElementById('liveIndicator').style.display = 'none';

        // Reset progress
        const overlay = document.getElementById('progressOverlay');
        if (overlay) overlay.style.width = '0%';
        this.drawWaveform(0);
        document.getElementById('currentTime').textContent = '0:00';
        document.getElementById('totalTime').textContent = '0:00';

        // Reset lyrics
        this.lyricsState = { trackKey: null, lines: [], plain: null, activeIndex: -1, synced: false };
        const scroller = document.getElementById('lyricsScroller');
        if (scroller) scroller.innerHTML = `<div class="lyrics-placeholder" ${ki('lyrics.waiting')}>${kt('lyrics.waiting')}</div>`;
    }

    renderQueue() {
        const queueList = document.getElementById('queueList');
        const queueCount = document.getElementById('queueCount');
        const queue = this.queueData.queue || [];

        queueCount.textContent = queue.length;

        if (queue.length === 0) {
            queueList.innerHTML = `
                <div class="empty-queue">
                    <span class="material-symbols-rounded">playlist_add</span>
                    <p ${ki('queue.empty')}>${kt('queue.empty')}</p>
                    <span class="empty-hint" ${ki('queue.emptyHint')}>${kt('queue.emptyHint')}</span>
                </div>
            `;
            return;
        }

        const renderVotes = (song) => {
            const voteScore = (song.upvotes || 0) - (song.downvotes || 0);
            const voteClass = voteScore < 0 ? 'negative' : '';
            const voteIcon = voteScore >= 0 ? 'trending_up' : 'trending_down';
            return `
                <div class="queue-votes ${voteClass}">
                    <span class="material-symbols-rounded">${voteIcon}</span>
                    ${voteScore > 0 ? '+' : ''}${voteScore}
                </div>`;
        };

        // The next song gets a big card (cover + requester); the rest stay a compact list.
        const [upNext, ...rest] = queue.slice(0, 6);
        const upNextCover = upNext.cover_url
            ? `<img class="up-next-cover" src="${this.escapeHtml(upNext.cover_url)}" alt="">`
            : '<span class="up-next-cover"></span>';
        const upNextCard = `
            <div class="queue-item up-next">
                ${upNextCover}
                <div class="queue-song-info">
                    <div class="up-next-label" ${ki('queue.upNext')}>${kt('queue.upNext')}</div>
                    <div class="queue-song-title">${this.escapeHtml(upNext.title)}</div>
                    <div class="queue-song-artist">${this.escapeHtml(upNext.artist)}</div>
                    ${upNext.added_by_name ? `<div class="up-next-requester"><span ${ki('queue.requestedBy')}>${kt('queue.requestedBy')}</span> <strong>${this.escapeHtml(upNext.added_by_name)}</strong></div>` : ''}
                </div>
                ${renderVotes(upNext)}
            </div>`;

        queueList.innerHTML = upNextCard + rest.map((song, index) => `
                <div class="queue-item">
                    <span class="queue-position">${index + 2}</span>
                    <div class="queue-song-info">
                        <div class="queue-song-title">${this.escapeHtml(song.title)}</div>
                        <div class="queue-song-artist">${this.escapeHtml(song.artist)}</div>
                    </div>
                    ${renderVotes(song)}
                </div>
            `).join('');
    }

    updateConnectionStatus(status, textKey) {
        const badge = document.getElementById('connectionBadge');
        const icon = document.getElementById('connectionIcon');
        const textEl = document.getElementById('connectionText');

        badge.className = 'connection-badge';
        this.extras?.onConnectionStatus(status);

        if (status === 'connected') {
            badge.classList.add('connected');
            icon.textContent = 'wifi';
        } else if (status === 'error') {
            badge.classList.add('error');
            icon.textContent = 'wifi_off';
        } else {
            icon.textContent = 'wifi_find';
        }

        const i18n = kioskI18n();
        if (i18n) i18n.setText(textEl, textKey);
        else textEl.textContent = textKey;
    }

    // ===== Fullscreen =====
    setupFullscreenToggle() {
        document.addEventListener('dblclick', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.log('Fullscreen error:', err);
                });
            } else {
                document.exitFullscreen();
            }
        });

        document.addEventListener('fullscreenchange', () => {
            document.querySelector('.kiosk-app').classList.toggle('fullscreen', !!document.fullscreenElement);
        });
    }

    // ===== Utilities =====
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}

/* Obsolete prototype override kept commented out while the class method remains canonical.
KioskApp.prototype.playSong = async function (song) {
    console.log('â–¶ï¸ Ã‡alÄ±nÄ±yor:', song.title);
    this.isPlaying = true;

    try {
        const playbackPlan = window.KioskPlayback.getSongPlaybackPlan(song, CONFIG.API_URL);
        this.autoplayTriggered = false;

        if (playbackPlan.kind === 'spotify') {
            await this.playSpotifySong(song);
            return;
        }

        if (playbackPlan.kind !== 'local' || !playbackPlan.audioUrl) {
            await this.skipUnsupportedSong(song, 'GeÃ§erli bir local audio kaynaÄŸÄ± bulunamadÄ±');
            return;
        }

        const audioUrl = playbackPlan.audioUrl;
        if (this.audioPlayer.src.includes(audioUrl) && this.isPlaying) {
            console.log('â­ï¸ ÅarkÄ± zaten Ã§alÄ±yor, atlandÄ±');
            return;
        }

        this.isPlaying = true;
        this.audioPlayer.src = audioUrl;

        const playPromise = this.audioPlayer.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                this.log('âœ… Ã‡alma baÅŸladÄ±');
                this.showPlayingState(song);
            }).catch((error) => {
                this.isPlaying = false;
                this.log(`âŒ Ã‡alma baÅŸarÄ±sÄ±z: ${error.message}`, 'error');
                if (error.name === 'NotAllowedError') {
                    this.log('ğŸ‘‰ LÃ¼tfen ekrana bir kez tÄ±klayÄ±n!');
                    this.showStartupOverlay();
                }
            });
        }

        if (this.device) {
            fetch(`${CONFIG.API_URL}/api/v1/jukebox/kiosk/now-playing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_id: this.device.id,
                    device_pwd: this.getDevicePasswordForApi(),
                    song_id: song.song_id || (song.id.includes('autoplay') ? song.id.split('autoplay-')[1] : song.id)
                })
            }).catch((error) => this.log(`âš ï¸ Sunucu bildirim hatasÄ±: ${error.message}`, 'error'));
        }
    } catch (error) {
        this.isPlaying = false;
            this.isPlaying = false;
            this.isPlaying = false;
            this.log(`âŒ Beklenmedik hata: ${error.message}`, 'error');
    }
};
*/

const kioskRoot = typeof globalThis !== 'undefined' ? globalThis : window;
kioskRoot.KioskApp = KioskApp;
if (typeof window !== 'undefined') {
    window.KioskApp = KioskApp;
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.KioskI18n?.init(window);
    window.KioskI18n?.bindToggle(document.getElementById('langToggleBtn'));
    window.kioskApp = new KioskApp();
});
